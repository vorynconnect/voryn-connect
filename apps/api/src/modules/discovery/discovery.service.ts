import { prisma } from '../../lib/prisma';

/**
 * The customer app's provider-detail payload (GET /v1/discovery/providers/:id).
 * The partner dashboard's "store preview" uses THIS SAME function, so what a
 * partner previews is exactly what the app renders — one query, no drift.
 */
export async function getProviderDetailForApp(providerId: string) {
  return prisma.provider.findUnique({
    where: { id: providerId },
    include: {
      branches: { include: { operatingHours: true } },
      restaurants: {
        where: { isActive: true },
        include: {
          menus: {
            where: { isActive: true },
            include: {
              categories: {
                orderBy: { sortOrder: 'asc' },
                include: { items: { where: { isAvailable: true }, include: { options: true } } },
              },
            },
          },
        },
      },
      stores: {
        where: { isActive: true },
        include: {
          categories: { orderBy: { sortOrder: 'asc' }, include: { products: { where: { isActive: true } } } },
        },
      },
      serviceListings: {
        where: { isActive: true },
        include: { category: true, packages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      },
      rentalVehicles: { where: { isActive: true } },
    },
  });
}
