import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { notifyProviderStaff } from '../../lib/notify';
import { requireAuth, requireRole } from '../../middleware/auth';
import { revenueRouter } from './revenue.routes';
import { validate } from '../../middleware/validate';
import { sendData } from '../partner/partner.middleware';
import { verificationView } from '../partner/verification.routes';

/**
 * Voryn team console — partner verification review. The team sees every
 * application (business info + uploaded documents), then approves (provider
 * becomes ACTIVE and appears in the customer app) or rejects with notes the
 * partner sees on their verification page.
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));
// Revenue and loyalty reporting (commission by category, points liability).
adminRouter.use('/', revenueRouter);

type QueueStatus = 'incomplete' | 'in_review' | 'rejected' | 'approved';

function overallFor(providerStatus: string, latest: { status: string } | undefined): QueueStatus {
  if (providerStatus === 'ACTIVE') return 'approved';
  if (latest?.status === 'PENDING' || latest?.status === 'IN_REVIEW') return 'in_review';
  if (latest?.status === 'REJECTED') return 'rejected';
  if (latest?.status === 'APPROVED') return 'approved';
  return 'incomplete';
}

adminRouter.get(
  '/verifications',
  validate({
    query: z.object({
      status: z.enum(['all', 'incomplete', 'in_review', 'rejected', 'approved']).default('in_review'),
    }),
  }),
  async (req, res, next) => {
    try {
      const status = (req.query as { status?: QueueStatus | 'all' }).status ?? 'in_review';
      const providers = await prisma.provider.findMany({
        // Partner-owned providers only: seeded marketplace rows without staff
        // logins aren't applications anyone can review.
        where: { staff: { some: {} } },
        orderBy: [{ applicationSubmittedAt: 'desc' }, { createdAt: 'desc' }],
        take: 300,
        include: {
          verifications: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { documents: true } },
        },
      });
      const items = providers
        .map((p) => {
          const latest = p.verifications[0];
          return {
            providerId: p.id,
            name: p.name,
            slug: p.slug,
            categories: p.categories,
            email: p.email,
            phone: p.phone,
            logoUrl: p.logoUrl,
            providerStatus: p.status,
            overall: overallFor(p.status, latest),
            submittedAt: p.applicationSubmittedAt,
            documentsCount: p._count.documents,
            latestReview: latest
              ? {
                  status: latest.status,
                  notes: latest.notes,
                  reviewedBy: latest.reviewedBy,
                  reviewedAt: latest.reviewedAt,
                }
              : null,
            createdAt: p.createdAt,
          };
        })
        .filter((item) => status === 'all' || item.overall === status);
      sendData(res, { items });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get('/verifications/:providerId', async (req, res, next) => {
  try {
    const providerId = req.params.providerId!;
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: {
        staff: { include: { user: { select: { fullName: true, email: true, phone: true, createdAt: true } } } },
        verifications: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!provider) throw AppError.notFound('Provider not found');
    const view = await verificationView(providerId);
    sendData(res, {
      ...view,
      provider: {
        id: provider.id,
        name: provider.name,
        slug: provider.slug,
        categories: provider.categories,
        logoUrl: provider.logoUrl,
        createdAt: provider.createdAt,
      },
      owner: provider.staff
        .filter((s) => s.role === 'OWNER')
        .map((s) => ({
          fullName: s.user.fullName,
          email: s.user.email,
          phone: s.user.phone,
          accountCreatedAt: s.user.createdAt,
        }))[0] ?? null,
      history: provider.verifications.map((v) => ({
        id: v.id,
        status: v.status,
        notes: v.notes,
        reviewedBy: v.reviewedBy,
        reviewedAt: v.reviewedAt,
        createdAt: v.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

async function latestOpenVerification(providerId: string) {
  return prisma.providerVerification.findFirst({
    where: { providerId, status: { in: ['PENDING', 'IN_REVIEW'] } },
    orderBy: { createdAt: 'desc' },
  });
}

adminRouter.post(
  '/verifications/:providerId/approve',
  validate({ body: z.object({ notes: z.string().max(1000).optional() }).default({}) }),
  async (req, res, next) => {
    try {
      const providerId = req.params.providerId!;
      const provider = await prisma.provider.findUnique({ where: { id: providerId } });
      if (!provider) throw AppError.notFound('Provider not found');
      if (provider.status === 'ACTIVE') {
        throw AppError.conflict('This partner is already verified.', 'ALREADY_VERIFIED');
      }
      const admin = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
      const open = await latestOpenVerification(providerId);
      const reviewFields = {
        status: 'APPROVED' as const,
        notes: (req.body as { notes?: string }).notes ?? null,
        reviewedBy: admin.email ?? admin.id,
        reviewedAt: new Date(),
      };
      await prisma.$transaction([
        open
          ? prisma.providerVerification.update({ where: { id: open.id }, data: reviewFields })
          : prisma.providerVerification.create({ data: { providerId, ...reviewFields } }),
        prisma.provider.update({
          where: { id: providerId },
          data: { status: 'ACTIVE', isVerified: true },
        }),
        prisma.providerDocument.updateMany({
          where: { providerId, status: { not: 'APPROVED' } },
          data: { status: 'APPROVED' },
        }),
      ]);
      await notifyProviderStaff(
        providerId,
        'SYSTEM',
        'Your business is verified 🎉',
        `${provider.name} has been approved. Your store is now live on the Voryn Connect app.`,
      );
      sendData(res, await verificationView(providerId));
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/verifications/:providerId/reject',
  validate({ body: z.object({ notes: z.string().min(3).max(1000) }) }),
  async (req, res, next) => {
    try {
      const providerId = req.params.providerId!;
      const provider = await prisma.provider.findUnique({ where: { id: providerId } });
      if (!provider) throw AppError.notFound('Provider not found');
      const admin = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
      const open = await latestOpenVerification(providerId);
      const reviewFields = {
        status: 'REJECTED' as const,
        notes: (req.body as { notes: string }).notes,
        reviewedBy: admin.email ?? admin.id,
        reviewedAt: new Date(),
      };
      await prisma.$transaction([
        open
          ? prisma.providerVerification.update({ where: { id: open.id }, data: reviewFields })
          : prisma.providerVerification.create({ data: { providerId, ...reviewFields } }),
        prisma.provider.update({
          where: { id: providerId },
          data: { status: 'PENDING_VERIFICATION', isVerified: false },
        }),
      ]);
      await notifyProviderStaff(
        providerId,
        'SYSTEM',
        'Verification needs attention',
        `Your application was not approved: ${reviewFields.notes} — update your details and resubmit.`,
      );
      sendData(res, await verificationView(providerId));
    } catch (err) {
      next(err);
    }
  },
);
