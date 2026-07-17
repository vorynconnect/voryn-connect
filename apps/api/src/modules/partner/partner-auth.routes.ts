import { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { ProviderCategory, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { rateLimit } from '../../middleware/rate-limit';
import { signAccessToken } from '../auth/token.service';
import { sanitizeUser } from '../auth/auth.service';
import { sendData } from './partner.middleware';
import { partnerView } from './partner.service';

export const partnerAuthRouter = Router();
const partnerAuthLimiter = rateLimit('partner-auth', 20, 60);

/**
 * Dashboard sessions use a longer-lived access token (browser tab, no
 * silent-refresh plumbing in the static site). 12h keeps a work day signed in;
 * logout revokes the device session server-side.
 */
const PARTNER_TOKEN_TTL = '12h';

const SERVICE_TYPE_TO_CATEGORY: Record<string, ProviderCategory> = {
  'Liquor & Beverages': ProviderCategory.DRINKS,
  'Restaurant / Food Delivery': ProviderCategory.RESTAURANT,
  Grocery: ProviderCategory.GROCERY,
  'Grocery Delivery': ProviderCategory.GROCERY,
  Pharmacy: ProviderCategory.PHARMACY,
  'Pharmacy Delivery': ProviderCategory.PHARMACY,
  'Product Supplier': ProviderCategory.CONVENIENCE,
  'Ride / Mobility': ProviderCategory.RIDES,
  'Vehicle Rental': ProviderCategory.VEHICLE_RENTAL,
  'Car Wash': ProviderCategory.AUTO_CARE,
  'Car Repair': ProviderCategory.AUTO_CARE,
  'Home Services': ProviderCategory.HOME_SERVICES,
  Plumber: ProviderCategory.HOME_SERVICES,
  Electrician: ProviderCategory.HOME_SERVICES,
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

async function issuePartnerSession(userId: string, req: { headers: Record<string, unknown>; ip?: string }) {
  const session = await prisma.deviceSession.create({
    data: {
      userId,
      deviceName: 'Partner dashboard (web)',
      devicePlatform: 'web',
      ipAddress: req.ip,
    },
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return signAccessToken({ sub: userId, role: user.role, sessionId: session.id }, PARTNER_TOKEN_TTL);
}

partnerAuthRouter.post(
  '/login',
  partnerAuthLimiter,
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

      const staff = await prisma.providerStaff.findFirst({
        where: { userId: user.id },
        include: { provider: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!staff) {
        throw AppError.forbidden(
          'This login is not linked to a partner account. Sign up as a partner first.',
          'NOT_A_PARTNER',
        );
      }

      const token = await issuePartnerSession(user.id, req);
      sendData(res, {
        token,
        user: sanitizeUser(user),
        partner: await partnerView(staff.provider),
      });
    } catch (err) {
      next(err);
    }
  },
);

partnerAuthRouter.post(
  '/signup',
  partnerAuthLimiter,
  validate({
    body: z.object({
      businessName: z.string().min(2).max(100),
      email: z.string().email(),
      password: z.string().min(8).max(128),
      serviceType: z.string().min(2).max(60),
      phone: z.string().min(7).max(20).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { businessName, email, password, serviceType, phone } = req.body;
      const existing = await prisma.user.findFirst({ where: { email } });
      if (existing) throw AppError.conflict('An account with this email already exists.', 'EMAIL_TAKEN');

      const category = SERVICE_TYPE_TO_CATEGORY[serviceType] ?? ProviderCategory.CONVENIENCE;
      const baseSlug = slugify(businessName) || 'partner';
      const slugCount = await prisma.provider.count({ where: { slug: { startsWith: baseSlug } } });
      const slug = slugCount === 0 ? baseSlug : `${baseSlug}-${slugCount + 1}`;

      // New partners start unverified and unpublished: PENDING_VERIFICATION
      // keeps them out of customer discovery until review (see §5 onboarding).
      const user = await prisma.user.create({
        data: {
          fullName: businessName,
          email,
          phone,
          passwordHash: await argon2.hash(password),
          role: UserRole.PROVIDER_OWNER,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          providerStaff: {
            create: {
              role: 'OWNER',
              provider: {
                create: {
                  slug,
                  name: businessName,
                  categories: [category],
                  status: 'PENDING_VERIFICATION',
                  email,
                  phone,
                  branches: {
                    create: {
                      name: `${businessName} — Portmore`,
                      line1: 'Portmore, St. Catherine',
                      latitude: 17.9583,
                      longitude: -76.8822,
                      isPrimary: true,
                    },
                  },
                },
              },
            },
          },
        },
        include: { providerStaff: { include: { provider: true } } },
      });

      const provider = user.providerStaff[0]!.provider;
      const token = await issuePartnerSession(user.id, req);
      sendData(res, { token, user: sanitizeUser(user), partner: await partnerView(provider) }, 201);
    } catch (err) {
      next(err);
    }
  },
);

partnerAuthRouter.post('/logout', async (req, res, next) => {
  try {
    // Best-effort: revoke the session named in the token if one is presented.
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const { verifyAccessToken } = await import('../auth/token.service');
      try {
        const payload = verifyAccessToken(header.slice(7));
        await prisma.deviceSession.update({
          where: { id: payload.sessionId },
          data: { revokedAt: new Date() },
        });
      } catch {
        // Expired token — nothing to revoke.
      }
    }
    sendData(res, { message: 'Signed out.' });
  } catch (err) {
    next(err);
  }
});
