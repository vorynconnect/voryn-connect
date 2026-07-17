import { Router } from 'express';
import { z } from 'zod';
import { Prisma, ProviderCategory } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { getProviderDetailForApp } from './discovery.service';

export const discoveryRouter = Router();
discoveryRouter.use(requireAuth);

/** Home feed: promotions, popular nearby providers, and reorder suggestions. */
discoveryRouter.get('/home', async (req, res, next) => {
  try {
    const [promotions, popular, recentOrders] = await Promise.all([
      prisma.promotion.findMany({
        where: { isActive: true, startsAt: { lte: new Date() }, endsAt: { gte: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      prisma.provider.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }],
        take: 8,
        select: {
          id: true,
          name: true,
          slug: true,
          categories: true,
          logoUrl: true,
          coverUrl: true,
          ratingAvg: true,
          ratingCount: true,
          isVerified: true,
        },
      }),
      prisma.order.findMany({
        where: { customerId: req.auth!.sub, status: { in: ['DELIVERED', 'COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: {
          id: true,
          code: true,
          totalMinor: true,
          createdAt: true,
          provider: { select: { id: true, name: true, categories: true, logoUrl: true } },
        },
      }),
    ]);
    res.json({ promotions, popular, orderAgain: recentOrders });
  } catch (err) {
    next(err);
  }
});

const searchQuery = z.object({
  q: z.string().max(120).optional(),
  category: z.nativeEnum(ProviderCategory).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Global search across providers, restaurants, products, services. */
discoveryRouter.get('/search', validate({ query: searchQuery }), async (req, res, next) => {
  try {
    const { q, category, limit } = req.query as unknown as z.infer<typeof searchQuery>;
    const nameFilter: Prisma.StringFilter | undefined = q
      ? { contains: q, mode: 'insensitive' }
      : undefined;

    const [providers, menuItems, products, listings, vehicles] = await Promise.all([
      prisma.provider.findMany({
        where: {
          status: 'ACTIVE',
          ...(category ? { categories: { has: category } } : {}),
          ...(nameFilter ? { name: nameFilter } : {}),
        },
        take: limit,
        orderBy: { ratingAvg: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          categories: true,
          logoUrl: true,
          coverUrl: true,
          ratingAvg: true,
          ratingCount: true,
          isVerified: true,
        },
      }),
      q
        ? prisma.menuItem.findMany({
            where: { isAvailable: true, name: nameFilter },
            take: limit,
            include: {
              category: {
                include: { menu: { include: { restaurant: { select: { id: true, name: true, providerId: true } } } } },
              },
            },
          })
        : Promise.resolve([]),
      q
        ? prisma.product.findMany({
            where: { isActive: true, name: nameFilter },
            take: limit,
            include: { store: { select: { id: true, name: true, providerId: true } } },
          })
        : Promise.resolve([]),
      q
        ? prisma.serviceListing.findMany({
            where: {
              isActive: true,
              OR: [
                { title: nameFilter! },
                { category: { name: nameFilter! } },
                { tags: { has: q } },
              ],
            },
            take: limit,
            include: {
              provider: { select: { id: true, name: true, logoUrl: true, ratingAvg: true, ratingCount: true } },
              category: true,
              packages: { where: { isActive: true }, orderBy: { priceMinor: 'asc' }, take: 1 },
            },
          })
        : Promise.resolve([]),
      q
        ? prisma.rentalVehicle.findMany({
            where: {
              isActive: true,
              OR: [{ make: nameFilter! }, { model: nameFilter! }],
            },
            take: limit,
            include: {
              provider: { select: { id: true, name: true, logoUrl: true, ratingAvg: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    res.json({ providers, menuItems, products, serviceListings: listings, rentalVehicles: vehicles });
  } catch (err) {
    next(err);
  }
});

// ── Providers ───────────────────────────────────────────────

discoveryRouter.get(
  '/providers',
  validate({ query: searchQuery }),
  async (req, res, next) => {
    try {
      const { q, category, limit } = req.query as unknown as z.infer<typeof searchQuery>;
      const providers = await prisma.provider.findMany({
        where: {
          status: 'ACTIVE',
          ...(category ? { categories: { has: category } } : {}),
          ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
        },
        take: limit,
        orderBy: [{ ratingAvg: 'desc' }],
        include: {
          branches: { where: { isPrimary: true }, take: 1 },
        },
      });
      res.json({ providers });
    } catch (err) {
      next(err);
    }
  },
);

discoveryRouter.get('/providers/:id', async (req, res, next) => {
  try {
    const provider = await getProviderDetailForApp(req.params.id!);
    if (!provider || provider.status !== 'ACTIVE') throw AppError.notFound('Provider not found');
    res.json({ provider });
  } catch (err) {
    next(err);
  }
});

// ── Service categories & listings by vertical ───────────────

discoveryRouter.get(
  '/service-categories',
  validate({ query: z.object({ vertical: z.enum(['AUTO_CARE', 'TECHNICIAN', 'HOME_SERVICES']) }) }),
  async (req, res, next) => {
    try {
      const categories = await prisma.serviceCategory.findMany({
        where: { vertical: req.query.vertical as never },
        orderBy: { sortOrder: 'asc' },
      });
      res.json({ categories });
    } catch (err) {
      next(err);
    }
  },
);

discoveryRouter.get(
  '/service-listings',
  validate({
    query: z.object({
      vertical: z.enum(['AUTO_CARE', 'TECHNICIAN', 'HOME_SERVICES']).optional(),
      categorySlug: z.string().optional(),
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  }),
  async (req, res, next) => {
    try {
      const { vertical, categorySlug, q, limit } = req.query as {
        vertical?: 'AUTO_CARE' | 'TECHNICIAN' | 'HOME_SERVICES';
        categorySlug?: string;
        q?: string;
        limit?: number;
      };
      const listings = await prisma.serviceListing.findMany({
        where: {
          isActive: true,
          ...(vertical ? { category: { vertical } } : {}),
          ...(categorySlug ? { category: { slug: categorySlug } } : {}),
          ...(q
            ? {
                OR: [
                  { title: { contains: q, mode: 'insensitive' } },
                  { category: { name: { contains: q, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        take: limit ?? 20,
        orderBy: { provider: { ratingAvg: 'desc' } },
        include: {
          provider: {
            select: {
              id: true,
              name: true,
              logoUrl: true,
              coverUrl: true,
              ratingAvg: true,
              ratingCount: true,
              isVerified: true,
              branches: { where: { isPrimary: true }, take: 1, select: { latitude: true, longitude: true, line1: true } },
            },
          },
          category: true,
          packages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        },
      });
      res.json({ listings });
    } catch (err) {
      next(err);
    }
  },
);

// ── Restaurants & rental vehicles ───────────────────────────

discoveryRouter.get(
  '/restaurants',
  validate({ query: z.object({ q: z.string().optional(), limit: z.coerce.number().default(20) }) }),
  async (req, res, next) => {
    try {
      const { q, limit } = req.query as { q?: string; limit?: number };
      const restaurants = await prisma.restaurant.findMany({
        where: {
          isActive: true,
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { cuisineTags: { has: q } },
                ],
              }
            : {}),
        },
        take: Number(limit ?? 20),
        orderBy: [{ isPromoted: 'desc' }, { provider: { ratingAvg: 'desc' } }],
        include: {
          provider: { select: { id: true, name: true, logoUrl: true, ratingAvg: true, ratingCount: true, isVerified: true } },
        },
      });
      res.json({ restaurants });
    } catch (err) {
      next(err);
    }
  },
);

discoveryRouter.get(
  '/rental-vehicles',
  validate({
    query: z.object({
      q: z.string().optional(),
      category: z.enum(['ECONOMY', 'SEDAN', 'SUV', 'LUXURY', 'PREMIUM', 'VAN']).optional(),
      limit: z.coerce.number().default(20),
    }),
  }),
  async (req, res, next) => {
    try {
      const { q, category, limit } = req.query as { q?: string; category?: string; limit?: number };
      const vehicles = await prisma.rentalVehicle.findMany({
        where: {
          isActive: true,
          ...(category ? { category: category as never } : {}),
          ...(q
            ? {
                OR: [
                  { make: { contains: q, mode: 'insensitive' } },
                  { model: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        take: Number(limit ?? 20),
        orderBy: { dailyRateMinor: 'asc' },
        include: {
          provider: { select: { id: true, name: true, logoUrl: true, ratingAvg: true, isVerified: true } },
        },
      });
      res.json({ vehicles });
    } catch (err) {
      next(err);
    }
  },
);
