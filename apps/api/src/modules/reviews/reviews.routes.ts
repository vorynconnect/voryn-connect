import { Router } from 'express';
import { z } from 'zod';
import { FavoriteType, ReviewSubjectType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

export const reviewsRouter = Router();
reviewsRouter.use(requireAuth);

reviewsRouter.post(
  '/',
  validate({
    body: z.object({
      subjectType: z.nativeEnum(ReviewSubjectType),
      subjectId: z.string(),
      providerId: z.string().optional(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(1000).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const review = await prisma.review.upsert({
        where: {
          userId_subjectType_subjectId: {
            userId: req.auth!.sub,
            subjectType: req.body.subjectType,
            subjectId: req.body.subjectId,
          },
        },
        create: { ...req.body, userId: req.auth!.sub },
        update: { rating: req.body.rating, comment: req.body.comment },
      });

      // Refresh the provider's rating aggregate.
      if (req.body.providerId) {
        const agg = await prisma.review.aggregate({
          where: { providerId: req.body.providerId },
          _avg: { rating: true },
          _count: true,
        });
        await prisma.provider.update({
          where: { id: req.body.providerId },
          data: {
            ratingAvg: Math.round((agg._avg.rating ?? 0) * 10) / 10,
            ratingCount: agg._count,
          },
        });
      }

      res.status(201).json({ review });
    } catch (err) {
      next(err);
    }
  },
);

reviewsRouter.get(
  '/provider/:providerId',
  validate({ query: z.object({ limit: z.coerce.number().default(20) }) }),
  async (req, res, next) => {
    try {
      const reviews = await prisma.review.findMany({
        where: { providerId: req.params.providerId },
        orderBy: { createdAt: 'desc' },
        take: Number((req.query as { limit?: number }).limit ?? 20),
        include: { user: { select: { fullName: true } } },
      });
      res.json({ reviews });
    } catch (err) {
      next(err);
    }
  },
);

// ── Favorites ───────────────────────────────────────────────

export const favoritesRouter = Router();
favoritesRouter.use(requireAuth);

favoritesRouter.get('/', async (req, res, next) => {
  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.auth!.sub },
      orderBy: { createdAt: 'desc' },
    });
    // Hydrate provider favorites for display.
    const providerIds = favorites.filter((f) => f.subjectType === 'PROVIDER').map((f) => f.subjectId);
    const providers = providerIds.length
      ? await prisma.provider.findMany({
          where: { id: { in: providerIds } },
          select: { id: true, name: true, logoUrl: true, categories: true, ratingAvg: true },
        })
      : [];
    res.json({ favorites, providers });
  } catch (err) {
    next(err);
  }
});

favoritesRouter.post(
  '/toggle',
  validate({
    body: z.object({ subjectType: z.nativeEnum(FavoriteType), subjectId: z.string() }),
  }),
  async (req, res, next) => {
    try {
      const key = {
        userId: req.auth!.sub,
        subjectType: req.body.subjectType,
        subjectId: req.body.subjectId,
      };
      const existing = await prisma.favorite.findUnique({
        where: { userId_subjectType_subjectId: key },
      });
      if (existing) {
        await prisma.favorite.delete({ where: { id: existing.id } });
        res.json({ favorited: false });
        return;
      }
      await prisma.favorite.create({ data: key });
      res.status(201).json({ favorited: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── Notifications ───────────────────────────────────────────

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.auth!.sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const unreadCount = await prisma.notification.count({
      where: { userId: req.auth!.sub, readAt: null },
    });
    res.json({ notifications, unreadCount });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/:id/read', async (req, res, next) => {
  try {
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.auth!.sub },
    });
    if (!notification) throw AppError.notFound('Notification not found');
    await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
    res.json({ message: 'Marked as read.' });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/read-all', async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.auth!.sub, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ message: 'All notifications marked as read.' });
  } catch (err) {
    next(err);
  }
});
