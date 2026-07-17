import type { NextFunction, Request, Response } from 'express';
import type { CourierProfile, DriverProfile } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';

export type DriverContext = {
  driverProfile: DriverProfile | null;
  courierProfile: CourierProfile | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      driver?: DriverContext;
    }
  }
}

/**
 * Driver-dashboard guard. The dashboard serves two partner kinds — ride
 * drivers (DriverProfile) and delivery couriers (CourierProfile). A user may
 * hold either or both; all queries downstream scope to these profile ids.
 */
export function requireDriver(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, async (err?: unknown) => {
    if (err) return next(err);
    try {
      const [driverProfile, courierProfile] = await Promise.all([
        prisma.driverProfile.findUnique({ where: { userId: req.auth!.sub } }),
        prisma.courierProfile.findUnique({ where: { userId: req.auth!.sub } }),
      ]);
      if (!driverProfile && !courierProfile) {
        throw AppError.forbidden(
          'No driver or delivery profile is linked to this account.',
          'NOT_A_DRIVER',
        );
      }
      req.driver = { driverProfile, courierProfile };
      next();
    } catch (e) {
      next(e);
    }
  });
}
