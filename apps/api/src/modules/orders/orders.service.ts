import { OrderStatus, PaymentMethodType, PromotionType, WalletEntryType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { orderCode } from '../../lib/codes';
import { percentOfMinor } from '../../lib/money';
import { takePayment, refundPayment } from '../payments/payment.service';
import { recordTrackingEvent } from '../tracking/tracking.service';
import { notifyProviderStaff } from '../../lib/notify';
import { walletService } from '../wallet/wallet.service';
import { settlementService } from '../settlement/settlement.service';
import { normaliseRequestedPoints, pointsToMinor } from '../../lib/loyalty';
import {
  issuePendingPoints,
  quoteRedemption,
  restorePoints,
  reverseEarnedPoints,
  rewardsFund,
  spendPoints,
  voidPendingPoints,
} from '../rewards/rewards.service';
import {
  OUT_OF_ZONE_MESSAGE,
  consumeDeliveryQuote,
  deliveryQuote,
  persistDeliveryQuote,
} from './delivery-quote';
import { MIN_DESTINATION_CHANGE_MINOR, cancellationFeeMinor } from '../../lib/pricing';

// Provider-funded commission model: customers pay no Voryn platform fee.
// Voryn's revenue comes from the merchant commission and delivery margin.
export const SERVICE_FEE_MINOR = 0;
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
  async quote(
    customerId: string,
    addressId?: string,
    paymentMethod?: PaymentMethodType,
    opts?: { persistQuote?: boolean },
  ) {
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

    // Points: the rewards engine decides how much this order may absorb, so a
    // redemption can never cost more than the commission it protects.
    const provider = await prisma.provider.findUniqueOrThrow({
      where: { id: trip.providerId },
      select: { commissionBps: true, categories: true },
    });
    const points = await quoteRedemption({
      userId: customerId,
      itemsMinor: Math.max(0, subtotalMinor - discountMinor),
      deliveryFeeMinor: trip.deliveryFeeMinor,
      provider,
      // Card orders cost more to accept, which leaves less margin for a
      // discount. Unpriced quotes assume the wallet (the cheapest path).
      paymentMethod,
      customerPaidMinor: totalBeforeTipMinor,
    });

    // For the public quote endpoint, sign and persist the delivery fee so the
    // customer can confirm this exact price at checkout (spec §14). Skipped when
    // checkout calls quote() internally — it consumes the quote it was handed.
    let deliveryQuoteId: string | null = null;
    let deliveryQuoteExpiresAt: Date | null = null;
    if (opts?.persistQuote && address && !trip.outOfZone) {
      const row = await persistDeliveryQuote(customerId, trip);
      if (row) {
        deliveryQuoteId = row.id;
        deliveryQuoteExpiresAt = row.expiresAt;
      }
    }

    return {
      cart,
      address,
      ...trip,
      subtotalMinor,
      serviceFeeMinor: SERVICE_FEE_MINOR,
      taxMinor,
      discountMinor,
      totalBeforeTipMinor,
      provider,
      points,
      deliveryQuoteId,
      deliveryQuoteExpiresAt,
      pricingVersion: env.DELIVERY_PRICING_VERSION,
    };
  },

  async checkout(input: {
    customerId: string;
    addressId: string;
    paymentMethodType: PaymentMethodType;
    tipMinor?: number;
    /** Exact points to apply (capped server-side at 20% of the eligible amount). */
    pointsToRedeem?: number;
    /** Legacy toggle from older app builds: redeem the maximum allowed. */
    redeemPoints?: boolean;
    /** Signed delivery quote to lock the fee to (spec §14). Optional (legacy). */
    deliveryQuoteId?: string;
    idempotencyKey: string;
  }) {
    const quote = await this.quote(input.customerId, input.addressId, input.paymentMethodType);
    const { cart, address, providerId, merchantName } = quote;
    if (!address) throw AppError.notFound('Delivery address not found');
    if (quote.outOfZone) throw AppError.badRequest(OUT_OF_ZONE_MESSAGE, 'OUT_OF_DELIVERY_ZONE');

    // Delivery fee: lock it to the signed quote the customer confirmed when one
    // is supplied; otherwise fall back to the freshly computed live fee.
    let deliveryFeeMinor = quote.deliveryFeeMinor;
    let distanceKm: number | null = quote.distanceKm;
    let deliveryQuoteId: string | null = null;
    const delivery = {
      vehicle: quote.vehicle as string,
      packageClass: quote.packageClass as string,
      vehicleAdjustmentMinor: quote.vehicleAdjustmentMinor,
      packageAdjustmentMinor: quote.packageAdjustmentMinor,
      additionalPickupFeeMinor: quote.additionalPickupFeeMinor,
      demandMultiplierBps: quote.demandMultiplierBps,
      demandAdjustmentMinor: quote.demandAdjustmentMinor,
      waitingFeeMinor: quote.waitingFeeMinor,
      routeDistanceMeters: quote.routeDistanceMeters,
      estimatedDurationSeconds: quote.estimatedDurationSeconds,
      pricingVersion: quote.pricingVersion,
    };
    if (input.deliveryQuoteId) {
      const locked = await consumeDeliveryQuote({
        quoteId: input.deliveryQuoteId,
        customerId: input.customerId,
        providerId,
        dropoff: { lat: address.latitude, lng: address.longitude },
      });
      deliveryQuoteId = locked.id;
      deliveryFeeMinor = locked.finalDeliveryFeeMinor;
      distanceKm = locked.distanceKm;
      delivery.vehicle = locked.vehicle;
      delivery.packageClass = locked.packageClass;
      delivery.vehicleAdjustmentMinor = locked.vehicleAdjustmentMinor;
      delivery.packageAdjustmentMinor = locked.packageAdjustmentMinor;
      delivery.additionalPickupFeeMinor = locked.additionalPickupFeeMinor;
      delivery.demandMultiplierBps = locked.demandMultiplierBps;
      delivery.demandAdjustmentMinor = locked.demandAdjustmentMinor;
      delivery.waitingFeeMinor = locked.estimatedWaitingFeeMinor;
      delivery.routeDistanceMeters = locked.routeDistanceMeters;
      delivery.estimatedDurationSeconds = locked.estimatedDurationSeconds;
      delivery.pricingVersion = locked.pricingVersion;
    }
    // Discovery hides unverified providers and B2B suppliers; this backstops
    // direct-ID checkouts.
    const providerRow = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { status: true, categories: true },
    });
    if (providerRow?.status !== 'ACTIVE' || providerRow.categories.includes('SUPPLIER')) {
      throw AppError.badRequest('This merchant is not accepting orders right now.', 'PROVIDER_UNAVAILABLE');
    }
    const { subtotalMinor, taxMinor } = quote;
    const etaMin = quote.etaMinMinutes;
    const etaMax = quote.etaMaxMinutes;

    // Points redemption: the engine's cap is authoritative, whatever the client
    // asked for. Funded by Voryn, so the merchant's earnings are unaffected.
    const discountMinor = quote.discountMinor;
    const requestedPoints = input.pointsToRedeem ?? (input.redeemPoints ? Number.MAX_SAFE_INTEGER : 0);
    // Clamped to the engine's cap and rounded down to a whole redemption step.
    const pointsRedeemed = normaliseRequestedPoints(requestedPoints, quote.points);
    const pointsDiscountMinor = pointsToMinor(pointsRedeemed);

    const tipMinor = input.tipMinor ?? 0;
    const totalMinor = Math.max(
      0,
      subtotalMinor + deliveryFeeMinor + SERVICE_FEE_MINOR + taxMinor + tipMinor
        - discountMinor - pointsDiscountMinor,
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
        routeDistanceMeters: delivery.routeDistanceMeters,
        estimatedDurationSeconds: delivery.estimatedDurationSeconds,
        subtotalMinor,
        deliveryFeeMinor,
        serviceFeeMinor: SERVICE_FEE_MINOR,
        taxMinor,
        discountMinor,
        tipMinor,
        totalMinor,
        deliveryVehicle: delivery.vehicle,
        deliveryPackageClass: delivery.packageClass,
        vehicleAdjustmentMinor: delivery.vehicleAdjustmentMinor,
        packageAdjustmentMinor: delivery.packageAdjustmentMinor,
        additionalPickupFeeMinor: delivery.additionalPickupFeeMinor,
        demandMultiplierBps: delivery.demandMultiplierBps,
        demandAdjustmentMinor: delivery.demandAdjustmentMinor,
        waitingFeeMinor: delivery.waitingFeeMinor,
        deliveryQuoteId,
        deliveryPricingVersion: delivery.pricingVersion,
        pointsRedeemed,
        pointsDiscountMinor,
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

    // Spend the points now that the order exists to reference, and before any
    // money moves: the balance guard means concurrent checkouts cannot spend
    // the same points twice. Restored below if the payment fails.
    if (pointsRedeemed > 0) {
      const spent = await spendPoints({
        userId: input.customerId,
        points: pointsRedeemed,
        description: `Redeemed on order ${order.code}`,
        referenceType: 'order',
        referenceId: order.id,
      });
      if (!spent) throw AppError.badRequest('Not enough points to redeem.', 'INSUFFICIENT_POINTS');
    }

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
      if (pointsRedeemed > 0) {
        await restorePoints({
          userId: input.customerId,
          points: pointsRedeemed,
          description: 'Points returned after a failed payment',
          referenceType: 'order',
          referenceId: order.id,
        });
      }
      throw err;
    }

    const placed = await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PLACED, paymentId: payment.id, placedAt: new Date() },
      include: { items: true, provider: { select: { id: true, name: true, logoUrl: true } } },
    });

    if (pointsRedeemed > 0) {
      // The discount is financed by the rewards fund, not by this order's cash.
      await rewardsFund.record({
        type: 'REDEMPTION',
        amountMinor: -pointsDiscountMinor,
        description: `Points redeemed on ${placed.code}`,
        referenceType: 'order',
        referenceId: placed.id,
        idempotencyKey: `fund-redeem:order:${placed.id}`,
      });
    }

    await prisma.$transaction([
      prisma.cart.update({ where: { id: cart.id }, data: { isActive: false } }),
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

    // Points are issued now but held PENDING; they only become spendable when
    // the order completes, so a cancelled order never leaves points behind.
    const eligibleForPointsMinor = Math.max(0, subtotalMinor - discountMinor - pointsDiscountMinor);
    if (eligibleForPointsMinor > 0) {
      const priorOrders = await prisma.order.count({
        where: {
          customerId: input.customerId,
          status: { in: [OrderStatus.DELIVERED, OrderStatus.COMPLETED] },
        },
      });
      await issuePendingPoints({
        userId: input.customerId,
        eligibleMinor: eligibleForPointsMinor,
        category: providerRow.categories[0] ?? 'RESTAURANT',
        referenceType: 'order',
        referenceId: placed.id,
        code: placed.code,
        isFirstOrder: priorOrders === 0,
      });
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
    // First completion settles the money: merchant earning, courier payout,
    // customer points, full ledger breakdown. Idempotent across both statuses.
    if (status === OrderStatus.DELIVERED || status === OrderStatus.COMPLETED) {
      await settlementService.settleOrder(orderId);
    }
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
    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: { courier: { select: { user: { select: { id: true } } } } },
    });
    if (!order) throw AppError.notFound('Order not found');
    // Cancellation stage → fee (spec §16). Free while no courier is committed;
    // once a courier has accepted, a fee compensates them for wasted travel.
    // After collection it is no longer a self-service cancel (support review).
    const freeStages: OrderStatus[] = [
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.PLACED,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY_FOR_PICKUP,
    ];
    const cancellable: OrderStatus[] = [...freeStages, OrderStatus.COURIER_ASSIGNED];
    if (!cancellable.includes(order.status)) {
      throw AppError.badRequest(
        'This order can no longer be cancelled here. Contact support.',
        'NOT_CANCELLABLE',
      );
    }

    const stage =
      order.status === OrderStatus.COURIER_ASSIGNED ? 'COURIER_EN_ROUTE' : 'BEFORE_COURIER';
    // The fee can never exceed what the customer actually paid.
    const rawFeeMinor = cancellationFeeMinor(stage, order.deliveryFeeMinor);
    const cancelFeeMinor = Math.min(rawFeeMinor, order.totalMinor);

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.CANCELLED_BY_CUSTOMER, cancelReason: reason },
    });
    if (order.paymentId) {
      const refundMinor = Math.max(0, order.totalMinor - cancelFeeMinor);
      await refundPayment(order.paymentId, `Order ${order.code} cancelled`, refundMinor);
      // The retained fee compensates the courier for the trip already started.
      if (cancelFeeMinor > 0 && order.courier?.user.id) {
        await walletService.credit({
          userId: order.courier.user.id,
          amountMinor: cancelFeeMinor,
          type: WalletEntryType.PAYOUT,
          description: `Cancellation compensation • ${order.code}`,
          referenceType: 'delivery',
          referenceId: order.id,
          idempotencyKey: `cancel-fee:delivery:${order.id}`,
        });
      }
    }
    // A fully cancelled order gives back the points it spent, and takes back
    // any it awarded (rare: cancelling after delivery), which may leave the
    // account in deficit rather than blocking the customer's cash refund.
    if (order.pointsRedeemed > 0) {
      await restorePoints({
        userId: order.customerId,
        points: order.pointsRedeemed,
        description: `Points restored from cancelled order ${order.code}`,
        referenceType: 'order',
        referenceId: order.id,
      });
      await rewardsFund.record({
        type: 'REDEMPTION',
        amountMinor: order.pointsDiscountMinor,
        description: `Redemption reversed on cancelled ${order.code}`,
        referenceType: 'order',
        referenceId: order.id,
        idempotencyKey: `fund-redeem-reversal:order:${order.id}`,
      });
    }
    // Points not yet released simply vanish; points already released have to be
    // clawed back, which may leave the account in deficit rather than blocking
    // the customer's cash refund.
    await voidPendingPoints({ userId: order.customerId, referenceType: 'order', referenceId: order.id });
    if (order.pointsEarned > 0) {
      await reverseEarnedPoints({
        userId: order.customerId,
        points: order.pointsEarned,
        description: `Points reversed on cancelled order ${order.code}`,
        referenceType: 'order',
        referenceId: order.id,
      });
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

  /**
   * Destination change after checkout (spec §15). Reprices the delivery leg for
   * the new drop-off and returns the additional charge, which is never less
   * than JMD 200 for an approved change. With `confirm: false` this only quotes
   * the change; with `confirm: true` it charges the delta and moves the order.
   * The customer must approve before the courier continues.
   */
  async changeDestination(input: {
    orderId: string;
    customerId: string;
    addressId: string;
    confirm?: boolean;
  }) {
    const order = await prisma.order.findFirst({
      where: { id: input.orderId, customerId: input.customerId },
      include: {
        courier: { select: { user: { select: { id: true } } } },
        payment: { select: { methodType: true } },
        provider: { select: { name: true } },
      },
    });
    if (!order) throw AppError.notFound('Order not found');
    const changeable: OrderStatus[] = [
      OrderStatus.PLACED,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.COURIER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_THE_WAY,
    ];
    if (!changeable.includes(order.status)) {
      throw AppError.badRequest('The destination can no longer be changed.', 'NOT_CHANGEABLE');
    }

    const address = await prisma.address.findFirst({
      where: { id: input.addressId, userId: input.customerId },
    });
    if (!address) throw AppError.notFound('Delivery address not found');

    const requote = await deliveryQuote(
      { restaurantId: order.restaurantId, storeId: order.storeId },
      { lat: address.latitude, lng: address.longitude },
      { vehicle: (order.deliveryVehicle as never) ?? undefined },
    );
    if (requote.outOfZone) throw AppError.badRequest(OUT_OF_ZONE_MESSAGE, 'OUT_OF_DELIVERY_ZONE');

    const oldFeeMinor = order.deliveryFeeMinor;
    const newFeeMinor = requote.deliveryFeeMinor;
    // An approved change always adds at least the destination-change floor.
    const additionalMinor = Math.max(newFeeMinor - oldFeeMinor, MIN_DESTINATION_CHANGE_MINOR);

    const preview = {
      orderId: order.id,
      code: order.code,
      oldFeeMinor,
      newFeeMinor,
      additionalMinor,
      newDistanceKm: requote.distanceKm,
      addressName: `${address.name} • ${address.line1}`,
    };
    if (!input.confirm) return { ...preview, confirmed: false };

    if (order.paymentId && additionalMinor > 0) {
      await takePayment({
        userId: input.customerId,
        methodType: order.payment?.methodType ?? PaymentMethodType.VORYN_WALLET,
        amountMinor: additionalMinor,
        referenceType: 'order',
        referenceId: order.id,
        description: `Destination change • ${order.code}`,
        counterpartyName: order.provider?.name ?? 'Voryn',
        idempotencyKey: `dest-change:${order.id}:${address.id}`,
      });
    }

    // The revised fee = old fee + the approved additional charge, so the courier
    // is paid for the extra distance.
    const revisedFeeMinor = oldFeeMinor + additionalMinor;
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        deliveryAddressName: preview.addressName,
        deliveryLat: address.latitude,
        deliveryLng: address.longitude,
        deliveryInstructions: address.instructions,
        distanceKm: requote.distanceKm,
        routeDistanceMeters: requote.routeDistanceMeters,
        estimatedDurationSeconds: requote.estimatedDurationSeconds,
        deliveryFeeMinor: revisedFeeMinor,
        totalMinor: { increment: additionalMinor },
      },
    });

    await recordTrackingEvent({
      subjectType: 'ORDER',
      subjectId: order.id,
      status: order.status,
      label: 'Delivery address changed',
      metadata: { additionalMinor, newDistanceKm: requote.distanceKm },
    });
    if (order.courier?.user.id) {
      await prisma.notification.create({
        data: {
          userId: order.courier.user.id,
          type: 'ORDER_UPDATE',
          title: 'Delivery address changed',
          body: `The drop-off for ${order.code} was updated. Follow the new destination in the app.`,
        },
      });
    }
    return { ...preview, confirmed: true, order: updated };
  },
};
