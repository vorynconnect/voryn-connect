import { Router } from 'express';
import { z } from 'zod';
import { PaymentMethodType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { rentalsService, RENTAL_ADD_ONS } from './rentals.service';
import { listTrackingEvents } from '../tracking/tracking.service';

export const rentalsRouter = Router();
rentalsRouter.use(requireAuth);

rentalsRouter.get('/add-ons', (_req, res) => {
  res.json({ addOns: RENTAL_ADD_ONS });
});

rentalsRouter.post(
  '/quote',
  validate({
    body: z.object({
      vehicleId: z.string(),
      pickupAt: z.coerce.date(),
      returnAt: z.coerce.date(),
      addOnKeys: z.array(z.string()).default([]),
    }),
  }),
  async (req, res, next) => {
    try {
      const vehicle = await prisma.rentalVehicle.findUnique({ where: { id: req.body.vehicleId } });
      if (!vehicle) throw AppError.notFound('Vehicle not found');
      res.json(
        rentalsService.quote({
          dailyRateMinor: vehicle.dailyRateMinor,
          depositMinor: vehicle.depositMinor,
          pickupAt: req.body.pickupAt,
          returnAt: req.body.returnAt,
          addOnKeys: req.body.addOnKeys,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

rentalsRouter.post(
  '/reserve',
  validate({
    body: z.object({
      vehicleId: z.string(),
      pickupAt: z.coerce.date(),
      returnAt: z.coerce.date(),
      addOnKeys: z.array(z.string()).default([]),
      driverName: z.string().min(2),
      paymentMethodType: z.nativeEnum(PaymentMethodType).default(PaymentMethodType.VORYN_WALLET),
      idempotencyKey: z.string().min(8).max(128),
    }),
  }),
  async (req, res, next) => {
    try {
      const result = await rentalsService.reserve({ customerId: req.auth!.sub, ...req.body });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

rentalsRouter.get('/:id', async (req, res, next) => {
  try {
    const reservation = await prisma.rentalReservation.findFirst({
      where: { id: req.params.id, customerId: req.auth!.sub },
      include: {
        vehicle: true,
        provider: { select: { id: true, name: true, logoUrl: true, isVerified: true, phone: true } },
        payment: true,
      },
    });
    if (!reservation) throw AppError.notFound('Reservation not found');
    const events = await listTrackingEvents('RENTAL', reservation.id);
    res.json({ reservation, events });
  } catch (err) {
    next(err);
  }
});

rentalsRouter.post('/:id/activate', async (req, res, next) => {
  try {
    res.json({ reservation: await rentalsService.activate(req.params.id!, req.auth!.sub) });
  } catch (err) {
    next(err);
  }
});

rentalsRouter.post(
  '/:id/extend',
  validate({
    body: z.object({ newReturnAt: z.coerce.date(), idempotencyKey: z.string().min(8).max(128) }),
  }),
  async (req, res, next) => {
    try {
      res.json({
        reservation: await rentalsService.extend(
          req.params.id!,
          req.auth!.sub,
          req.body.newReturnAt,
          req.body.idempotencyKey,
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

rentalsRouter.post('/:id/complete', async (req, res, next) => {
  try {
    res.json({ reservation: await rentalsService.complete(req.params.id!, req.auth!.sub) });
  } catch (err) {
    next(err);
  }
});

rentalsRouter.post(
  '/:id/cancel',
  validate({ body: z.object({ reason: z.string().max(300).default('Cancelled by customer') }) }),
  async (req, res, next) => {
    try {
      res.json({ reservation: await rentalsService.cancel(req.params.id!, req.auth!.sub, req.body.reason) });
    } catch (err) {
      next(err);
    }
  },
);
