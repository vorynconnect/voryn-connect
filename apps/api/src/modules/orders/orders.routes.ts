import { Router } from 'express';
import { z } from 'zod';
import { PaymentMethodType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ordersService } from './orders.service';
import { liveEta } from '../rides/eta.service';
import { listTrackingEvents } from '../tracking/tracking.service';
import { simulateOrderFulfillment } from '../simulation/fulfillment.simulator';

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const ACTIVE_ORDER = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'COURIER_ASSIGNED', 'PICKED_UP', 'ON_THE_WAY'];
const ACTIVE_BOOKING = ['BOOKED', 'ACCEPTED', 'ON_THE_WAY', 'IN_SERVICE'];
const ACTIVE_RIDE = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_PROGRESS'];
const ACTIVE_RENTAL = ['CONFIRMED', 'ACTIVE', 'EXTENDED', 'RETURN_PENDING'];

/**
 * Unified activity feed for the Orders tab: delivery orders, service
 * bookings, ride trips, and rental reservations in one normalized shape.
 */
ordersRouter.get('/', async (req, res, next) => {
  try {
    const customerId = req.auth!.sub;
    const [orders, bookings, trips, rentals] = await Promise.all([
      prisma.order.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { provider: { select: { id: true, name: true, logoUrl: true } }, items: true },
      }),
      prisma.serviceBooking.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          provider: { select: { id: true, name: true, logoUrl: true } },
          appointment: true,
        },
      }),
      prisma.rideTrip.findMany({
        where: { request: { customerId } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          request: true,
          driver: { include: { user: { select: { fullName: true } } } },
        },
      }),
      prisma.rentalReservation.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          provider: { select: { id: true, name: true, logoUrl: true } },
          vehicle: true,
        },
      }),
    ]);

    type Item = {
      kind: 'order' | 'booking' | 'ride' | 'rental';
      id: string;
      code: string;
      title: string;
      subtitle: string;
      status: string;
      bucket: 'active' | 'completed' | 'scheduled' | 'cancelled';
      totalMinor: number;
      logoUrl: string | null;
      createdAt: Date;
      etaLabel?: string;
    };

    const bucketOf = (status: string, activeSet: string[], scheduled?: boolean): Item['bucket'] => {
      if (status.startsWith('CANCELLED') || status === 'NO_SHOW' || status === 'NO_DRIVER_AVAILABLE') return 'cancelled';
      if (scheduled) return 'scheduled';
      if (activeSet.includes(status)) return 'active';
      return 'completed';
    };

    const items: Item[] = [
      ...orders.map((o): Item => ({
        kind: 'order',
        id: o.id,
        code: o.code,
        title: o.provider.name,
        subtitle: 'Delivery',
        status: o.status,
        bucket: bucketOf(o.status, ACTIVE_ORDER, Boolean(o.scheduledFor && o.status === 'PLACED')),
        totalMinor: o.totalMinor,
        logoUrl: o.provider.logoUrl,
        createdAt: o.createdAt,
        etaLabel: o.etaMinMinutes && o.etaMaxMinutes ? `${o.etaMinMinutes}–${o.etaMaxMinutes} min` : undefined,
      })),
      ...bookings.map((b): Item => ({
        kind: 'booking',
        id: b.id,
        code: b.code,
        title: b.provider.name,
        subtitle:
          b.vertical === 'AUTO_CARE' ? 'Auto Care' : b.vertical === 'TECHNICIAN' ? 'Technicians' : 'Home Services',
        status: b.status,
        bucket: bucketOf(
          b.status,
          ACTIVE_BOOKING,
          Boolean(b.appointment && b.appointment.scheduledAt > new Date() && b.status === 'BOOKED'),
        ),
        totalMinor: b.totalMinor,
        logoUrl: b.provider.logoUrl,
        createdAt: b.createdAt,
      })),
      ...trips.map((t): Item => ({
        kind: 'ride',
        id: t.id,
        code: t.code,
        title: t.driver.user.fullName,
        subtitle: 'Ride',
        status: t.status,
        bucket: bucketOf(t.status, ACTIVE_RIDE),
        totalMinor: t.totalMinor || t.request.estimateMinor,
        logoUrl: null,
        createdAt: t.createdAt,
      })),
      ...rentals.map((r): Item => ({
        kind: 'rental',
        id: r.id,
        code: r.code,
        title: r.provider.name,
        subtitle: `Rental • ${r.vehicle.make} ${r.vehicle.model}`,
        status: r.status,
        bucket: bucketOf(r.status, ACTIVE_RENTAL, r.status === 'CONFIRMED' && r.pickupAt > new Date()),
        totalMinor: r.totalMinor,
        logoUrl: r.provider.logoUrl,
        createdAt: r.createdAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const counts = {
      active: items.filter((i) => i.bucket === 'active').length,
      completed: items.filter((i) => i.bucket === 'completed').length,
      scheduled: items.filter((i) => i.bucket === 'scheduled').length,
      cancelled: items.filter((i) => i.bucket === 'cancelled').length,
    };

    res.json({ items, counts });
  } catch (err) {
    next(err);
  }
});

ordersRouter.post(
  '/checkout',
  validate({
    body: z.object({
      addressId: z.string(),
      paymentMethodType: z.nativeEnum(PaymentMethodType),
      tipMinor: z.number().int().min(0).optional(),
      pointsToRedeem: z.number().int().min(0).max(1_000_000).optional(),
      redeemPoints: z.boolean().optional(),
      deliveryQuoteId: z.string().optional(),
      idempotencyKey: z.string().min(8).max(128),
    }),
  }),
  async (req, res, next) => {
    try {
      const result = await ordersService.checkout({ customerId: req.auth!.sub, ...req.body });
      // Kick off the dev fulfillment simulator (real provider actions in prod).
      void simulateOrderFulfillment(result.order.id);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/** Live checkout quote for the active cart — same math the charge will use. */
ordersRouter.get(
  '/quote',
  validate({ query: z.object({ addressId: z.string().optional() }) }),
  async (req, res, next) => {
    try {
      const quote = await ordersService.quote(
        req.auth!.sub,
        req.query.addressId as string | undefined,
        undefined,
        { persistQuote: true },
      );
      res.json({
        quote: {
          // Signed quote the client passes back at checkout to lock this price.
          deliveryQuoteId: quote.deliveryQuoteId,
          deliveryQuoteExpiresAt: quote.deliveryQuoteExpiresAt,
          pricingVersion: quote.pricingVersion,
          addressId: quote.address?.id ?? null,
          merchantName: quote.merchantName,
          distanceKm: quote.distanceKm,
          routeDistanceMeters: quote.routeDistanceMeters,
          estimatedDurationSeconds: quote.estimatedDurationSeconds,
          baseFeeMinor: quote.baseFeeMinor,
          distanceFeeMinor: quote.distanceFeeMinor,
          deliveryFeeMinor: quote.deliveryFeeMinor,
          // Delivery fee breakdown (spec §18).
          vehicle: quote.vehicle,
          vehicleAdjustmentMinor: quote.vehicleAdjustmentMinor,
          packageClass: quote.packageClass,
          packageAdjustmentMinor: quote.packageAdjustmentMinor,
          additionalPickupFeeMinor: quote.additionalPickupFeeMinor,
          demandMultiplierBps: quote.demandMultiplierBps,
          demandAdjustmentMinor: quote.demandAdjustmentMinor,
          waitingFeeMinor: quote.waitingFeeMinor,
          subtotalMinor: quote.subtotalMinor,
          serviceFeeMinor: quote.serviceFeeMinor,
          taxMinor: quote.taxMinor,
          discountMinor: quote.discountMinor,
          totalBeforeTipMinor: quote.totalBeforeTipMinor,
          etaMinMinutes: quote.etaMinMinutes,
          etaMaxMinutes: quote.etaMaxMinutes,
          outOfZone: quote.outOfZone,
          maxDeliveryKm: quote.maxDeliveryKm,
          // Transparency: the delivery person's guaranteed share of the fee (plus 100% of tips).
          courierCommissionBps: quote.courierCommissionBps,
          courierPayMinor: quote.estimatedCourierEarningMinor,
          points: quote.points,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

ordersRouter.post(
  '/:id/tip',
  validate({ body: z.object({ tipMinor: z.number().int().min(1000).max(1_000_000) }) }),
  async (req, res, next) => {
    try {
      const order = await ordersService.addTip(req.params.id!, req.auth!.sub, req.body.tipMinor);
      res.json({ order });
    } catch (err) {
      next(err);
    }
  },
);

ordersRouter.get('/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, customerId: req.auth!.sub },
      include: {
        items: true,
        provider: { select: { id: true, name: true, logoUrl: true } },
        courier: {
          include: {
            user: { select: { fullName: true, customerProfile: { select: { avatarUrl: true } } } },
          },
        },
        payment: true,
      },
    });
    if (!order) throw AppError.notFound('Order not found');
    const events = await listTrackingEvents('ORDER', order.id);
    const lastLocation = await prisma.liveLocation.findFirst({
      where: { subjectType: 'ORDER', subjectId: order.id },
      orderBy: { recordedAt: 'desc' },
    });
    const branch = await prisma.providerBranch.findFirst({
      where: { providerId: order.providerId, isActive: true },
      orderBy: { isPrimary: 'desc' },
      select: { latitude: true, longitude: true },
    });
    // Live courier ETA: → merchant until pickup, → customer once moving.
    const courierTarget =
      order.status === 'COURIER_ASSIGNED'
        ? branch
          ? { latitude: branch.latitude, longitude: branch.longitude }
          : null
        : order.deliveryLat != null && order.deliveryLng != null
          ? { latitude: order.deliveryLat, longitude: order.deliveryLng }
          : null;
    const courierOngoing = ['COURIER_ASSIGNED', 'PICKED_UP', 'ON_THE_WAY'].includes(order.status);
    const eta = courierOngoing && courierTarget ? await liveEta('ORDER', order.id, courierTarget) : null;
    res.json({
      order,
      events,
      courierLocation: lastLocation,
      merchantPoint: branch ? { latitude: branch.latitude, longitude: branch.longitude } : null,
      eta,
    });
  } catch (err) {
    next(err);
  }
});

ordersRouter.post(
  '/:id/cancel',
  validate({ body: z.object({ reason: z.string().max(300).default('Cancelled by customer') }) }),
  async (req, res, next) => {
    try {
      const order = await ordersService.cancel(req.params.id!, req.auth!.sub, req.body.reason);
      res.json({ order });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Reprice the delivery for a new drop-off (spec §15). Omit `confirm` to preview
 * the additional charge; pass `confirm: true` to accept it and move the order.
 */
ordersRouter.post(
  '/:id/change-destination',
  validate({ body: z.object({ addressId: z.string(), confirm: z.boolean().optional() }) }),
  async (req, res, next) => {
    try {
      const result = await ordersService.changeDestination({
        orderId: req.params.id!,
        customerId: req.auth!.sub,
        addressId: req.body.addressId,
        confirm: req.body.confirm,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
