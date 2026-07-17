import { OrderStatus, PaymentMethodType, PromotionType, WalletEntryType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { orderCode } from '../../lib/codes';
import { percentOfMinor } from '../../lib/money';
import { takePayment, refundPayment } from '../payments/payment.service';
import { recordTrackingEvent } from '../tracking/tracking.service';
import { notifyProviderStaff } from '../../lib/notify';
import { walletService } from '../wallet/wallet.service';
import { OUT_OF_ZONE_MESSAGE, deliveryQuote } from './delivery-quote';

const SERVICE_FEE_MINOR = 15000; // JMD 150.00 platform service fee
const TAX_RATE_PERCENT = 10;

/**
 * Order domain service. State transitions live here so the future provider
 * dashboard drives the same functions (confirm, prepare, assign courier, …).
 */
export const ordersService = {
  /**
   * Prices the active cart for a delivery address. Checkout runs the same
   * math, so what the customer sees here is exactly what they are charged.
   */
  async quote(customerId: string, addressId?: string) {
    const cart = await prisma.cart.findFirst({
      where: { customerId, isActive: true },
      include: { items: true, promoCode: true },
    });
    if (!cart || cart.items.length === 0) throw AppError.badRequest('Your cart is empty.', 'CART_EMPTY');

    const address = addressId
      ? await prisma.address.findFirst({ where: { id: addressId, userId: customerId } })
      : await prisma.address.findFirst({
          where: { userId: customerId },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        });
    if (addressId && !address) throw AppError.notFound('Delivery address not found');

    const trip = await deliveryQuote(
      cart,
      address ? { lat: address.latitude, lng: address.longitude } : null,
    );

    const subtotalMinor = cart.items.reduce((sum, i) => sum + i.unitPriceMinor * i.quantity, 0);

    // Promo discount
    let discountMinor = 0;
    if (cart.promoCode) {
      if (cart.promoCode.minSpendMinor <= subtotalMinor) {
        if (cart.promoCode.type === PromotionType.PERCENT_OFF) {
          discountMinor = percentOfMinor(subtotalMinor, cart.promoCode.value);
        } else if (cart.promoCode.type === PromotionType.AMOUNT_OFF) {
          discountMinor = Math.min(cart.promoCode.value, subtotalMinor);
        } else if (cart.promoCode.type === PromotionType.FREE_DELIVERY) {
          discountMinor = trip.deliveryFeeMinor;
        }
      }
    }

    const taxMinor = percentOfMinor(subtotalMinor, TAX_RATE_PERCENT);
    const totalBeforeTipMinor = Math.max(
      0,
      subtotalMinor + trip.deliveryFeeMinor + SERVICE_FEE_MINOR + taxMinor - discountMinor,
    );

    return {
      cart,
      address,
      ...trip,
      subtotalMinor,
      serviceFeeMinor: SERVICE_FEE_MINOR,
      taxMinor,
      discountMinor,
      totalBeforeTipMinor,
    };
  },

  async checkout(input: {
    customerId: string;
    addressId: string;
    paymentMethodType: PaymentMethodType;
    tipMinor?: number;
    redeemPoints?: boolean;
    idempotencyKey: string;
  }) {
    const quote = await this.quote(input.customerId, input.addressId);
    const { cart, address, providerId, merchantName, deliveryFeeMinor, distanceKm } = quote;
    if (!address) throw AppError.notFound('Delivery address not found');
    if (quote.outOfZone) throw AppError.badRequest(OUT_OF_ZONE_MESSAGE, 'OUT_OF_DELIVERY_ZONE');
    const { subtotalMinor, taxMinor } = quote;
    const etaMin = quote.etaMinMinutes;
    const etaMax = quote.etaMaxMinutes;

    // Loyalty redemption: 500 pts => JMD 250.00 off (50 minor units per point).
    let discountMinor = quote.discountMinor;
    let pointsRedeemed = 0;
    if (input.redeemPoints) {
      const loyalty = await prisma.loyaltyAccount.findUnique({ where: { userId: input.customerId } });
      if (loyalty && loyalty.pointsBalance >= 500) {
        pointsRedeemed = 500;
        discountMinor += 25000;
      }
    }

    const tipMinor = input.tipMinor ?? 0;
    const totalMinor = Math.max(
      0,
      subtotalMinor + deliveryFeeMinor + SERVICE_FEE_MINOR + taxMinor + tipMinor - discountMinor,
    );

    // Create the order in PENDING_PAYMENT, take payment, then mark PLACED.
    const order = await prisma.order.create({
      data: {
        code: orderCode('VC'),
        customerId: input.customerId,
        providerId,
        restaurantId: cart.restaurantId,
        storeId: cart.storeId,
        status: OrderStatus.PENDING_PAYMENT,
        deliveryAddressName: `${address.name} • ${address.line1}`,
        deliveryLat: address.latitude,
        deliveryLng: address.longitude,
        deliveryInstructions: address.instructions,
        distanceKm,
        subtotalMinor,
        deliveryFeeMinor,
        serviceFeeMinor: SERVICE_FEE_MINOR,
        taxMinor,
        discountMinor,
        tipMinor,
        totalMinor,
        promoCodeId: cart.promoCodeId,
        etaMinMinutes: etaMin,
        etaMaxMinutes: etaMax,
        items: {
          create: cart.items.map((i) => ({
            menuItemId: i.menuItemId,
            productId: i.productId,
            name: i.name,
            unitPriceMinor: i.unitPriceMinor,
            quantity: i.quantity,
            optionsJson: i.optionsJson as never,
            notes: i.notes,
          })),
        },
      },
      include: { items: true },
    });

    let payment;
    try {
      payment = await takePayment({
        userId: input.customerId,
        methodType: input.paymentMethodType,
        amountMinor: totalMinor,
        referenceType: 'order',
        referenceId: order.id,
        description: `Order ${order.code} • ${merchantName}`,
        counterpartyName: merchantName,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (err) {
      // Payment failed — order stays PENDING_PAYMENT and is surfaced as such.
      await prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PENDING_PAYMENT },
      });
      throw err;
    }

    const placed = await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PLACED, paymentId: payment.id, placedAt: new Date() },
      include: { items: true, provider: { select: { id: true, name: true, logoUrl: true } } },
    });

    await prisma.$transaction([
      prisma.cart.update({ where: { id: cart.id }, data: { isActive: false } }),
      ...(pointsRedeemed > 0
        ? [
            prisma.loyaltyAccount.update({
              where: { userId: input.customerId },
              data: { pointsBalance: { decrement: pointsRedeemed } },
            }),
            prisma.loyaltyTransaction.create({
              data: {
                account: { connect: { userId: input.customerId } },
                type: 'REDEEM',
                points: -pointsRedeemed,
                description: `Redeemed on order ${placed.code}`,
                referenceType: 'order',
                referenceId: placed.id,
              },
            }),
          ]
        : []),
      ...(cart.promoCodeId
        ? [
            prisma.promoRedemption.create({
              data: {
                promoCodeId: cart.promoCodeId,
                userId: input.customerId,
                referenceType: 'order',
                referenceId: placed.id,
              },
            }),
          ]
        : []),
    ]);

    // Loyalty earn: 1 point per JMD 100 spent.
    const pointsEarned = Math.floor(totalMinor / 10000);
    if (pointsEarned > 0) {
      await prisma.$transaction([
        prisma.loyaltyAccount.update({
          where: { userId: input.customerId },
          data: { pointsBalance: { increment: pointsEarned } },
        }),
        prisma.loyaltyTransaction.create({
          data: {
            account: { connect: { userId: input.customerId } },
            type: 'EARN',
            points: pointsEarned,
            description: `Earned on order ${placed.code}`,
            referenceType: 'order',
            referenceId: placed.id,
          },
        }),
      ]);
    }

    await recordTrackingEvent({
      subjectType: 'ORDER',
      subjectId: placed.id,
      status: OrderStatus.PLACED,
      label: 'Order placed',
    });

    await notifyProviderStaff(
      placed.providerId,
      'ORDER_UPDATE',
      `New order ${placed.code}`,
      `${cart.items.length} item(s) • ${(placed.totalMinor / 100).toLocaleString('en-JM', { minimumFractionDigits: 2 })} JMD — accept it in the dashboard.`,
    );

    return { order: placed, payment };
  },

  /**
   * Post-delivery tip: charges the customer and pays the courier in full.
   * One tip per order — checkout tips and after-the-fact tips are exclusive.
   */
  async addTip(orderId: string, customerId: string, tipMinor: number) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: { courier: { include: { user: { select: { id: true, fullName: true } } } }, payment: true },
    });
    if (!order) throw AppError.notFound('Order not found');
    if (order.status !== OrderStatus.DELIVERED && order.status !== OrderStatus.COMPLETED) {
      throw AppError.badRequest('You can tip once your order has been delivered.', 'NOT_DELIVERED');
    }
    if (order.tipMinor > 0) {
      throw AppError.conflict('A tip has already been added to this order.', 'ALREADY_TIPPED');
    }
    if (!order.courier) throw AppError.badRequest('This order has no delivery person to tip.');

    await takePayment({
      userId: customerId,
      methodType: order.payment?.methodType ?? PaymentMethodType.VORYN_WALLET,
      amountMinor: tipMinor,
      referenceType: 'order',
      referenceId: order.id,
      description: `Tip for ${order.courier.user.fullName} • ${order.code}`,
      counterpartyName: order.courier.user.fullName,
      idempotencyKey: `order-tip:${order.id}`,
    });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { tipMinor, totalMinor: { increment: tipMinor } },
    });

    // The delivery payout already ran at DELIVERED, so credit the tip separately.
    await walletService.credit({
      userId: order.courier.user.id,
      amountMinor: tipMinor,
      type: WalletEntryType.PAYOUT,
      description: `Tip • ${order.code}`,
      referenceType: 'delivery',
      referenceId: order.id,
      idempotencyKey: `driver-tip:delivery:${order.id}`,
    });
    await prisma.notification.create({
      data: {
        userId: order.courier.user.id,
        type: 'ORDER_UPDATE',
        title: 'You received a tip!',
        body: `A customer tipped you on delivery ${order.code}. It has been added to your wallet.`,
      },
    });

    return updated;
  },

  /** Provider-side transitions (used by the dev simulator today, provider dashboard later). */
  async transition(orderId: string, status: OrderStatus, label: string, extra?: Record<string, unknown>) {
    const order = await prisma.order.update({
      where: { id: orderId },
      data: {
        status,
        ...(status === OrderStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
      },
    });
    await recordTrackingEvent({ subjectType: 'ORDER', subjectId: orderId, status, label, metadata: extra });
    return order;
  },

  async assignCourier(orderId: string, courierId: string) {
    const order = await prisma.order.update({
      where: { id: orderId },
      data: { courierId, status: OrderStatus.COURIER_ASSIGNED },
    });
    await recordTrackingEvent({
      subjectType: 'ORDER',
      subjectId: orderId,
      status: OrderStatus.COURIER_ASSIGNED,
      label: 'Courier assigned',
    });
    return order;
  },

  async cancel(orderId: string, customerId: string, reason: string) {
    const order = await prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) throw AppError.notFound('Order not found');
    const cancellable: OrderStatus[] = [
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.PLACED,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
    ];
    if (!cancellable.includes(order.status)) {
      throw AppError.badRequest('This order can no longer be cancelled.', 'NOT_CANCELLABLE');
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.CANCELLED_BY_CUSTOMER, cancelReason: reason },
    });
    if (order.paymentId) {
      await refundPayment(order.paymentId, `Order ${order.code} cancelled`);
    }
    await recordTrackingEvent({
      subjectType: 'ORDER',
      subjectId: order.id,
      status: OrderStatus.CANCELLED_BY_CUSTOMER,
      label: 'Order cancelled',
    });
    // The kitchen may already be working on it — surface it on the dashboard.
    await notifyProviderStaff(
      order.providerId,
      'ORDER_UPDATE',
      'Order cancelled',
      `Order ${order.code} was cancelled by the customer${order.status === OrderStatus.PREPARING ? ' while preparing' : ''}. Stop preparing it.`,
    );
    return updated;
  },
};
