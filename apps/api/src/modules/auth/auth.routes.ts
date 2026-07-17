import { Router } from 'express';
import { z } from 'zod';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { validate } from '../../middleware/validate';
import { authLimiter, otpLimiter } from '../../middleware/rate-limit';
import { requireAuth } from '../../middleware/auth';
import { authService } from './auth.service';
import { rotateRefreshToken } from './token.service';
import { sanitizeUser } from './auth.service';

export const authRouter = Router();

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128);

function deviceInfo(req: { headers: Record<string, unknown>; ip?: string }) {
  return {
    deviceName: typeof req.headers['x-device-name'] === 'string' ? (req.headers['x-device-name'] as string) : undefined,
    platform: typeof req.headers['x-device-platform'] === 'string' ? (req.headers['x-device-platform'] as string) : undefined,
    ip: req.ip,
  };
}

authRouter.post(
  '/signup',
  authLimiter,
  validate({
    body: z.object({
      fullName: z.string().min(2).max(100),
      email: z.string().email(),
      phone: z.string().min(7).max(20),
      password: passwordSchema,
      acceptedTerms: z.boolean(),
    }),
  }),
  async (req, res, next) => {
    try {
      res.status(201).json(await authService.signUp(req.body));
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/verify-otp',
  authLimiter,
  validate({
    body: z.object({
      identifier: z.string().min(3),
      code: z.string().length(6),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(await authService.verifySignupOtp(req.body, deviceInfo(req)));
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/resend-otp',
  otpLimiter,
  validate({
    body: z.object({
      identifier: z.string().min(3),
      purpose: z.nativeEnum(OtpPurpose).default(OtpPurpose.SIGNUP),
      channel: z.nativeEnum(OtpChannel).default(OtpChannel.SMS),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(await authService.resendOtp(req.body));
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/login',
  authLimiter,
  validate({
    body: z.object({
      identifier: z.string().min(3),
      password: z.string().min(1),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(await authService.login(req.body, deviceInfo(req)));
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/refresh',
  validate({ body: z.object({ refreshToken: z.string().min(10) }) }),
  async (req, res, next) => {
    try {
      const { accessToken, refreshToken, user } = await rotateRefreshToken(req.body.refreshToken);
      res.json({ accessToken, refreshToken, user: sanitizeUser(user) });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/forgot-password',
  otpLimiter,
  validate({ body: z.object({ identifier: z.string().min(3) }) }),
  async (req, res, next) => {
    try {
      res.json(await authService.requestPasswordReset(req.body));
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/reset-password',
  authLimiter,
  validate({
    body: z.object({
      identifier: z.string().min(3),
      code: z.string().length(6),
      newPassword: passwordSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(await authService.resetPassword(req.body));
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    res.json(await authService.logout(req.auth!.sessionId));
  } catch (err) {
    next(err);
  }
});
