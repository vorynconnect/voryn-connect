import { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { rateLimit } from '../../middleware/rate-limit';
import { signAccessToken } from '../auth/token.service';
import { sanitizeUser } from '../auth/auth.service';
import { sendData } from '../partner/partner.middleware';

/**
 * Voryn team console auth. Only users with the ADMIN or SUPER_ADMIN role can
 * sign in here; accounts are created via the BOOTSTRAP_ADMIN_* env vars on
 * boot (see lib/bootstrap-admin.ts) or by an existing admin/DB operator.
 * Same 12h browser-session model as the partner dashboard.
 */
export const adminAuthRouter = Router();

const ADMIN_TOKEN_TTL = '12h';
const adminAuthLimiter = rateLimit('admin-auth', 10, 60);

adminAuthRouter.post(
  '/login',
  adminAuthLimiter,
  validate({ body: z.object({ email: z.string().email(), password: z.string().min(1) }) }),
  async (req, res, next) => {
    try {
      const user = await prisma.user.findFirst({
        where: { email: req.body.email, deletedAt: null },
      });
      const invalid = AppError.unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS');
      if (!user) throw invalid;
      const okPw = await argon2.verify(user.passwordHash, req.body.password);
      if (!okPw) throw invalid;
      if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
        throw AppError.forbidden('This login does not have team access.', 'NOT_AN_ADMIN');
      }

      const session = await prisma.deviceSession.create({
        data: {
          userId: user.id,
          deviceName: 'Voryn team console (web)',
          devicePlatform: 'web',
          ipAddress: req.ip,
        },
      });
      const token = signAccessToken(
        { sub: user.id, role: user.role, sessionId: session.id },
        ADMIN_TOKEN_TTL,
      );
      sendData(res, { token, user: sanitizeUser(user) });
    } catch (err) {
      next(err);
    }
  },
);
