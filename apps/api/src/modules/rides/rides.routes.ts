import { Router } from 'express';
import { z } from 'zod';
import { PaymentMethodType, RideCategory } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ridesService } from './rides.service';
import { nearbyDriverMarkers, rideSearchStatus } from './dispatch.service';
import { liveEta } from './eta.service';
import { listTrackingEvents } from '../tracking/tracking.service';
import { simulateRideProgress, simulationEnabled } from '../simulation/fulfillment.simulator';

export const ridesRouter = Router();
ridesRouter.use(requireAuth);

const point = z.object({ name: z.string().min(1), lat: z.number(), lng: z.number() });

/**
 * Fare estimate = server-authoritative quote. The backend resolves the road
 * route and prices it; the response carries a quoteId the app must send back
 * when confirming, plus the route geometry for the preview map.
 */
ridesRouter.post(
  '/estimate',
  validate({
    body: z.object({
      pickup: point.partial({ name: true }),
      dropoff: point.partial({ name: true }),
      // Legacy fields — ignored now that routing happens server-side.
      roadDistanceKm: z.number().positive().max(300).optional(),
      roadMinutes: z.number().positive().max(600).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const quote = await ridesService.createQuote({
        customerId: req.auth!.sub,
        pickup: req.body.pickup,
        dropoff: req.body.dropoff,
      });
      res.json(quote);
    } catch (err) {
      next(err);
    }
  },
);

ridesRouter.post(
  '/request',
  validate({
    body: z.object({
      category: z.nativeEnum(RideCategory),
      pickup: point,
      dropoff: point,
      paymentMethodType: z.nativeEnum(PaymentMethodType).default(PaymentMethodType.VORYN_WALLET),
      scheduledFor: z.coerce.date().optional(),
      roadDistanceKm: z.number().positive().max(300).optional(),
      quoteId: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const request = await ridesService.requestRide({ customerId: req.auth!.sub, ...req.body });

      // Dev dispatcher: assign the best driver after a short search window.
      if (simulationEnabled()) {
        setTimeout(async () => {
          try {
            const assigned = await ridesService.assignDriver(request.id);
            if (assigned) void simulateRideProgress(assigned.trip.id);
          } catch {
            // request may have been cancelled during the search window
          }
        }, 6000);
      }

      res.status(201).json({ request });
    } catch (err) {
      next(err);
    }
  },
);

/** Poll the request until a trip exists (driver assigned) or it fails. */
ridesRouter.get('/requests/:id', async (req, res, next) => {
  try {
    const request = await prisma.rideRequest.findFirst({
      where: { id: req.params.id, customerId: req.auth!.sub },
      include: {
        trip: {
          include: {
            driver: {
              include: {
                user: { select: { fullName: true, customerProfile: { select: { avatarUrl: true } } } },
                provider: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!request) throw AppError.notFound('Ride request not found');
    // Live search session state (current radius, stage, honest driver count).
    // Reading it also lazily expires searches whose window has closed.
    const search = await rideSearchStatus(request);
    res.json({ request, search });
  } catch (err) {
    next(err);
  }
});

/**
 * Anonymized nearby-driver markers for the customer map. Positions are
 * deterministically offset server-side; no driver identity is exposed and
 * stale or busy drivers never appear. Zero results means zero decoration.
 */
ridesRouter.get(
  '/nearby-drivers',
  validate({
    query: z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      category: z.nativeEnum(RideCategory).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { lat, lng, category } = req.query as unknown as {
        lat: number;
        lng: number;
        category?: RideCategory;
      };
      const drivers = await nearbyDriverMarkers({ lat, lng, category });
      res.json({ drivers, count: drivers.length });
    } catch (err) {
      next(err);
    }
  },
);

ridesRouter.get('/trips/:id', async (req, res, next) => {
  try {
    const trip = await prisma.rideTrip.findFirst({
      where: { id: req.params.id, request: { customerId: req.auth!.sub } },
      include: {
        request: true,
        driver: { include: { user: { select: { fullName: true, customerProfile: { select: { avatarUrl: true } } } } } },
        payment: true,
      },
    });
    if (!trip) throw AppError.notFound('Trip not found');
    const events = await listTrackingEvents('RIDE', trip.id);
    const lastLocation = await prisma.liveLocation.findFirst({
      where: { subjectType: 'RIDE', subjectId: trip.id },
      orderBy: { recordedAt: 'desc' },
    });
    // Authoritative ETA: driver → pickup while arriving, → dropoff once riding.
    const target =
      trip.status === 'IN_PROGRESS'
        ? { latitude: trip.request.dropoffLat, longitude: trip.request.dropoffLng }
        : { latitude: trip.request.pickupLat, longitude: trip.request.pickupLng };
    const ongoing = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_PROGRESS'].includes(trip.status);
    const eta = ongoing ? await liveEta('RIDE', trip.id, target) : null;
    res.json({ trip, events, driverLocation: lastLocation, eta });
  } catch (err) {
    next(err);
  }
});

ridesRouter.post(
  '/:id/cancel',
  validate({ body: z.object({ reason: z.string().max(300).default('Cancelled by customer') }) }),
  async (req, res, next) => {
    try {
      const result = await ridesService.cancel(req.params.id!, req.auth!.sub, req.body.reason);
      res.json({ result });
    } catch (err) {
      next(err);
    }
  },
);

ridesRouter.post(
  '/trips/:id/tip',
  validate({ body: z.object({ tipMinor: z.number().int().min(1000).max(1_000_000) }) }),
  async (req, res, next) => {
    try {
      res.json({ trip: await ridesService.addTip(req.params.id!, req.auth!.sub, req.body.tipMinor) });
    } catch (err) {
      next(err);
    }
  },
);
