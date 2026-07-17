import type { NextFunction, Request, Response } from 'express';
import type { Provider, StaffRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';

export type PartnerContext = {
  providerId: string;
  staffRole: StaffRole;
  provider: Provider;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      partner?: PartnerContext;
    }
  }
}

/**
 * Partner-dashboard guard. Runs the normal JWT auth, then resolves the
 * caller's ProviderStaff membership. Every downstream query MUST scope by
 * req.partner.providerId — never trust a provider id from the client.
 */
export function requirePartner(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, async (err?: unknown) => {
    if (err) return next(err);
    try {
      const staff = await prisma.providerStaff.findFirst({
        where: { userId: req.auth!.sub },
        include: { provider: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!staff) {
        throw AppError.forbidden('No partner account is linked to this login.', 'NOT_A_PARTNER');
      }
      if (staff.provider.status === 'SUSPENDED' || staff.provider.status === 'DEACTIVATED') {
        throw AppError.forbidden('This partner account is not active. Contact support.', 'PARTNER_INACTIVE');
      }
      req.partner = { providerId: staff.providerId, staffRole: staff.role, provider: staff.provider };
      next();
    } catch (e) {
      next(e);
    }
  });
}

/** Restrict an action to specific staff roles (owner/manager/employee). */
export function requireStaffRole(...roles: StaffRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.partner || !roles.includes(req.partner.staffRole)) {
      next(AppError.forbidden('Your staff role does not allow this action.', 'STAFF_ROLE_FORBIDDEN'));
      return;
    }
    next();
  };
}

/** Dashboard response envelope expected by the website's API adapter. */
export function sendData<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({ ok: true, data });
}
