import { EarningStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { POINT_VALUE_MINOR } from '../../lib/loyalty';
import { restorePoints, reverseEarnedPoints, rewardsFund } from '../rewards/rewards.service';

/**
 * Refund an order after it settled, reversing every money and points effect in
 * proportion to what was returned.
 *
 * A partial refund reverses the same share of everything: the provider's
 * earning and Voryn's commission shrink together, points earned on the
 * refunded portion are clawed back, and the matching share of any points the
 * customer spent is handed back. Reversing only the cash would let a customer
 * order, earn points, refund, and keep the reward.
 */
export async function refundOrderSettlement(input: {
  orderId: string;
  refundMinor: number;
  reason: string;
}) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw AppError.notFound('Order not found');
  if (input.refundMinor <= 0) throw AppError.badRequest('Refund amount must be positive.');

  // Proportion is measured against the item value, which is what earns points
  // and what commission is charged on.
  const basisMinor = order.subtotalMinor;
  if (basisMinor <= 0) return { refundedShare: 0 };
  const refundedShare = Math.min(1, input.refundMinor / basisMinor);

  const earning = await prisma.providerEarning.findUnique({
    where: { referenceType_referenceId: { referenceType: 'order', referenceId: order.id } },
  });

  if (earning && earning.status !== EarningStatus.REVERSED) {
    const reversedGross = Math.round(earning.grossMinor * refundedShare);
    const reversedCommission = Math.round(earning.commissionMinor * refundedShare);
    const reversedNet = reversedGross - reversedCommission;

    if (refundedShare >= 1) {
      if (earning.status === EarningStatus.PAID) {
        throw AppError.badRequest(
          'This earning has already been paid out. Recover it through a payout adjustment.',
          'EARNING_ALREADY_PAID',
        );
      }
      await prisma.providerEarning.update({
        where: { id: earning.id },
        data: { status: EarningStatus.REVERSED },
      });
    } else {
      // Shrink the earning in place so the provider's wallet reflects the
      // smaller sale rather than carrying a phantom balance.
      await prisma.providerEarning.update({
        where: { id: earning.id },
        data: {
          grossMinor: earning.grossMinor - reversedGross,
          commissionMinor: earning.commissionMinor - reversedCommission,
          netMinor: earning.netMinor - reversedNet,
        },
      });
    }

    await prisma.settlementRecord.createMany({
      data: [
        {
          referenceType: 'order',
          referenceId: order.id,
          entryType: 'REFUND',
          amountMinor: input.refundMinor,
          memo: `${Math.round(refundedShare * 100)}% refunded: ${input.reason}`,
        },
      ],
      skipDuplicates: true,
    });
  }

  // Points earned on the refunded portion go back. The account may go into
  // deficit if they were already spent — better than blocking the refund.
  const pointsToReverse = Math.floor(order.pointsEarned * refundedShare);
  if (pointsToReverse > 0) {
    await reverseEarnedPoints({
      userId: order.customerId,
      points: pointsToReverse,
      description: `Points reversed on refunded order ${order.code}`,
      referenceType: 'order',
      referenceId: order.id,
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { pointsEarned: order.pointsEarned - pointsToReverse },
    });
  }

  // …and the matching share of points the customer spent comes back to them.
  const pointsToRestore = Math.floor(order.pointsRedeemed * refundedShare);
  if (pointsToRestore > 0) {
    await restorePoints({
      userId: order.customerId,
      points: pointsToRestore,
      description: `Points returned on refunded order ${order.code}`,
      referenceType: 'order',
      referenceId: order.id,
    });
    await rewardsFund.record({
      type: 'REDEMPTION',
      amountMinor: pointsToRestore * POINT_VALUE_MINOR,
      description: `Redemption reversed on refunded ${order.code}`,
      referenceType: 'order',
      referenceId: order.id,
      idempotencyKey: `fund-refund-reversal:order:${order.id}:${pointsToRestore}`,
    });
  }

  return {
    refundedShare,
    pointsReversed: pointsToReverse,
    pointsRestored: pointsToRestore,
  };
}
