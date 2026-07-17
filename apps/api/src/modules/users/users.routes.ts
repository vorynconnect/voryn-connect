import { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { AddressLabel } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { createImageUpload, publicUploadUrl } from '../../lib/uploads';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { sanitizeUser } from '../auth/auth.service';

export const usersRouter = Router();

usersRouter.use(requireAuth);

/** Current user + profile + wallet snapshot (session restore). */
usersRouter.get('/me', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.sub },
      include: {
        customerProfile: true,
        wallet: { select: { id: true, balanceMinor: true, currency: true, status: true } },
        loyaltyAccount: { select: { pointsBalance: true } },
      },
    });
    if (!user || user.deletedAt) throw AppError.notFound('Account not found');
    res.json({
      user: sanitizeUser(user),
      profile: user.customerProfile,
      wallet: user.wallet,
      loyalty: user.loyaltyAccount,
    });
  } catch (err) {
    next(err);
  }
});

usersRouter.patch(
  '/me',
  validate({
    body: z.object({
      fullName: z.string().min(2).max(100).optional(),
      username: z.string().min(3).max(30).optional(),
      dateOfBirth: z.coerce.date().optional(),
      avatarUrl: z.string().url().nullable().optional(),
      primaryUse: z.enum(['rides', 'delivery', 'services']).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { fullName, ...profileFields } = req.body;
      const user = await prisma.user.update({
        where: { id: req.auth!.sub },
        data: {
          ...(fullName ? { fullName } : {}),
          customerProfile: {
            upsert: { create: profileFields, update: profileFields },
          },
        },
        include: { customerProfile: true },
      });
      res.json({ user: sanitizeUser(user), profile: user.customerProfile });
    } catch (err) {
      next(err);
    }
  },
);

/** Upload a profile photo; stores the file and points the profile's avatarUrl at it. */
const avatarUpload = createImageUpload((req) => `avatar-${req.auth?.sub ?? 'anon'}`);

usersRouter.post('/me/avatar', avatarUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) throw AppError.badRequest('Attach an image file in the "image" field.');
    const avatarUrl = publicUploadUrl(req, req.file.filename);
    const user = await prisma.user.update({
      where: { id: req.auth!.sub },
      data: {
        customerProfile: {
          upsert: { create: { avatarUrl }, update: { avatarUrl } },
        },
      },
      include: { customerProfile: true },
    });
    res.status(201).json({ user: sanitizeUser(user), profile: user.customerProfile });
  } catch (err) {
    next(err);
  }
});

/** Soft-delete account and revoke sessions. */
usersRouter.delete('/me', async (req, res, next) => {
  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: req.auth!.sub },
        data: { deletedAt: new Date(), status: 'DELETED' },
      }),
      prisma.deviceSession.updateMany({
        where: { userId: req.auth!.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: req.auth!.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    res.json({ message: 'Account deleted.' });
  } catch (err) {
    next(err);
  }
});

// ── Addresses ───────────────────────────────────────────────

const addressBody = z.object({
  label: z.nativeEnum(AddressLabel).default(AddressLabel.OTHER),
  name: z.string().min(1).max(60),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().default('Portmore'),
  parish: z.string().default('St. Catherine'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  instructions: z.string().max(300).optional(),
  isDefault: z.boolean().default(false),
});

usersRouter.get('/me/addresses', async (req, res, next) => {
  try {
    const addresses = await prisma.address.findMany({
      where: { userId: req.auth!.sub },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ addresses });
  } catch (err) {
    next(err);
  }
});

usersRouter.post('/me/addresses', validate({ body: addressBody }), async (req, res, next) => {
  try {
    const address = await prisma.$transaction(async (tx) => {
      if (req.body.isDefault) {
        await tx.address.updateMany({
          where: { userId: req.auth!.sub },
          data: { isDefault: false },
        });
      }
      return tx.address.create({ data: { ...req.body, userId: req.auth!.sub } });
    });
    res.status(201).json({ address });
  } catch (err) {
    next(err);
  }
});

usersRouter.patch(
  '/me/addresses/:id',
  validate({ body: addressBody.partial(), params: z.object({ id: z.string() }) }),
  async (req, res, next) => {
    try {
      const existing = await prisma.address.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.userId !== req.auth!.sub) throw AppError.notFound('Address not found');
      const address = await prisma.$transaction(async (tx) => {
        if (req.body.isDefault) {
          await tx.address.updateMany({
            where: { userId: req.auth!.sub },
            data: { isDefault: false },
          });
        }
        return tx.address.update({ where: { id: existing.id }, data: req.body });
      });
      res.json({ address });
    } catch (err) {
      next(err);
    }
  },
);

usersRouter.delete('/me/addresses/:id', async (req, res, next) => {
  try {
    const existing = await prisma.address.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.auth!.sub) throw AppError.notFound('Address not found');
    await prisma.address.delete({ where: { id: existing.id } });
    res.json({ message: 'Address removed.' });
  } catch (err) {
    next(err);
  }
});

/** Change password with the current password (in-session; OTP reset lives in /v1/auth). */
usersRouter.post(
  '/me/password',
  validate({
    body: z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
    }),
  }),
  async (req, res, next) => {
    try {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
      const ok = await argon2.verify(user.passwordHash, req.body.currentPassword);
      if (!ok) throw AppError.unauthorized('Current password is incorrect.', 'PASSWORD_INCORRECT');
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: await argon2.hash(req.body.newPassword) },
        }),
        // Sign out every other device; the current session keeps working.
        prisma.refreshToken.updateMany({
          where: { userId: user.id, revokedAt: null, sessionId: { not: req.auth!.sessionId } },
          data: { revokedAt: new Date() },
        }),
      ]);
      res.json({ message: 'Password updated.' });
    } catch (err) {
      next(err);
    }
  },
);

// ── Push tokens ─────────────────────────────────────────────

usersRouter.post(
  '/me/push-tokens',
  validate({ body: z.object({ token: z.string().min(10), platform: z.enum(['ios', 'android']) }) }),
  async (req, res, next) => {
    try {
      await prisma.pushToken.upsert({
        where: { token: req.body.token },
        create: { ...req.body, userId: req.auth!.sub },
        update: { userId: req.auth!.sub },
      });
      res.status(201).json({ message: 'Push token registered.' });
    } catch (err) {
      next(err);
    }
  },
);
