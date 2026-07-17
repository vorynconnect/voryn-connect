import { Router } from 'express';
import { z } from 'zod';
import { PaymentMethodType, ServiceLocationType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { bookingsService } from './bookings.service';
import { listTrackingEvents } from '../tracking/tracking.service';
import { simulateBookingProgress } from '../simulation/fulfillment.simulator';

export const bookingsRouter = Router();
bookingsRouter.use(requireAuth);

bookingsRouter.post(
  '/',
  validate({
    body: z.object({
      packageId: z.string(),
      locationType: z.nativeEnum(ServiceLocationType),
      scheduledAt: z.coerce.date(),
      paymentMethodType: z.nativeEnum(PaymentMethodType).default(PaymentMethodType.VORYN_WALLET),
      addressId: z.string().optional(),
      customerVehicleId: z.string().optional(),
      deviceDescription: z.string().max(200).optional(),
      issueDescription: z.string().max(1000).optional(),
      providerNote: z.string().max(500).optional(),
      idempotencyKey: z.string().min(8).max(128),
    }),
  }),
  async (req, res, next) => {
    try {
      const result = await bookingsService.createBooking({ customerId: req.auth!.sub, ...req.body });
      void simulateBookingProgress(result.booking.id);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

bookingsRouter.get('/:id', async (req, res, next) => {
  try {
    const booking = await prisma.serviceBooking.findFirst({
      where: { id: req.params.id, customerId: req.auth!.sub },
      include: {
        provider: { select: { id: true, name: true, logoUrl: true, ratingAvg: true, phone: true } },
        technician: { include: { user: { select: { fullName: true } } } },
        customerVehicle: true,
        appointment: true,
        payment: true,
      },
    });
    if (!booking) throw AppError.notFound('Booking not found');
    const events = await listTrackingEvents('BOOKING', booking.id);
    const lastLocation = await prisma.liveLocation.findFirst({
      where: { subjectType: 'BOOKING', subjectId: booking.id },
      orderBy: { recordedAt: 'desc' },
    });
    res.json({ booking, events, providerLocation: lastLocation });
  } catch (err) {
    next(err);
  }
});

bookingsRouter.post(
  '/:id/cancel',
  validate({ body: z.object({ reason: z.string().max(300).default('Cancelled by customer') }) }),
  async (req, res, next) => {
    try {
      const booking = await bookingsService.cancel(req.params.id!, req.auth!.sub, req.body.reason);
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  },
);

// ── Customer vehicles (used by Auto Care bookings) ──────────

bookingsRouter.get('/vehicles/mine', async (req, res, next) => {
  try {
    const vehicles = await prisma.customerVehicle.findMany({ where: { userId: req.auth!.sub } });
    res.json({ vehicles });
  } catch (err) {
    next(err);
  }
});

bookingsRouter.post(
  '/vehicles',
  validate({
    body: z.object({
      make: z.string().min(1),
      model: z.string().min(1),
      year: z.number().int().min(1950).max(2035).optional(),
      color: z.string().optional(),
      plateNo: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const vehicle = await prisma.customerVehicle.create({
        data: { ...req.body, userId: req.auth!.sub },
      });
      res.status(201).json({ vehicle });
    } catch (err) {
      next(err);
    }
  },
);
