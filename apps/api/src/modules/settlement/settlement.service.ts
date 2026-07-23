import { Prisma, SettlementEntryType, WalletEntryType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import {
  commissionBpsForProvider,
  commissionOfMinor,
  deliverySplit,
} from '../../lib/commission';
import { POINT_VALUE_MINOR } from '../../lib/loyalty';
import { awardPoints, rewardsFund } from '../rewards/rewards.service';
import { walletService } from '../wallet/wallet.service';

/**
 * Settlement runs once per completed transaction and produces:
 *  - a ProviderEarning row (the provider's net, pending until it clears),
 *  - the courier/driver wallet payout where one is owed,
 *  - customer points earn,
 *  - a full SettlementRecord breakdown (spec: never store only order.total).
 *
 * Every write is idempotent: the ProviderEarning unique constraint gates the
 * whole settlement, wallet credits carry stable idempotency keys, and
 * SettlementRecords are created with skipDuplicates.
 */

function clearanceDate(from = new Date()): Date {
  return new Date(from.getTime() + env.EARNINGS_CLEAR_DAYS * 86_400_000);
}

type RecordLine = { entryType: SettlementEntryType; amountMinor: number; memo?: string };

async function writeRecords(referenceType: string, referenceId: string, lines: RecordLine[]) {
  await prisma.settlementRecord.createMany({
    data: lines
      .filter((l) => l.amountMinor !== 0)
      .map((l) => ({ referenceType, referenceId, ...l })),
    skipDuplicates: true,
  });
}

async function ensureWalletAndLoyalty(userId: string) {
  await prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
  await prisma.loyaltyAccount.upsert({ where: { userId }, create: { userId }, update: {} });
}

async function createEarning(input: {
  providerId: string;
  referenceType: string;
  referenceId: string;
  code: string;
  grossMinor: number;
  commissionBps: number;
}): Promise<boolean> {
  const commissionMinor = commissionOfMinor(input.grossMinor, input.commissionBps);
  try {
    await prisma.providerEarning.create({
      data: {
        providerId: input.providerId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        code: input.code,
        grossMinor: input.grossMinor,
        commissionBps: input.commissionBps,
        commissionMinor,
        netMinor: input.grossMinor - commissionMinor,
        availableAt: clearanceDate(),
      },
    });
    // Set aside a slice of the commission to finance future redemptions, so
    // rewards are paid from a provision rather than from operating cash.
    await rewardsFund.contributeFromCommission({
      commissionMinor,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      code: input.code,
    });
    return true;
  } catch (err) {
    // Unique (referenceType, referenceId) hit = this transaction already settled.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
    throw err;
  }
}

export const settlementService = {
  /**
   * Order settlement, run when an order first reaches DELIVERED/COMPLETED.
   * Merchant basis = item subtotal minus merchant-funded discounts; Voryn-funded
   * rewards (points, platform promos) never reduce what the merchant is owed.
   */
  async settleOrder(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        provider: { select: { id: true, commissionBps: true, categories: true } },
        courier: { select: { user: { select: { id: true } } } },
        promoCode: { select: { promotion: { select: { providerId: true } } } },
      },
    });
    if (!order) return;

    const merchantFundedDiscountMinor =
      order.promoCode?.promotion?.providerId != null ? order.discountMinor : 0;
    const vorynFundedPromoMinor = order.discountMinor - merchantFundedDiscountMinor;
    const basisMinor = Math.max(0, order.subtotalMinor - merchantFundedDiscountMinor);
    const bps = commissionBpsForProvider(order.provider);

    const isFirstSettlement = await createEarning({
      providerId: order.provider.id,
      referenceType: 'order',
      referenceId: order.id,
      code: order.code,
      grossMinor: basisMinor,
      commissionBps: bps,
    });
    if (!isFirstSettlement) return;

    // Courier: guaranteed compensation from the delivery fee plus 100% of tips.
    const split = deliverySplit(order.deliveryFeeMinor);
    if (order.courier?.user.id) {
      const payoutMinor = split.courierCompensationMinor + order.tipMinor;
      if (payoutMinor > 0) {
        await ensureWalletAndLoyalty(order.courier.user.id);
        await walletService.credit({
          userId: order.courier.user.id,
          amountMinor: payoutMinor,
          type: WalletEntryType.PAYOUT,
          description: `Trip payout • ${order.code}`,
          referenceType: 'delivery',
          referenceId: order.id,
          idempotencyKey: `driver-payout:delivery:${order.id}`,
        });
      }
    }

    // Customer points: earned on the eligible amount actually paid for items,
    // at the category rate, scaled by tier and any live campaign.
    const eligibleMinor = Math.max(
      0,
      order.subtotalMinor - order.discountMinor - order.pointsDiscountMinor,
    );
    let pointsEarned = 0;
    if (eligibleMinor > 0 && order.pointsEarned === 0) {
      await ensureWalletAndLoyalty(order.customerId);
      const priorOrders = await prisma.order.count({
        where: {
          customerId: order.customerId,
          status: { in: ['DELIVERED', 'COMPLETED'] },
          id: { not: order.id },
        },
      });
      pointsEarned = await awardPoints({
        userId: order.customerId,
        eligibleMinor,
        category: order.provider.categories[0] ?? 'RESTAURANT',
        referenceType: 'order',
        referenceId: order.id,
        code: order.code,
        isFirstOrder: priorOrders === 0,
      });
      if (pointsEarned > 0) {
        await prisma.order.update({ where: { id: order.id }, data: { pointsEarned } });
      }
    }

    const commissionMinor = commissionOfMinor(basisMinor, bps);
    await writeRecords('order', order.id, [
      { entryType: 'CUSTOMER_PAYMENT', amountMinor: order.totalMinor },
      { entryType: 'MERCHANT_GROSS_SALE', amountMinor: order.subtotalMinor },
      { entryType: 'MERCHANT_FUNDED_DISCOUNT', amountMinor: merchantFundedDiscountMinor },
      {
        entryType: 'VORYN_FUNDED_DISCOUNT',
        amountMinor: vorynFundedPromoMinor + order.pointsDiscountMinor,
      },
      { entryType: 'VORYN_COMMISSION', amountMinor: commissionMinor },
      { entryType: 'PROVIDER_NET_EARNING', amountMinor: basisMinor - commissionMinor },
      { entryType: 'DELIVERY_FEE', amountMinor: order.deliveryFeeMinor },
      { entryType: 'COURIER_EARNING', amountMinor: split.courierCompensationMinor },
      { entryType: 'VORYN_DELIVERY_MARGIN', amountMinor: split.vorynMarginMinor },
      { entryType: 'SERVICE_FEE', amountMinor: order.serviceFeeMinor },
      { entryType: 'TIP', amountMinor: order.tipMinor },
      { entryType: 'TAX', amountMinor: order.taxMinor },
      {
        entryType: 'POINTS_REDEEMED',
        amountMinor: order.pointsDiscountMinor,
        memo: `${order.pointsRedeemed} pts`,
      },
      {
        entryType: 'POINTS_EARNED',
        amountMinor: pointsEarned * POINT_VALUE_MINOR,
        memo: `${pointsEarned} pts`,
      },
    ]);
  },

  /**
   * Ride settlement: the driver is the provider. Commission applies to the
   * fare only; tips are recorded whole and paid separately.
   */
  async settleRide(input: {
    tripId: string;
    code: string;
    fareMinor: number;
    tipMinor: number;
  }) {
    const commissionMinor = commissionOfMinor(input.fareMinor, env.RIDE_COMMISSION_BPS);
    await writeRecords('ride', input.tripId, [
      { entryType: 'CUSTOMER_PAYMENT', amountMinor: input.fareMinor + input.tipMinor },
      { entryType: 'MERCHANT_GROSS_SALE', amountMinor: input.fareMinor },
      { entryType: 'VORYN_COMMISSION', amountMinor: commissionMinor },
      { entryType: 'PROVIDER_NET_EARNING', amountMinor: input.fareMinor - commissionMinor },
      { entryType: 'TIP', amountMinor: input.tipMinor },
    ]);
  },

  /** Service booking settlement: basis = package price + mobile call-out fee. */
  async settleBooking(bookingId: string) {
    const booking = await prisma.serviceBooking.findUnique({
      where: { id: bookingId },
      include: { provider: { select: { id: true, commissionBps: true, categories: true } } },
    });
    if (!booking) return;

    const basisMinor = booking.serviceFeeMinor + booking.mobileFeeMinor;
    const bps = commissionBpsForProvider(booking.provider);
    const isFirstSettlement = await createEarning({
      providerId: booking.provider.id,
      referenceType: 'booking',
      referenceId: booking.id,
      code: booking.code,
      grossMinor: basisMinor,
      commissionBps: bps,
    });
    if (!isFirstSettlement) return;

    const commissionMinor = commissionOfMinor(basisMinor, bps);
    await writeRecords('booking', booking.id, [
      { entryType: 'CUSTOMER_PAYMENT', amountMinor: booking.totalMinor },
      { entryType: 'MERCHANT_GROSS_SALE', amountMinor: basisMinor },
      { entryType: 'VORYN_COMMISSION', amountMinor: commissionMinor },
      { entryType: 'PROVIDER_NET_EARNING', amountMinor: basisMinor - commissionMinor },
      { entryType: 'SERVICE_FEE', amountMinor: booking.convenienceFeeMinor },
      { entryType: 'TAX', amountMinor: booking.taxMinor },
    ]);
  },

  /** Rental settlement: basis = rental fee + protection; deposits are never revenue. */
  async settleRental(reservationId: string) {
    const rental = await prisma.rentalReservation.findUnique({
      where: { id: reservationId },
      include: { provider: { select: { id: true, commissionBps: true, categories: true } } },
    });
    if (!rental) return;

    const basisMinor = rental.rentalFeeMinor + rental.protectionMinor;
    const bps = commissionBpsForProvider(rental.provider);
    const isFirstSettlement = await createEarning({
      providerId: rental.provider.id,
      referenceType: 'rental',
      referenceId: rental.id,
      code: rental.code,
      grossMinor: basisMinor,
      commissionBps: bps,
    });
    if (!isFirstSettlement) return;

    const commissionMinor = commissionOfMinor(basisMinor, bps);
    await writeRecords('rental', rental.id, [
      { entryType: 'CUSTOMER_PAYMENT', amountMinor: rental.totalMinor },
      { entryType: 'MERCHANT_GROSS_SALE', amountMinor: basisMinor },
      { entryType: 'VORYN_COMMISSION', amountMinor: commissionMinor },
      { entryType: 'PROVIDER_NET_EARNING', amountMinor: basisMinor - commissionMinor },
      { entryType: 'SERVICE_FEE', amountMinor: rental.serviceFeeMinor },
    ]);
  },
};
