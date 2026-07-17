import { Router } from 'express';
import { z } from 'zod';
import { OrderStatus, RideStatus, WalletEntryType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { GEOFENCE, checkGeofence, detectSpeedAnomaly } from '../../lib/geofence';
import { validate } from '../../middleware/validate';
import { recordLiveLocation, recordTrackingEvent } from '../tracking/tracking.service';
import { currentSearchStage } from '../rides/dispatch.service';
import { liveEta } from '../rides/eta.service';
import { haversineKm } from '../../lib/pricing';
import { env } from '../../config/env';
import { ridesService } from '../rides/rides.service';
import { ordersService } from '../orders/orders.service';
import { walletService } from '../wallet/wallet.service';
import { requireDriver } from './driver.middleware';

export const driverRouter = Router();
driverRouter.use(requireDriver);

/**
 * Payout policy: the platform keeps the service fee; everything else on the
 * fare goes to the driver. Couriers earn the delivery fee plus tip. Credits
 * land on the driver's wallet ledger with an idempotency key per trip, so a
 * retried completion can never double-pay.
 */
async function ensureWallet(userId: string) {
  await prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
  await prisma.loyaltyAccount.upsert({ where: { userId }, create: { userId }, update: {} });
}

async function creditPayout(userId: string, amountMinor: number, code: string, kind: 'ride' | 'delivery', refId: string) {
  if (amountMinor <= 0) return;
  await ensureWallet(userId);
  await walletService.credit({
    userId,
    amountMinor,
    type: WalletEntryType.PAYOUT,
    description: `Trip payout • ${code}`,
    referenceType: kind,
    referenceId: refId,
    idempotencyKey: `driver-payout:${kind}:${refId}`,
  });
}

const startOfToday = () => new Date(new Date().toDateString());

/** Aggregated earnings rows for this user's driver/courier work. */
async function earningRows(ctx: { driverId?: string; courierId?: string }) {
  const [trips, orders] = await Promise.all([
    ctx.driverId
      ? prisma.rideTrip.findMany({
          where: { driverId: ctx.driverId, status: RideStatus.COMPLETED },
          select: { id: true, code: true, totalMinor: true, serviceFeeMinor: true, tipMinor: true, completedAt: true, updatedAt: true },
        })
      : [],
    ctx.courierId
      ? prisma.order.findMany({
          where: { courierId: ctx.courierId, status: { in: [OrderStatus.DELIVERED, OrderStatus.COMPLETED] } },
          select: { id: true, code: true, deliveryFeeMinor: true, tipMinor: true, deliveredAt: true, updatedAt: true },
        })
      : [],
  ]);
  const rows = [
    ...trips.map((t) => ({
      kind: 'ride' as const,
      code: t.code,
      earnedMinor: t.totalMinor - t.serviceFeeMinor,
      tipMinor: t.tipMinor,
      when: t.completedAt ?? t.updatedAt,
    })),
    ...orders.map((o) => ({
      kind: 'delivery' as const,
      code: o.code,
      earnedMinor: o.deliveryFeeMinor + o.tipMinor,
      tipMinor: o.tipMinor,
      when: o.deliveredAt ?? o.updatedAt,
    })),
  ];
  return rows.sort((a, b) => b.when.getTime() - a.when.getTime());
}

// ── Identity & status ────────────────────────────────────────

driverRouter.get('/me', async (req, res, next) => {
  try {
    const { driverProfile, courierProfile } = req.driver!;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.auth!.sub },
      include: { customerProfile: { select: { avatarUrl: true } } },
    });
    await ensureWallet(user.id);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        avatarInitials: user.fullName.slice(0, 1),
        avatarUrl: user.customerProfile?.avatarUrl ?? null,
      },
      driver: driverProfile,
      courier: courierProfile,
      isOnline: Boolean(driverProfile?.isOnline || courierProfile?.isOnline),
      walletBalanceMinor: wallet.balanceMinor,
      memberSince: user.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

driverRouter.post(
  '/status',
  validate({ body: z.object({ isOnline: z.boolean() }) }),
  async (req, res, next) => {
    try {
      const { driverProfile, courierProfile } = req.driver!;
      const { isOnline } = req.body;
      if (driverProfile) {
        await prisma.driverProfile.update({ where: { id: driverProfile.id }, data: { isOnline } });
      }
      if (courierProfile) {
        await prisma.courierProfile.update({ where: { id: courierProfile.id }, data: { isOnline } });
      }
      res.json({ isOnline });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Presence ping — the driver app sends real GPS while online so dispatch,
 * pickup ETAs and the customer's nearby-driver map work from live positions.
 * Identity comes from the session; the body carries only the fix itself.
 */
driverRouter.post(
  '/location',
  validate({
    body: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      heading: z.number().min(0).max(360).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { driverProfile, courierProfile } = req.driver!;
      if (!driverProfile && !courierProfile) {
        res.status(202).json({ recorded: false });
        return;
      }
      const fix = {
        lastLat: req.body.latitude,
        lastLng: req.body.longitude,
        lastHeading: req.body.heading ?? null,
        lastLocationAt: new Date(),
      };
      await Promise.all([
        driverProfile
          ? prisma.driverProfile.update({ where: { id: driverProfile.id }, data: fix })
          : Promise.resolve(),
        courierProfile
          ? prisma.courierProfile.update({ where: { id: courierProfile.id }, data: fix })
          : Promise.resolve(),
      ]);
      res.status(202).json({ recorded: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── Dashboard stats ──────────────────────────────────────────

driverRouter.get('/dashboard', async (req, res, next) => {
  try {
    const { driverProfile, courierProfile } = req.driver!;
    const rows = await earningRows({ driverId: driverProfile?.id, courierId: courierProfile?.id });
    const today = rows.filter((r) => r.when >= startOfToday());

    const [offered, accepted, pendingRides, pendingDeliveries] = await Promise.all([
      driverProfile ? prisma.rideOffer.count({ where: { driverId: driverProfile.id } }) : 0,
      driverProfile ? prisma.rideOffer.count({ where: { driverId: driverProfile.id, status: 'ACCEPTED' } }) : 0,
      driverProfile ? prisma.rideRequest.count({ where: { status: RideStatus.SEARCHING } }) : 0,
      courierProfile
        ? prisma.order.count({ where: { status: OrderStatus.READY_FOR_PICKUP, courierId: null, type: 'DELIVERY' } })
        : 0,
    ]);

    res.json({
      stats: {
        todayEarningsMinor: today.reduce((s, r) => s + r.earnedMinor, 0),
        completedToday: today.length,
        acceptanceRate: offered > 0 ? Math.round((accepted / offered) * 100) : null,
        ratingAvg: driverProfile?.ratingAvg ?? courierProfile?.ratingAvg ?? 0,
        ratingCount: driverProfile?.ratingCount ?? courierProfile?.ratingCount ?? 0,
        tripsCount: (driverProfile?.tripsCount ?? 0) + 0,
      },
      pendingRequests: pendingRides + pendingDeliveries,
      isOnline: Boolean(driverProfile?.isOnline || courierProfile?.isOnline),
    });
  } catch (err) {
    next(err);
  }
});

// ── Available requests (rides for drivers, deliveries for couriers) ──

driverRouter.get('/requests', async (req, res, next) => {
  try {
    const { driverProfile, courierProfile } = req.driver!;
    // A ride reaches this driver only when its expanding search radius covers
    // the driver's live position, the categories match, and the search window
    // is still open — the feed mirrors real dispatch, not every open request.
    const presenceFresh =
      driverProfile?.lastLat != null &&
      driverProfile.lastLng != null &&
      driverProfile.lastLocationAt != null &&
      Date.now() - driverProfile.lastLocationAt.getTime() <
        env.DRIVER_PRESENCE_DISPATCH_FRESH_SECONDS * 1000;
    const [openRides, deliveries] = await Promise.all([
      driverProfile && presenceFresh
        ? prisma.rideRequest.findMany({
            where: { status: RideStatus.SEARCHING, category: driverProfile.rideCategory },
            include: { customer: { select: { fullName: true, customerProfile: { select: { avatarUrl: true } } } } },
            orderBy: { createdAt: 'asc' },
            take: 25,
          })
        : [],
      courierProfile
        ? prisma.order.findMany({
            where: { status: OrderStatus.READY_FOR_PICKUP, courierId: null, type: 'DELIVERY' },
            include: {
              customer: { select: { fullName: true, customerProfile: { select: { avatarUrl: true } } } },
              provider: PROVIDER_SELECT,
              items: { select: { name: true, quantity: true } },
            },
            orderBy: { createdAt: 'asc' },
            take: 10,
          })
        : [],
    ]);

    const rides = openRides
      .filter((r) => {
        const stage = currentSearchStage(r.createdAt);
        if (stage.expired) return false;
        const distanceKm = haversineKm(r.pickupLat, r.pickupLng, driverProfile!.lastLat!, driverProfile!.lastLng!);
        return distanceKm <= stage.radiusKm;
      })
      .slice(0, 10);

    // With a fresh fix we hide pickups the courier can't realistically reach;
    // without one (GPS denied/flaky) the feed stays open — deliveries are
    // pull-based claims, so an unreachable job simply goes unclaimed.
    const courierFresh =
      courierProfile?.lastLat != null &&
      courierProfile.lastLng != null &&
      courierProfile.lastLocationAt != null &&
      Date.now() - courierProfile.lastLocationAt.getTime() <
        env.DRIVER_PRESENCE_DISPATCH_FRESH_SECONDS * 1000;
    const reachableDeliveries = courierFresh
      ? deliveries.filter((o) => {
          const branch = o.provider.branches[0];
          if (!branch) return true;
          return (
            haversineKm(branch.latitude, branch.longitude, courierProfile!.lastLat!, courierProfile!.lastLng!) <=
            env.COURIER_DISPATCH_RADIUS_KM
          );
        })
      : deliveries;

    res.json({
      requests: [
        ...rides.map((r) => ({
          kind: 'ride' as const,
          id: r.id,
          customerName: r.customer.fullName,
          customerAvatarUrl: r.customer.customerProfile?.avatarUrl ?? null,
          pickupName: r.pickupName,
          pickupLat: r.pickupLat,
          pickupLng: r.pickupLng,
          dropoffName: r.dropoffName,
          dropoffLat: r.dropoffLat,
          dropoffLng: r.dropoffLng,
          distanceKm: r.distanceKm ?? 0,
          estimateMinor: r.estimateMinor,
          category: r.category,
          paymentMethodType: r.paymentMethodType,
          createdAt: r.createdAt,
        })),
        ...reachableDeliveries.map((o) => ({
          kind: 'delivery' as const,
          id: o.id,
          customerName: o.customer.fullName,
          customerAvatarUrl: o.customer.customerProfile?.avatarUrl ?? null,
          pickupName: o.provider.name,
          pickupLat: o.provider.branches[0]?.latitude ?? null,
          pickupLng: o.provider.branches[0]?.longitude ?? null,
          dropoffName: o.deliveryAddressName ?? 'Customer address',
          dropoffLat: o.deliveryLat,
          dropoffLng: o.deliveryLng,
          distanceKm: o.distanceKm,
          estimateMinor: o.deliveryFeeMinor + o.tipMinor,
          itemsSummary: o.items.map((i) => `${i.quantity}× ${i.name}`).join(', '),
          createdAt: o.createdAt,
        })),
      ],
    });
  } catch (err) {
    next(err);
  }
});

driverRouter.post(
  '/requests/:id/accept',
  validate({ body: z.object({ kind: z.enum(['ride', 'delivery']) }) }),
  async (req, res, next) => {
    try {
      const { driverProfile, courierProfile } = req.driver!;

      if (req.body.kind === 'ride') {
        if (!driverProfile) throw AppError.forbidden('Ride requests need a driver profile.');
        const { trip, pickup } = await prisma.$transaction(async (tx) => {
          const request = await tx.rideRequest.findUnique({ where: { id: req.params.id } });
          if (!request) throw AppError.notFound('Ride request not found');
          if (request.status !== RideStatus.SEARCHING) {
            throw AppError.conflict('Another driver already took this request.', 'ALREADY_TAKEN');
          }
          const { orderCode, pickupCode } = await import('../../lib/codes');
          const created = await tx.rideTrip.create({
            data: {
              code: orderCode('VC'),
              requestId: request.id,
              driverId: driverProfile.id,
              status: RideStatus.DRIVER_ASSIGNED,
              pickupCode: pickupCode(),
            },
          });
          await tx.rideRequest.update({
            where: { id: request.id },
            data: { status: RideStatus.DRIVER_ASSIGNED },
          });
          await tx.rideOffer.upsert({
            where: { requestId_driverId: { requestId: request.id, driverId: driverProfile.id } },
            create: { requestId: request.id, driverId: driverProfile.id, status: 'ACCEPTED', expiresAt: new Date() },
            update: { status: 'ACCEPTED' },
          });
          return { trip: created, pickup: { lat: request.pickupLat, lng: request.pickupLng } };
        });
        const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
        await recordTrackingEvent({
          subjectType: 'RIDE',
          subjectId: trip.id,
          status: RideStatus.DRIVER_ASSIGNED,
          label: `${user.fullName} is your driver`,
        });
        // Seed the driver a few blocks from pickup so the customer's map shows
        // the car immediately; live GPS pings replace this within seconds.
        await recordLiveLocation({
          subjectType: 'RIDE',
          subjectId: trip.id,
          actorUserId: req.auth!.sub,
          latitude: pickup.lat + 0.006,
          longitude: pickup.lng + 0.004,
        });
        res.status(201).json({ kind: 'ride', tripId: trip.id });
        return;
      }

      if (!courierProfile) throw AppError.forbidden('Delivery requests need a courier profile.');
      const claimed = await prisma.order.updateMany({
        where: { id: req.params.id, status: OrderStatus.READY_FOR_PICKUP, courierId: null },
        data: { courierId: courierProfile.id, status: OrderStatus.COURIER_ASSIGNED },
      });
      if (claimed.count === 0) {
        throw AppError.conflict('Another courier already took this delivery.', 'ALREADY_TAKEN');
      }
      await recordTrackingEvent({
        subjectType: 'ORDER',
        subjectId: req.params.id!,
        status: OrderStatus.COURIER_ASSIGNED,
        label: 'Courier assigned to your order',
      });
      const order = await prisma.order.findUnique({ where: { id: req.params.id }, select: { providerId: true } });
      const branch = order
        ? await prisma.providerBranch.findFirst({
            where: { providerId: order.providerId, isActive: true },
            orderBy: { isPrimary: 'desc' },
            select: { latitude: true, longitude: true },
          })
        : null;
      if (branch) {
        // Courier starts out near the merchant; live GPS pings take over from here.
        await recordLiveLocation({
          subjectType: 'ORDER',
          subjectId: req.params.id!,
          actorUserId: req.auth!.sub,
          latitude: branch.latitude + 0.003,
          longitude: branch.longitude + 0.002,
        });
      }
      res.status(201).json({ kind: 'delivery', tripId: req.params.id });
    } catch (err) {
      next(err);
    }
  },
);

driverRouter.post(
  '/requests/:id/decline',
  validate({ body: z.object({ kind: z.enum(['ride', 'delivery']) }) }),
  async (req, res, next) => {
    try {
      const { driverProfile } = req.driver!;
      if (req.body.kind === 'ride' && driverProfile) {
        await prisma.rideOffer.upsert({
          where: { requestId_driverId: { requestId: req.params.id!, driverId: driverProfile.id } },
          create: { requestId: req.params.id!, driverId: driverProfile.id, status: 'DECLINED', expiresAt: new Date() },
          update: { status: 'DECLINED' },
        });
      }
      res.json({ declined: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── Trips (unified rides + deliveries) ───────────────────────

const RIDE_ONGOING: RideStatus[] = [
  RideStatus.DRIVER_ASSIGNED,
  RideStatus.DRIVER_ARRIVING,
  RideStatus.ARRIVED,
  RideStatus.IN_PROGRESS,
];
const ORDER_ONGOING: OrderStatus[] = [
  OrderStatus.COURIER_ASSIGNED,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
];

function rideView(t: {
  id: string;
  code: string;
  status: RideStatus;
  pickupCode?: string;
  totalMinor: number;
  serviceFeeMinor: number;
  createdAt: Date;
  completedAt: Date | null;
  request: {
    pickupName: string;
    pickupLat: number;
    pickupLng: number;
    dropoffName: string;
    dropoffLat: number;
    dropoffLng: number;
    distanceKm: number | null;
    estimateMinor: number;
    paymentMethodType: string;
    customer: { fullName: string; phone?: string | null; customerProfile?: { avatarUrl: string | null } | null };
  };
}) {
  return {
    kind: 'ride' as const,
    id: t.id,
    code: t.code,
    status: t.status,
    customerName: t.request.customer.fullName,
    customerPhone: t.request.customer.phone ?? null,
    customerAvatarUrl: t.request.customer.customerProfile?.avatarUrl ?? null,
    pickupName: t.request.pickupName,
    pickupLat: t.request.pickupLat,
    pickupLng: t.request.pickupLng,
    dropoffName: t.request.dropoffName,
    dropoffLat: t.request.dropoffLat,
    dropoffLng: t.request.dropoffLng,
    distanceKm: t.request.distanceKm,
    estimateMinor: t.request.estimateMinor,
    earningsMinor: t.status === RideStatus.COMPLETED ? t.totalMinor - t.serviceFeeMinor : null,
    paymentLabel: t.request.paymentMethodType === 'VORYN_WALLET' ? 'Wallet' : t.request.paymentMethodType === 'CARD' ? 'Card' : 'Cash',
    pickupCode: t.pickupCode,
    when: t.completedAt ?? t.createdAt,
  };
}

function deliveryView(o: {
  id: string;
  code: string;
  status: OrderStatus;
  deliveryAddressName: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  distanceKm: number | null;
  deliveryFeeMinor: number;
  tipMinor: number;
  createdAt: Date;
  deliveredAt: Date | null;
  customer: { fullName: string; phone?: string | null; customerProfile?: { avatarUrl: string | null } | null };
  provider: { name: string; branches?: Array<{ latitude: number; longitude: number }> };
  items?: Array<{ name: string; quantity: number }>;
}) {
  return {
    kind: 'delivery' as const,
    id: o.id,
    code: o.code,
    status: o.status,
    customerName: o.customer.fullName,
    customerPhone: o.customer.phone ?? null,
    customerAvatarUrl: o.customer.customerProfile?.avatarUrl ?? null,
    pickupName: o.provider.name,
    pickupLat: o.provider.branches?.[0]?.latitude ?? null,
    pickupLng: o.provider.branches?.[0]?.longitude ?? null,
    dropoffName: o.deliveryAddressName ?? 'Customer address',
    dropoffLat: o.deliveryLat,
    dropoffLng: o.deliveryLng,
    distanceKm: o.distanceKm,
    estimateMinor: o.deliveryFeeMinor + o.tipMinor,
    earningsMinor:
      o.status === OrderStatus.DELIVERED || o.status === OrderStatus.COMPLETED
        ? o.deliveryFeeMinor + o.tipMinor
        : null,
    paymentLabel: 'Delivery fee',
    itemsSummary: (o.items ?? []).map((i) => `${i.quantity}× ${i.name}`).join(', '),
    when: o.deliveredAt ?? o.createdAt,
  };
}

const CUSTOMER_SELECT = {
  select: { fullName: true, phone: true, customerProfile: { select: { avatarUrl: true } } },
} as const;
const PROVIDER_SELECT = {
  select: {
    name: true,
    branches: {
      where: { isActive: true },
      orderBy: { isPrimary: 'desc' },
      take: 1,
      select: { latitude: true, longitude: true },
    },
  },
} as const;
const RIDE_INCLUDE = { request: { include: { customer: CUSTOMER_SELECT } } };
const DELIVERY_INCLUDE = {
  customer: CUSTOMER_SELECT,
  provider: PROVIDER_SELECT,
  items: { select: { name: true, quantity: true } },
};

driverRouter.get(
  '/trips',
  validate({ query: z.object({ bucket: z.enum(['ongoing', 'scheduled', 'history']).default('ongoing') }) }),
  async (req, res, next) => {
    try {
      const { driverProfile, courierProfile } = req.driver!;
      const bucket = req.query.bucket as 'ongoing' | 'scheduled' | 'history';

      const rideStatuses =
        bucket === 'ongoing'
          ? RIDE_ONGOING
          : bucket === 'history'
            ? [RideStatus.COMPLETED, RideStatus.CANCELLED_BY_CUSTOMER, RideStatus.CANCELLED_BY_DRIVER]
            : [];
      const orderStatuses =
        bucket === 'ongoing'
          ? ORDER_ONGOING
          : bucket === 'history'
            ? [OrderStatus.DELIVERED, OrderStatus.COMPLETED, OrderStatus.CANCELLED_BY_CUSTOMER, OrderStatus.CANCELLED_BY_MERCHANT]
            : [];

      const [trips, orders] = await Promise.all([
        driverProfile && rideStatuses.length
          ? prisma.rideTrip.findMany({
              where: { driverId: driverProfile.id, status: { in: rideStatuses } },
              include: RIDE_INCLUDE,
              orderBy: { createdAt: 'desc' },
              take: 30,
            })
          : [],
        courierProfile && orderStatuses.length
          ? prisma.order.findMany({
              where: { courierId: courierProfile.id, status: { in: orderStatuses } },
              include: DELIVERY_INCLUDE,
              orderBy: { createdAt: 'desc' },
              take: 30,
            })
          : [],
      ]);

      const items = [...trips.map(rideView), ...orders.map(deliveryView)].sort(
        (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
      );
      res.json({ trips: items });
    } catch (err) {
      next(err);
    }
  },
);

driverRouter.get(
  '/trips/:id',
  validate({ query: z.object({ kind: z.enum(['ride', 'delivery']) }) }),
  async (req, res, next) => {
    try {
      const { driverProfile, courierProfile } = req.driver!;
      if (req.query.kind === 'ride') {
        const trip = await prisma.rideTrip.findFirst({
          where: { id: req.params.id, driverId: driverProfile?.id ?? '—' },
          include: RIDE_INCLUDE,
        });
        if (!trip) throw AppError.notFound('Trip not found');
        const view = rideView(trip);
        const rideTarget =
          trip.status === RideStatus.IN_PROGRESS
            ? { latitude: view.dropoffLat, longitude: view.dropoffLng }
            : { latitude: view.pickupLat, longitude: view.pickupLng };
        const eta = RIDE_ONGOING.includes(trip.status) ? await liveEta('RIDE', trip.id, rideTarget) : null;
        res.json({ trip: view, eta });
        return;
      }
      const order = await prisma.order.findFirst({
        where: { id: req.params.id, courierId: courierProfile?.id ?? '—' },
        include: DELIVERY_INCLUDE,
      });
      if (!order) throw AppError.notFound('Delivery not found');
      const view = deliveryView(order);
      const toMerchant = order.status === OrderStatus.COURIER_ASSIGNED;
      const point = toMerchant
        ? view.pickupLat != null && view.pickupLng != null
          ? { latitude: view.pickupLat, longitude: view.pickupLng }
          : null
        : view.dropoffLat != null && view.dropoffLng != null
          ? { latitude: view.dropoffLat, longitude: view.dropoffLng }
          : null;
      const eta =
        point && ORDER_ONGOING.includes(order.status) ? await liveEta('ORDER', order.id, point) : null;
      res.json({ trip: view, eta });
    } catch (err) {
      next(err);
    }
  },
);

/** Ride flow: DRIVER_ASSIGNED → DRIVER_ARRIVING → ARRIVED → IN_PROGRESS → COMPLETED */
const RIDE_NEXT: Partial<Record<RideStatus, { next: RideStatus; label: string }>> = {
  [RideStatus.DRIVER_ASSIGNED]: { next: RideStatus.DRIVER_ARRIVING, label: 'Driver is on the way' },
  [RideStatus.DRIVER_ARRIVING]: { next: RideStatus.ARRIVED, label: 'Driver arrived at pickup' },
  [RideStatus.ARRIVED]: { next: RideStatus.IN_PROGRESS, label: 'Trip started' },
};

/** Delivery flow: COURIER_ASSIGNED → PICKED_UP → ON_THE_WAY → DELIVERED */
const ORDER_NEXT: Partial<Record<OrderStatus, { next: OrderStatus; label: string }>> = {
  [OrderStatus.COURIER_ASSIGNED]: { next: OrderStatus.PICKED_UP, label: 'Courier picked up your order' },
  [OrderStatus.PICKED_UP]: { next: OrderStatus.ON_THE_WAY, label: 'Order on the way' },
  [OrderStatus.ON_THE_WAY]: { next: OrderStatus.DELIVERED, label: 'Order delivered' },
};

/**
 * Location-gated transitions: the latest GPS fix must sit inside the target
 * geofence. `override: true` (a logged support/driver override) skips the
 * check — for signal shadows and wrong-pin situations.
 */
async function assertInsideGeofence(input: {
  subjectType: 'RIDE' | 'ORDER';
  subjectId: string;
  target: { latitude: number; longitude: number } | null;
  radiusM: number;
  override: boolean;
  stepLabel: string;
}) {
  if (!input.target) return; // nothing to verify against
  const fix = await prisma.liveLocation.findFirst({
    where: { subjectType: input.subjectType, subjectId: input.subjectId },
    orderBy: { recordedAt: 'desc' },
  });
  const check = checkGeofence(fix, input.target, input.radiusM);
  if (check.ok) return;
  if (input.override) {
    await recordTrackingEvent({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: 'GEOFENCE_OVERRIDE',
      label: `${input.stepLabel} confirmed outside the expected area`,
      metadata: { distanceM: check.distanceM, radiusM: check.radiusM },
    });
    return;
  }
  const km = check.distanceM != null ? (check.distanceM / 1000).toFixed(1) : '?';
  throw AppError.badRequest(
    `You appear to be about ${km} km from this stop. Get closer, or confirm you are really there.`,
    'GEOFENCE_TOO_FAR',
    { distanceM: check.distanceM, radiusM: check.radiusM },
  );
}

driverRouter.post(
  '/trips/:id/advance',
  validate({ body: z.object({ kind: z.enum(['ride', 'delivery']), override: z.boolean().default(false) }) }),
  async (req, res, next) => {
    try {
      const { driverProfile, courierProfile } = req.driver!;
      const { override } = req.body;

      if (req.body.kind === 'ride') {
        const trip = await prisma.rideTrip.findFirst({
          where: { id: req.params.id, driverId: driverProfile?.id ?? '—' },
          include: RIDE_INCLUDE,
        });
        if (!trip) throw AppError.notFound('Trip not found');

        if (trip.status === RideStatus.IN_PROGRESS) {
          await assertInsideGeofence({
            subjectType: 'RIDE',
            subjectId: trip.id,
            target: { latitude: trip.request.dropoffLat, longitude: trip.request.dropoffLng },
            radiusM: GEOFENCE.completionRadiusM,
            override,
            stepLabel: 'Drop-off',
          });
          const completed = await ridesService.completeTrip(trip.id);
          await creditPayout(
            req.auth!.sub,
            completed.totalMinor - completed.serviceFeeMinor,
            completed.code,
            'ride',
            completed.id,
          );
          await prisma.notification.create({
            data: {
              userId: trip.request.customerId,
              type: 'RIDE_UPDATE',
              title: 'Ride complete',
              body: `Trip ${trip.code} is complete. Thanks for riding with Voryn Connect!`,
            },
          });
          const fresh = await prisma.rideTrip.findUniqueOrThrow({ where: { id: trip.id }, include: RIDE_INCLUDE });
          res.json({ trip: rideView(fresh) });
          return;
        }

        const step = RIDE_NEXT[trip.status];
        if (!step) throw AppError.badRequest(`A ride in status ${trip.status} cannot advance.`, 'INVALID_TRANSITION');
        if (step.next === RideStatus.ARRIVED) {
          await assertInsideGeofence({
            subjectType: 'RIDE',
            subjectId: trip.id,
            target: { latitude: trip.request.pickupLat, longitude: trip.request.pickupLng },
            radiusM: GEOFENCE.arrivalRadiusM,
            override,
            stepLabel: 'Pickup arrival',
          });
        }
        await prisma.rideTrip.update({ where: { id: trip.id }, data: { status: step.next } });
        if (step.next === RideStatus.IN_PROGRESS) {
          await prisma.rideTrip.update({ where: { id: trip.id }, data: { startedAt: new Date() } });
        }
        await prisma.rideRequest.update({ where: { id: trip.requestId }, data: { status: step.next } });
        await recordTrackingEvent({ subjectType: 'RIDE', subjectId: trip.id, status: step.next, label: step.label });
        const fresh = await prisma.rideTrip.findUniqueOrThrow({ where: { id: trip.id }, include: RIDE_INCLUDE });
        res.json({ trip: rideView(fresh) });
        return;
      }

      const order = await prisma.order.findFirst({
        where: { id: req.params.id, courierId: courierProfile?.id ?? '—' },
        include: DELIVERY_INCLUDE,
      });
      if (!order) throw AppError.notFound('Delivery not found');
      const step = ORDER_NEXT[order.status];
      if (!step) throw AppError.badRequest(`A delivery in status ${order.status} cannot advance.`, 'INVALID_TRANSITION');
      if (step.next === OrderStatus.PICKED_UP) {
        const branch = order.provider.branches[0];
        await assertInsideGeofence({
          subjectType: 'ORDER',
          subjectId: order.id,
          target: branch ? { latitude: branch.latitude, longitude: branch.longitude } : null,
          radiusM: GEOFENCE.arrivalRadiusM,
          override,
          stepLabel: 'Merchant pickup',
        });
      }
      if (step.next === OrderStatus.DELIVERED) {
        await assertInsideGeofence({
          subjectType: 'ORDER',
          subjectId: order.id,
          target:
            order.deliveryLat != null && order.deliveryLng != null
              ? { latitude: order.deliveryLat, longitude: order.deliveryLng }
              : null,
          radiusM: GEOFENCE.completionRadiusM,
          override,
          stepLabel: 'Delivery',
        });
      }
      await ordersService.transition(order.id, step.next, step.label, { by: 'driver-dashboard' });
      if (step.next === OrderStatus.DELIVERED) {
        await creditPayout(req.auth!.sub, order.deliveryFeeMinor + order.tipMinor, order.code, 'delivery', order.id);
        await prisma.notification.create({
          data: {
            userId: order.customerId,
            type: 'ORDER_UPDATE',
            title: 'Order delivered',
            body: `Order ${order.code} was delivered. Enjoy!`,
          },
        });
      }
      const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: DELIVERY_INCLUDE });
      res.json({ trip: deliveryView(fresh) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Live GPS ping from the driver app while a trip is ongoing. Fans out to the
 * customer over the tracking socket (track:location) and persists the
 * breadcrumb so a late-joining customer still sees the vehicle.
 */
driverRouter.post(
  '/trips/:id/location',
  validate({
    body: z.object({
      kind: z.enum(['ride', 'delivery']),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      heading: z.number().min(0).max(360).optional(),
      speedKph: z.number().min(0).max(300).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { driverProfile, courierProfile } = req.driver!;
      const { kind, latitude, longitude, heading, speedKph } = req.body;

      const subjectType = kind === 'ride' ? ('RIDE' as const) : ('ORDER' as const);
      let subjectId: string;
      if (kind === 'ride') {
        const trip = await prisma.rideTrip.findFirst({
          where: { id: req.params.id, driverId: driverProfile?.id ?? '—', status: { in: RIDE_ONGOING } },
          select: { id: true },
        });
        if (!trip) throw AppError.notFound('No ongoing trip to track');
        subjectId = trip.id;
      } else {
        const order = await prisma.order.findFirst({
          where: { id: req.params.id, courierId: courierProfile?.id ?? '—', status: { in: ORDER_ONGOING } },
          select: { id: true },
        });
        if (!order) throw AppError.notFound('No ongoing delivery to track');
        subjectId = order.id;
      }

      // Spoof screen: a physically impossible jump is logged for review and
      // NOT broadcast to the customer — but the sender is never auto-punished.
      const lastFix = await prisma.liveLocation.findFirst({
        where: { subjectType, subjectId },
        orderBy: { recordedAt: 'desc' },
        select: { latitude: true, longitude: true, recordedAt: true },
      });
      const anomaly = detectSpeedAnomaly(lastFix, { latitude, longitude });
      if (anomaly.impossible) {
        await recordTrackingEvent({
          subjectType,
          subjectId,
          status: 'LOCATION_ANOMALY',
          label: 'Implausible location update ignored',
          metadata: {
            actorUserId: req.auth!.sub,
            latitude,
            longitude,
            impliedKph: anomaly.impliedKph,
            distanceM: anomaly.distanceM,
          },
        });
        res.status(202).json({ recorded: false, reason: 'ANOMALY' });
        return;
      }

      await recordLiveLocation({
        subjectType,
        subjectId,
        actorUserId: req.auth!.sub,
        latitude,
        longitude,
        heading,
        speedKph,
      });
      res.status(202).json({ recorded: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── Earnings ─────────────────────────────────────────────────

driverRouter.get('/earnings', async (req, res, next) => {
  try {
    const { driverProfile, courierProfile } = req.driver!;
    const rows = await earningRows({ driverId: driverProfile?.id, courierId: courierProfile?.id });

    const now = Date.now();
    const dayMs = 86_400_000;
    const weekAgo = new Date(now - 7 * dayMs);
    const prevWeek = new Date(now - 14 * dayMs);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const sum = (list: typeof rows) => list.reduce((s, r) => s + r.earnedMinor, 0);

    const todayRows = rows.filter((r) => r.when >= startOfToday());
    const weekRows = rows.filter((r) => r.when >= weekAgo);
    const prevWeekRows = rows.filter((r) => r.when >= prevWeek && r.when < weekAgo);

    const series: Array<{ label: string; valueMinor: number }> = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date(now - i * dayMs);
      series.push({
        label: day.toLocaleDateString('en-JM', { weekday: 'short' }),
        valueMinor: sum(rows.filter((r) => r.when.toDateString() === day.toDateString())),
      });
    }

    res.json({
      summary: {
        todayMinor: sum(todayRows),
        weekMinor: sum(weekRows),
        monthMinor: sum(rows.filter((r) => r.when >= monthStart)),
        weekDeltaPct: sum(prevWeekRows) > 0 ? Math.round(((sum(weekRows) - sum(prevWeekRows)) / sum(prevWeekRows)) * 100) : null,
      },
      series,
      breakdown: {
        rideMinor: sum(rows.filter((r) => r.kind === 'ride')) - rows.filter((r) => r.kind === 'ride').reduce((s, r) => s + r.tipMinor, 0),
        deliveryMinor: sum(rows.filter((r) => r.kind === 'delivery')) - rows.filter((r) => r.kind === 'delivery').reduce((s, r) => s + r.tipMinor, 0),
        tipsMinor: rows.reduce((s, r) => s + r.tipMinor, 0),
        bonusesMinor: 0,
      },
      performance: {
        completedWeek: weekRows.length,
        completedAll: rows.length,
        ratingAvg: driverProfile?.ratingAvg ?? courierProfile?.ratingAvg ?? 0,
      },
      history: rows.slice(0, 20).map((r) => ({
        kind: r.kind,
        code: r.code,
        earnedMinor: r.earnedMinor,
        when: r.when,
      })),
    });
  } catch (err) {
    next(err);
  }
});
