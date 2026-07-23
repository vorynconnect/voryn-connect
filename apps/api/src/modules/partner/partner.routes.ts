import { Router } from 'express';
import { z } from 'zod';
import { BookingStatus, OrderStatus, Prisma, type ProviderCategory } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { createImageUpload, publicUploadUrl } from '../../lib/uploads';
import { haversineKm } from '../../lib/pricing';
import { validate } from '../../middleware/validate';
import { ordersService } from '../orders/orders.service';
import { bookingsService } from '../bookings/bookings.service';
import { requirePartner, sendData } from './partner.middleware';
import { verificationRouter } from './verification.routes';
import { supplyRouter } from './supply.routes';
import {
  BOOKING_TRANSITION_LABELS,
  ORDER_TRANSITION_LABELS,
  bookingView,
  orderView,
  partnerView,
  resolveBookingTransition,
  resolveOrderTransition,
  storefrontView,
  toMajor,
  toMinor,
} from './partner.service';
import { getProviderDetailForApp } from '../discovery/discovery.service';

export const partnerRouter = Router();
partnerRouter.use(requirePartner);
partnerRouter.use('/verification', verificationRouter);
partnerRouter.use('/', supplyRouter);

const ORDER_INCLUDE = {
  items: true,
  customer: { select: { fullName: true } },
  payment: true,
} satisfies Prisma.OrderInclude;

const BOOKING_INCLUDE = {
  customer: { select: { fullName: true } },
  payment: true,
  appointment: true,
} satisfies Prisma.ServiceBookingInclude;

// SUPPLIER uses the same Product catalog as stores; their catalog is the
// wholesale supply list partners restock from (never customer-visible).
const STORE_CATEGORIES = ['GROCERY', 'PHARMACY', 'CONVENIENCE', 'DRINKS', 'SUPPLIER'] as const;
const SERVICE_VERTICALS = { AUTO_CARE: 'AUTO_CARE', TECHNICIAN: 'TECHNICIAN', HOME_SERVICES: 'HOME_SERVICES' } as const;

type CatalogKind = 'menu' | 'store' | 'service' | 'rental' | 'none';

function catalogKind(categories: string[]): CatalogKind {
  if (categories.includes('RESTAURANT')) return 'menu';
  if (STORE_CATEGORIES.some((c) => categories.includes(c))) return 'store';
  if (categories.includes('VEHICLE_RENTAL')) return 'rental';
  if (Object.keys(SERVICE_VERTICALS).some((v) => categories.includes(v))) return 'service';
  return 'none';
}

async function notifyCustomer(userId: string, type: 'ORDER_UPDATE' | 'BOOKING_UPDATE', title: string, body: string) {
  await prisma.notification.create({ data: { userId, type, title, body } });
}

// ── Profile & storefront ─────────────────────────────────────

partnerRouter.get('/me', async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.auth!.sub },
      include: { customerProfile: { select: { avatarUrl: true } } },
    });
    sendData(res, {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.customerProfile?.avatarUrl ?? null,
      },
      partner: await partnerView(req.partner!.provider),
    });
  } catch (err) {
    next(err);
  }
});

/** Staff profile photo — upload an image via /uploads/images first, then save the URL here. */
partnerRouter.patch(
  '/me',
  validate({ body: z.object({ avatarUrl: z.string().url().nullable() }) }),
  async (req, res, next) => {
    try {
      const { avatarUrl } = req.body;
      const user = await prisma.user.update({
        where: { id: req.auth!.sub },
        data: {
          customerProfile: {
            upsert: { create: { avatarUrl }, update: { avatarUrl } },
          },
        },
        include: { customerProfile: { select: { avatarUrl: true } } },
      });
      sendData(res, {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          avatarUrl: user.customerProfile?.avatarUrl ?? null,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

partnerRouter.get('/storefront', async (req, res, next) => {
  try {
    const provider = await prisma.provider.findUniqueOrThrow({ where: { id: req.partner!.providerId } });
    sendData(res, { ...storefrontView(provider), partnerOrg: await partnerView(provider) });
  } catch (err) {
    next(err);
  }
});

partnerRouter.patch(
  '/storefront',
  validate({
    body: z.object({
      isOpen: z.boolean().optional(),
      displayName: z.string().min(2).max(100).optional(),
      description: z.string().max(2000).optional(),
      logoUrl: z.string().url().optional(),
      bannerUrl: z.string().url().optional(),
      contactPhone: z.string().max(25).optional(),
      contactEmail: z.string().email().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { isOpen, displayName, description, logoUrl, bannerUrl, contactPhone, contactEmail } = req.body;
      const provider = await prisma.provider.update({
        where: { id: req.partner!.providerId },
        data: {
          ...(isOpen === undefined ? {} : { isOpen }),
          ...(displayName ? { name: displayName } : {}),
          ...(description === undefined ? {} : { description }),
          ...(logoUrl ? { logoUrl } : {}),
          ...(bannerUrl ? { coverUrl: bannerUrl } : {}),
          ...(contactPhone ? { phone: contactPhone } : {}),
          ...(contactEmail ? { email: contactEmail } : {}),
        },
      });
      await prisma.auditLog.create({
        data: {
          userId: req.auth!.sub,
          action: 'partner.storefront.update',
          entity: 'Provider',
          entityId: provider.id,
          metadata: req.body as Prisma.InputJsonValue,
        },
      });
      sendData(res, storefrontView(provider));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Live "as seen in the app" preview. Returns the exact payload the customer
 * app renders for this provider (same query via getProviderDetailForApp), so
 * the dashboard preview cannot drift from what customers see. Works while the
 * provider is still unpublished — `live` tells the dashboard whether the
 * storefront is actually visible to customers yet.
 */
partnerRouter.get('/storefront/preview', async (req, res, next) => {
  try {
    const provider = await getProviderDetailForApp(req.partner!.providerId);
    if (!provider) throw AppError.notFound('Provider not found');
    sendData(res, { provider, live: provider.status === 'ACTIVE' && provider.isOpen });
  } catch (err) {
    next(err);
  }
});

partnerRouter.post('/storefront/publish', async (req, res, next) => {
  try {
    const current = req.partner!.provider;
    if (current.status !== 'ACTIVE' && !current.isVerified) {
      throw AppError.forbidden(
        'Your business is pending verification. Publishing unlocks once Voryn approves your documents.',
        'NOT_VERIFIED',
      );
    }
    const provider = await prisma.provider.update({
      where: { id: current.id },
      data: { status: 'ACTIVE' },
    });
    await prisma.auditLog.create({
      data: { userId: req.auth!.sub, action: 'partner.storefront.publish', entity: 'Provider', entityId: provider.id },
    });
    sendData(res, storefrontView(provider));
  } catch (err) {
    next(err);
  }
});

// ── Dashboard stats ──────────────────────────────────────────

partnerRouter.get('/dashboard', async (req, res, next) => {
  try {
    const providerId = req.partner!.providerId;
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);

    const [pendingOrders, pendingBookings, unreadNotifications, recentOrders, recentBookings, completedItems] =
      await Promise.all([
        prisma.order.count({ where: { providerId, status: OrderStatus.PLACED } }),
        prisma.serviceBooking.count({ where: { providerId, status: BookingStatus.BOOKED } }),
        prisma.notification.count({ where: { userId: req.auth!.sub, readAt: null } }),
        prisma.order.findMany({
          where: { providerId, status: { not: OrderStatus.PENDING_PAYMENT } },
          include: ORDER_INCLUDE,
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        prisma.serviceBooking.findMany({
          where: { providerId, status: { not: BookingStatus.PENDING_PAYMENT } },
          include: BOOKING_INCLUDE,
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        prisma.orderItem.findMany({
          where: { order: { providerId, status: { in: [OrderStatus.COMPLETED, OrderStatus.DELIVERED] } } },
          select: { name: true, quantity: true, unitPriceMinor: true },
          take: 500,
        }),
      ]);

    const byName = new Map<string, { unitsSold: number; revenueMinor: number }>();
    for (const item of completedItems) {
      const entry = byName.get(item.name) ?? { unitsSold: 0, revenueMinor: 0 };
      entry.unitsSold += item.quantity;
      entry.revenueMinor += item.unitPriceMinor * item.quantity;
      byName.set(item.name, entry);
    }
    const topItems = [...byName.entries()]
      .sort((a, b) => b[1].revenueMinor - a[1].revenueMinor)
      .slice(0, 5)
      .map(([name, v]) => ({ name, unitsSold: v.unitsSold, revenue: toMajor(v.revenueMinor) }));

    const [weekOrders, weekBookings] = await Promise.all([
      prisma.order.findMany({
        where: { providerId, status: { in: [OrderStatus.COMPLETED, OrderStatus.DELIVERED] }, updatedAt: { gte: weekAgo } },
        select: { totalMinor: true, serviceFeeMinor: true, updatedAt: true },
      }),
      prisma.serviceBooking.findMany({
        where: { providerId, status: BookingStatus.COMPLETED, updatedAt: { gte: weekAgo } },
        select: { totalMinor: true, convenienceFeeMinor: true, updatedAt: true },
      }),
    ]);
    const days: { label: string; value: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date(Date.now() - i * 86_400_000);
      const label = day.toLocaleDateString('en-JM', { weekday: 'short' });
      const sameDay = (d: Date) => d.toDateString() === day.toDateString();
      const net =
        weekOrders.filter((o) => sameDay(o.updatedAt)).reduce((s, o) => s + o.totalMinor - o.serviceFeeMinor, 0) +
        weekBookings.filter((b) => sameDay(b.updatedAt)).reduce((s, b) => s + b.totalMinor - b.convenienceFeeMinor, 0);
      days.push({ label, value: toMajor(net) });
    }

    sendData(res, {
      stats: {
        isOpen: req.partner!.provider.isOpen,
        pendingOrders,
        pendingBookings,
        unreadNotifications,
      },
      recentOrders: recentOrders.map(orderView),
      recentBookings: recentBookings.map(bookingView),
      topItems,
      earningsSeries: days,
    });
  } catch (err) {
    next(err);
  }
});

// ── Notifications (staff user scoped) ────────────────────────

partnerRouter.get('/notifications', async (req, res, next) => {
  try {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId: req.auth!.sub }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.notification.count({ where: { userId: req.auth!.sub, readAt: null } }),
    ]);
    sendData(res, {
      unread,
      total: items.length,
      items: items.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        status: n.readAt ? 'READ' : 'UNREAD',
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

partnerRouter.patch('/notifications/:id/read', async (req, res, next) => {
  try {
    const n = await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.auth!.sub } });
    if (!n) throw AppError.notFound('Notification not found');
    await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
    sendData(res, { message: 'Marked as read.' });
  } catch (err) {
    next(err);
  }
});

partnerRouter.patch('/notifications/read-all', async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.auth!.sub, readAt: null },
      data: { readAt: new Date() },
    });
    sendData(res, { message: 'All read.' });
  } catch (err) {
    next(err);
  }
});

// ── Orders ───────────────────────────────────────────────────

partnerRouter.get('/orders', async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { providerId: req.partner!.providerId, status: { not: OrderStatus.PENDING_PAYMENT } },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    sendData(res, orders.map(orderView));
  } catch (err) {
    next(err);
  }
});

/**
 * Live-map feed: active deliveries with the courier's latest position.
 * Customer drop-offs are rounded to ~110 m — the dashboard shows the area
 * being served, not the customer's front door.
 */
const LIVE_DELIVERY_STATUSES = [
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.COURIER_ASSIGNED,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
] as const;

const LIVE_DELIVERY_LABELS: Record<string, string> = {
  READY_FOR_PICKUP: 'Waiting for a courier',
  COURIER_ASSIGNED: 'Courier heading to you',
  PICKED_UP: 'Order collected',
  ON_THE_WAY: 'On the way to the customer',
};

const approx = (n: number) => Math.round(n * 1000) / 1000;

partnerRouter.get('/deliveries/active', async (req, res, next) => {
  try {
    const providerId = req.partner!.providerId;
    const [branch, orders] = await Promise.all([
      prisma.providerBranch.findFirst({
        where: { providerId, isActive: true },
        orderBy: { isPrimary: 'desc' },
        select: { name: true, latitude: true, longitude: true },
      }),
      prisma.order.findMany({
        where: { providerId, status: { in: [...LIVE_DELIVERY_STATUSES] } },
        include: { courier: { include: { user: { select: { fullName: true } } } } },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
    ]);

    const deliveries = await Promise.all(
      orders.map(async (order) => {
        const fix = order.courierId
          ? await prisma.liveLocation.findFirst({
              where: { subjectType: 'ORDER', subjectId: order.id },
              orderBy: { recordedAt: 'desc' },
              select: { latitude: true, longitude: true, heading: true, recordedAt: true },
            })
          : null;
        // Courier target: this branch until pickup, then the customer.
        const target =
          order.status === OrderStatus.COURIER_ASSIGNED
            ? branch
            : order.deliveryLat != null && order.deliveryLng != null
              ? { latitude: order.deliveryLat, longitude: order.deliveryLng }
              : null;
        const etaMinutes =
          fix && target
            ? Math.max(1, Math.round((haversineKm(fix.latitude, fix.longitude, target.latitude, target.longitude) / 24) * 60))
            : null;
        return {
          id: order.id,
          code: order.code,
          status: order.status,
          statusLabel: LIVE_DELIVERY_LABELS[order.status] ?? order.status,
          courierName: order.courier?.user.fullName ?? null,
          courierVehicle: order.courier?.vehicleType ?? null,
          courierLocation: fix
            ? { latitude: fix.latitude, longitude: fix.longitude, heading: fix.heading, recordedAt: fix.recordedAt }
            : null,
          dropoff:
            order.deliveryLat != null && order.deliveryLng != null
              ? { latitude: approx(order.deliveryLat), longitude: approx(order.deliveryLng) }
              : null,
          dropoffName: order.deliveryAddressName,
          etaMinutes,
          totalMajor: toMajor(order.totalMinor),
          updatedAt: order.updatedAt,
        };
      }),
    );

    sendData(res, { branch, deliveries });
  } catch (err) {
    next(err);
  }
});

partnerRouter.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, providerId: req.partner!.providerId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw AppError.notFound('Order not found');
    sendData(res, orderView(order));
  } catch (err) {
    next(err);
  }
});

partnerRouter.patch(
  '/orders/:id/status',
  validate({ body: z.object({ status: z.string().min(2), note: z.string().max(300).optional() }) }),
  async (req, res, next) => {
    try {
      const order = await prisma.order.findFirst({
        where: { id: req.params.id, providerId: req.partner!.providerId },
      });
      if (!order) throw AppError.notFound('Order not found');

      const target = resolveOrderTransition(order.status, req.body.status);
      const label = ORDER_TRANSITION_LABELS[target] ?? `Order ${target.toLowerCase()}`;
      await ordersService.transition(order.id, target, label, { by: 'partner-dashboard', note: req.body.note });
      await notifyCustomer(order.customerId, 'ORDER_UPDATE', label, `Order ${order.code}: ${label}.`);
      await prisma.auditLog.create({
        data: {
          userId: req.auth!.sub,
          action: 'partner.order.status',
          entity: 'Order',
          entityId: order.id,
          metadata: { from: order.status, to: target },
        },
      });

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
      sendData(res, orderView(updated));
    } catch (err) {
      next(err);
    }
  },
);

// ── Bookings ─────────────────────────────────────────────────

partnerRouter.get('/bookings', async (req, res, next) => {
  try {
    const bookings = await prisma.serviceBooking.findMany({
      where: { providerId: req.partner!.providerId, status: { not: BookingStatus.PENDING_PAYMENT } },
      include: BOOKING_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    sendData(res, bookings.map(bookingView));
  } catch (err) {
    next(err);
  }
});

partnerRouter.get('/bookings/:id', async (req, res, next) => {
  try {
    const booking = await prisma.serviceBooking.findFirst({
      where: { id: req.params.id, providerId: req.partner!.providerId },
      include: BOOKING_INCLUDE,
    });
    if (!booking) throw AppError.notFound('Booking not found');
    sendData(res, bookingView(booking));
  } catch (err) {
    next(err);
  }
});

partnerRouter.patch(
  '/bookings/:id/status',
  validate({ body: z.object({ status: z.string().min(2), note: z.string().max(300).optional() }) }),
  async (req, res, next) => {
    try {
      const booking = await prisma.serviceBooking.findFirst({
        where: { id: req.params.id, providerId: req.partner!.providerId },
      });
      if (!booking) throw AppError.notFound('Booking not found');

      const target = resolveBookingTransition(booking.status, req.body.status);
      const label = BOOKING_TRANSITION_LABELS[target] ?? `Booking ${target.toLowerCase()}`;
      if (target === BookingStatus.COMPLETED) {
        await bookingsService.complete(booking.id);
      } else {
        await bookingsService.transition(booking.id, target, label);
      }
      await notifyCustomer(booking.customerId, 'BOOKING_UPDATE', label, `Booking ${booking.code}: ${label}.`);
      await prisma.auditLog.create({
        data: {
          userId: req.auth!.sub,
          action: 'partner.booking.status',
          entity: 'ServiceBooking',
          entityId: booking.id,
          metadata: { from: booking.status, to: target },
        },
      });

      const updated = await prisma.serviceBooking.findUniqueOrThrow({
        where: { id: booking.id },
        include: BOOKING_INCLUDE,
      });
      sendData(res, bookingView(updated));
    } catch (err) {
      next(err);
    }
  },
);

// ── Catalog: products ────────────────────────────────────────

const productBody = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional().default(''),
  basePrice: z.number().nonnegative(),
  status: z.enum(['ACTIVE', 'OUT_OF_STOCK', 'INACTIVE']).default('ACTIVE'),
  quantityAvailable: z.number().int().min(0).optional(),
  imageUrl: z.string().url().optional(),
});

async function ensureStore(providerId: string, categories: string[], name: string) {
  const existing = await prisma.store.findFirst({ where: { providerId } });
  if (existing) return existing;
  const category = (STORE_CATEGORIES.find((c) => categories.includes(c)) ?? 'CONVENIENCE') as never;
  return prisma.store.create({ data: { providerId, name, category } });
}

async function ensureMenuCategory(providerId: string, providerName: string) {
  let restaurant = await prisma.restaurant.findFirst({ where: { providerId }, include: { menus: { include: { categories: true } } } });
  restaurant ??= await prisma.restaurant.create({
    data: { providerId, name: providerName, menus: { create: { name: 'Main menu' } } },
    include: { menus: { include: { categories: true } } },
  });
  const menu = restaurant.menus[0] ?? (await prisma.menu.create({ data: { restaurantId: restaurant.id }, include: { categories: true } }));
  const category = ('categories' in menu ? menu.categories[0] : undefined) ?? (await prisma.menuCategory.create({ data: { menuId: menu.id, name: 'Menu' } }));
  return category;
}

function productViewFromProduct(p: Prisma.ProductGetPayload<{ include: { inventory: true; category: true } }>) {
  const out = p.inventory ? !p.inventory.isInStock || p.inventory.quantity === 0 : false;
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    imageUrl: p.imageUrl,
    category: { name: p.category?.name ?? 'General' },
    sku: p.id.slice(-8).toUpperCase(),
    basePrice: toMajor(p.priceMinor),
    status: !p.isActive ? 'INACTIVE' : out ? 'OUT_OF_STOCK' : 'ACTIVE',
    inventory: { quantityAvailable: p.inventory?.quantity ?? 0 },
  };
}

function productViewFromMenuItem(m: { id: string; name: string; description: string | null; priceMinor: number; isAvailable: boolean; imageUrl: string | null }) {
  return {
    id: m.id,
    name: m.name,
    description: m.description ?? '',
    imageUrl: m.imageUrl,
    category: { name: 'Menu' },
    sku: m.id.slice(-8).toUpperCase(),
    basePrice: toMajor(m.priceMinor),
    status: m.isAvailable ? 'ACTIVE' : 'OUT_OF_STOCK',
    inventory: null,
  };
}

partnerRouter.get('/products', async (req, res, next) => {
  try {
    const { providerId, provider } = req.partner!;
    const kind = catalogKind(provider.categories);
    if (kind === 'menu') {
      const items = await prisma.menuItem.findMany({
        where: { category: { menu: { restaurant: { providerId } } } },
        orderBy: { createdAt: 'desc' },
      });
      sendData(res, items.map(productViewFromMenuItem));
      return;
    }
    if (kind === 'store') {
      const products = await prisma.product.findMany({
        where: { store: { providerId }, isActive: true },
        include: { inventory: true, category: true },
        orderBy: { createdAt: 'desc' },
      });
      sendData(res, products.map(productViewFromProduct));
      return;
    }
    sendData(res, []);
  } catch (err) {
    next(err);
  }
});

partnerRouter.post('/products', validate({ body: productBody }), async (req, res, next) => {
  try {
    const { providerId, provider } = req.partner!;
    const kind = catalogKind(provider.categories);
    const { name, description, basePrice, status, quantityAvailable, imageUrl } = req.body;

    if (kind === 'menu') {
      const category = await ensureMenuCategory(providerId, provider.name);
      const item = await prisma.menuItem.create({
        data: {
          categoryId: category.id,
          name,
          description,
          priceMinor: toMinor(basePrice),
          imageUrl,
          isAvailable: status === 'ACTIVE',
        },
      });
      sendData(res, productViewFromMenuItem(item), 201);
      return;
    }

    const store = await ensureStore(providerId, provider.categories, provider.name);
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        name,
        description,
        priceMinor: toMinor(basePrice),
        imageUrl,
        isActive: status !== 'INACTIVE',
        inventory: {
          create: {
            quantity: quantityAvailable ?? 0,
            isInStock: status === 'ACTIVE' && (quantityAvailable ?? 0) > 0,
          },
        },
      },
      include: { inventory: true, category: true },
    });
    sendData(res, productViewFromProduct(product), 201);
  } catch (err) {
    next(err);
  }
});

partnerRouter.patch('/products/:id', validate({ body: productBody.partial() }), async (req, res, next) => {
  try {
    const { providerId, provider } = req.partner!;
    const kind = catalogKind(provider.categories);
    const { name, description, basePrice, status, quantityAvailable, imageUrl } = req.body;

    if (kind === 'menu') {
      const item = await prisma.menuItem.findFirst({
        where: { id: req.params.id, category: { menu: { restaurant: { providerId } } } },
      });
      if (!item) throw AppError.notFound('Menu item not found');
      const updated = await prisma.menuItem.update({
        where: { id: item.id },
        data: {
          ...(name ? { name } : {}),
          ...(description === undefined ? {} : { description }),
          ...(basePrice === undefined ? {} : { priceMinor: toMinor(basePrice) }),
          ...(imageUrl ? { imageUrl } : {}),
          ...(status === undefined ? {} : { isAvailable: status === 'ACTIVE' }),
        },
      });
      sendData(res, productViewFromMenuItem(updated));
      return;
    }

    const product = await prisma.product.findFirst({
      where: { id: req.params.id, store: { providerId } },
      include: { inventory: true },
    });
    if (!product) throw AppError.notFound('Product not found');
    const quantity = quantityAvailable ?? product.inventory?.quantity ?? 0;
    const updated = await prisma.product.update({
      where: { id: product.id },
      data: {
        ...(name ? { name } : {}),
        ...(description === undefined ? {} : { description }),
        ...(basePrice === undefined ? {} : { priceMinor: toMinor(basePrice) }),
        ...(imageUrl ? { imageUrl } : {}),
        ...(status === undefined ? {} : { isActive: status !== 'INACTIVE' }),
        inventory: {
          upsert: {
            create: { quantity, isInStock: quantity > 0 && status !== 'OUT_OF_STOCK' },
            update: { quantity, isInStock: quantity > 0 && status !== 'OUT_OF_STOCK' },
          },
        },
      },
      include: { inventory: true, category: true },
    });
    sendData(res, productViewFromProduct(updated));
  } catch (err) {
    next(err);
  }
});

partnerRouter.delete('/products/:id', async (req, res, next) => {
  try {
    const { providerId, provider } = req.partner!;
    if (catalogKind(provider.categories) === 'menu') {
      const item = await prisma.menuItem.findFirst({
        where: { id: req.params.id, category: { menu: { restaurant: { providerId } } } },
      });
      if (!item) throw AppError.notFound('Menu item not found');
      await prisma.menuItem.delete({ where: { id: item.id } });
      sendData(res, { message: 'Menu item removed.' });
      return;
    }
    const product = await prisma.product.findFirst({ where: { id: req.params.id, store: { providerId } } });
    if (!product) throw AppError.notFound('Product not found');
    await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
    sendData(res, { message: 'Product archived.' });
  } catch (err) {
    next(err);
  }
});

// ── Catalog: services (service verticals + rental vehicles) ──

const serviceBody = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional().default(''),
  basePrice: z.number().nonnegative(),
  status: z.enum(['ACTIVE', 'OUT_OF_STOCK', 'INACTIVE']).default('ACTIVE'),
  imageUrl: z.string().url().optional(),
});

function serviceViewFromListing(l: Prisma.ServiceListingGetPayload<{ include: { packages: true; category: true } }>) {
  const prices = l.packages.filter((p) => p.isActive).map((p) => p.priceMinor);
  return {
    id: l.id,
    name: l.title,
    description: l.description ?? '',
    imageUrl: l.imageUrl,
    platformService: { name: l.category.name },
    basePrice: toMajor(prices.length ? Math.min(...prices) : 0),
    status: l.isActive ? 'ACTIVE' : 'INACTIVE',
  };
}

function serviceViewFromVehicle(v: { id: string; make: string; model: string; color: string | null; plateNo: string | null; dailyRateMinor: number; isActive: boolean }) {
  return {
    id: v.id,
    name: `${v.make} ${v.model}`,
    description: [v.color, v.plateNo].filter(Boolean).join(' • '),
    platformService: { name: 'Vehicle Rental' },
    basePrice: toMajor(v.dailyRateMinor),
    status: v.isActive ? 'ACTIVE' : 'INACTIVE',
  };
}

partnerRouter.get('/services', async (req, res, next) => {
  try {
    const { providerId, provider } = req.partner!;
    const kind = catalogKind(provider.categories);
    if (kind === 'rental') {
      const vehicles = await prisma.rentalVehicle.findMany({ where: { providerId }, orderBy: { createdAt: 'desc' } });
      sendData(res, vehicles.map(serviceViewFromVehicle));
      return;
    }
    if (kind === 'service') {
      const listings = await prisma.serviceListing.findMany({
        where: { providerId },
        include: { packages: true, category: true },
        orderBy: { createdAt: 'desc' },
      });
      sendData(res, listings.map(serviceViewFromListing));
      return;
    }
    sendData(res, []);
  } catch (err) {
    next(err);
  }
});

partnerRouter.post('/services', validate({ body: serviceBody }), async (req, res, next) => {
  try {
    const { providerId, provider } = req.partner!;
    const kind = catalogKind(provider.categories);
    const { name, description, basePrice, status, imageUrl } = req.body;

    if (kind === 'rental') {
      const [make, ...rest] = name.trim().split(/\s+/);
      const vehicle = await prisma.rentalVehicle.create({
        data: {
          providerId,
          make: make ?? name,
          model: rest.join(' ') || make || name,
          dailyRateMinor: toMinor(basePrice),
          depositMinor: toMinor(basePrice) * 2, // sensible default; editable later
          imageUrl,
          isActive: status === 'ACTIVE',
          pickupBranchName: 'Portmore Mall • Bay B',
        },
      });
      sendData(res, serviceViewFromVehicle(vehicle), 201);
      return;
    }

    if (kind !== 'service') {
      throw AppError.badRequest('This partner type does not list services.', 'UNSUPPORTED_CATALOG');
    }
    const vertical = Object.keys(SERVICE_VERTICALS).find((v) =>
      provider.categories.includes(v as ProviderCategory),
    ) as keyof typeof SERVICE_VERTICALS | undefined;
    const category = await prisma.serviceCategory.findFirst({ where: { vertical: vertical ?? 'HOME_SERVICES' } });
    if (!category) throw AppError.badRequest('No service category available for this vertical yet.');
    const listing = await prisma.serviceListing.create({
      data: {
        providerId,
        categoryId: category.id,
        title: name,
        description,
        imageUrl,
        isActive: status === 'ACTIVE',
        packages: {
          create: { name, description: 'Standard package', priceMinor: toMinor(basePrice), includedItems: [] },
        },
      },
      include: { packages: true, category: true },
    });
    sendData(res, serviceViewFromListing(listing), 201);
  } catch (err) {
    next(err);
  }
});

partnerRouter.patch('/services/:id', validate({ body: serviceBody.partial() }), async (req, res, next) => {
  try {
    const { providerId, provider } = req.partner!;
    const kind = catalogKind(provider.categories);
    const { name, description, basePrice, status, imageUrl } = req.body;

    if (kind === 'rental') {
      const vehicle = await prisma.rentalVehicle.findFirst({ where: { id: req.params.id, providerId } });
      if (!vehicle) throw AppError.notFound('Vehicle not found');
      const [make, ...rest] = (name ?? '').trim().split(/\s+/);
      const updated = await prisma.rentalVehicle.update({
        where: { id: vehicle.id },
        data: {
          ...(name ? { make: make!, model: rest.join(' ') || make! } : {}),
          ...(basePrice === undefined ? {} : { dailyRateMinor: toMinor(basePrice) }),
          ...(imageUrl ? { imageUrl } : {}),
          ...(status === undefined ? {} : { isActive: status === 'ACTIVE' }),
        },
      });
      sendData(res, serviceViewFromVehicle(updated));
      return;
    }

    const listing = await prisma.serviceListing.findFirst({
      where: { id: req.params.id, providerId },
      include: { packages: true, category: true },
    });
    if (!listing) throw AppError.notFound('Service not found');
    const updated = await prisma.serviceListing.update({
      where: { id: listing.id },
      data: {
        ...(name ? { title: name } : {}),
        ...(description === undefined ? {} : { description }),
        ...(imageUrl ? { imageUrl } : {}),
        ...(status === undefined ? {} : { isActive: status === 'ACTIVE' }),
      },
      include: { packages: true, category: true },
    });
    if (basePrice !== undefined && listing.packages[0]) {
      await prisma.servicePackage.update({
        where: { id: listing.packages[0].id },
        data: { priceMinor: toMinor(basePrice) },
      });
      updated.packages[0]!.priceMinor = toMinor(basePrice);
    }
    sendData(res, serviceViewFromListing(updated));
  } catch (err) {
    next(err);
  }
});

partnerRouter.delete('/services/:id', async (req, res, next) => {
  try {
    const { providerId, provider } = req.partner!;
    if (catalogKind(provider.categories) === 'rental') {
      const vehicle = await prisma.rentalVehicle.findFirst({ where: { id: req.params.id, providerId } });
      if (!vehicle) throw AppError.notFound('Vehicle not found');
      await prisma.rentalVehicle.update({ where: { id: vehicle.id }, data: { isActive: false } });
      sendData(res, { message: 'Vehicle deactivated.' });
      return;
    }
    const listing = await prisma.serviceListing.findFirst({ where: { id: req.params.id, providerId } });
    if (!listing) throw AppError.notFound('Service not found');
    await prisma.serviceListing.update({ where: { id: listing.id }, data: { isActive: false } });
    sendData(res, { message: 'Service deactivated.' });
  } catch (err) {
    next(err);
  }
});

// ── Earnings / payouts (read from the ProviderEarning ledger) ─────────

const EARNING_TYPE_LABEL: Record<string, string> = {
  order: 'orders',
  booking: 'bookings',
  rental: 'rentals',
};

/** Pending earnings clear to available once their clearance date passes. */
async function flipClearedEarnings(providerId: string) {
  await prisma.providerEarning.updateMany({
    where: { providerId, status: 'PENDING', availableAt: { lte: new Date() } },
    data: { status: 'AVAILABLE' },
  });
}

partnerRouter.get('/earnings', async (req, res, next) => {
  try {
    const providerId = req.partner!.providerId;
    await flipClearedEarnings(providerId);
    const rows = await prisma.providerEarning.findMany({
      where: { providerId, status: { not: 'REVERSED' } },
      orderBy: { createdAt: 'desc' },
    });

    const sumNet = (list: typeof rows) => list.reduce((s, r) => s + r.netMinor, 0);
    const startOfDay = new Date(new Date().toDateString());
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const grossMinor = rows.reduce((s, r) => s + r.grossMinor, 0);
    const commissionMinor = rows.reduce((s, r) => s + r.commissionMinor, 0);
    const pendingMinor = sumNet(rows.filter((r) => r.status === 'PENDING'));
    const availableMinor = sumNet(rows.filter((r) => r.status === 'AVAILABLE'));

    const byType = new Map<string, number>();
    for (const r of rows) {
      const label = EARNING_TYPE_LABEL[r.referenceType] ?? r.referenceType;
      byType.set(label, (byType.get(label) ?? 0) + r.netMinor);
    }

    const series: { label: string; value: number }[] = [];
    for (let i = 7; i >= 0; i -= 1) {
      const start = new Date(Date.now() - (i + 1) * 7 * 86_400_000);
      const end = new Date(Date.now() - i * 7 * 86_400_000);
      series.push({
        label: end.toLocaleDateString('en-JM', { month: 'short', day: 'numeric' }),
        value: toMajor(sumNet(rows.filter((r) => r.createdAt >= start && r.createdAt < end))),
      });
    }

    sendData(res, {
      summary: {
        today: toMajor(sumNet(rows.filter((r) => r.createdAt >= startOfDay))),
        thisWeek: toMajor(sumNet(rows.filter((r) => r.createdAt >= weekAgo))),
        thisMonth: toMajor(sumNet(rows.filter((r) => r.createdAt >= monthStart))),
        total: toMajor(sumNet(rows)),
        gross: toMajor(grossMinor),
        commission: toMajor(commissionMinor),
        commissionRate: rows[0] ? rows[0].commissionBps / 100 : null,
        pending: toMajor(pendingMinor),
        available: toMajor(availableMinor),
        avgOrderValue: rows.length ? toMajor(Math.round(grossMinor / rows.length)) : 0,
        count: rows.length,
      },
      breakdown: [...byType.entries()].map(([type, amountMinor]) => ({ type, amount: toMajor(amountMinor) })),
      series,
      history: rows.slice(0, 20).map((r) => ({
        id: r.id,
        type: EARNING_TYPE_LABEL[r.referenceType] ?? r.referenceType,
        reference: r.code,
        gross: toMajor(r.grossMinor),
        commission: toMajor(r.commissionMinor),
        rate: r.commissionBps / 100,
        net: toMajor(r.netMinor),
        status: r.status,
        availableAt: r.availableAt,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

partnerRouter.get('/payouts', async (req, res, next) => {
  try {
    const providerId = req.partner!.providerId;
    const payouts = await prisma.providerPayout.findMany({ where: { providerId }, orderBy: { createdAt: 'desc' } });
    const paidMinor = payouts.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountMinor, 0);
    const pendingMinor = payouts
      .filter((p) => p.status === 'REQUESTED' || p.status === 'PROCESSING')
      .reduce((s, p) => s + p.amountMinor, 0);

    // Wallet sections stay separate: available (cleared, minus payouts already
    // made or in flight) vs pending (still inside the clearance window).
    await flipClearedEarnings(providerId);
    const [availableAgg, pendingAgg] = await Promise.all([
      prisma.providerEarning.aggregate({
        where: { providerId, status: 'AVAILABLE' },
        _sum: { netMinor: true },
      }),
      prisma.providerEarning.aggregate({
        where: { providerId, status: 'PENDING' },
        _sum: { netMinor: true },
      }),
    ]);
    const availableNetMinor = availableAgg._sum.netMinor ?? 0;
    const pendingEarningsMinor = pendingAgg._sum.netMinor ?? 0;

    const lastPaid = payouts.find((p) => p.status === 'PAID');
    sendData(res, {
      available: toMajor(Math.max(0, availableNetMinor - paidMinor - pendingMinor)),
      pendingEarnings: toMajor(pendingEarningsMinor),
      pending: toMajor(pendingMinor),
      paid: toMajor(paidMinor),
      last: toMajor(lastPaid?.amountMinor ?? 0),
      lastDate: lastPaid?.paidAt ?? null,
      requestsEnabled: false,
      note: 'Payouts are reviewed and settled by Voryn Finance on a weekly cycle.',
      requests: payouts
        .filter((p) => p.status === 'REQUESTED' || p.status === 'PROCESSING')
        .map((p) => ({ id: p.id, amount: toMajor(p.amountMinor), status: p.status, createdAt: p.createdAt })),
      history: payouts.map((p) => ({
        id: p.id,
        amount: toMajor(p.amountMinor),
        status: p.status,
        provider: 'Bank transfer',
        processedAt: p.paidAt,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── Customers & reviews ──────────────────────────────────────

partnerRouter.get('/customers', async (req, res, next) => {
  try {
    const providerId = req.partner!.providerId;
    const [orders, bookings] = await Promise.all([
      prisma.order.findMany({
        where: { providerId, status: { not: OrderStatus.PENDING_PAYMENT } },
        select: { customerId: true, totalMinor: true, createdAt: true, customer: { select: { fullName: true } } },
      }),
      prisma.serviceBooking.findMany({
        where: { providerId, status: { not: BookingStatus.PENDING_PAYMENT } },
        select: { customerId: true, totalMinor: true, createdAt: true, customer: { select: { fullName: true } } },
      }),
    ]);
    const byCustomer = new Map<string, { name: string; interactions: number; spentMinor: number; lastAt: Date }>();
    for (const row of [...orders, ...bookings]) {
      const entry = byCustomer.get(row.customerId) ?? {
        name: row.customer.fullName,
        interactions: 0,
        spentMinor: 0,
        lastAt: row.createdAt,
      };
      entry.interactions += 1;
      entry.spentMinor += row.totalMinor;
      if (row.createdAt > entry.lastAt) entry.lastAt = row.createdAt;
      byCustomer.set(row.customerId, entry);
    }
    const list = [...byCustomer.values()]
      .sort((a, b) => b.spentMinor - a.spentMinor)
      .map((c) => ({ name: c.name, interactions: c.interactions, totalSpent: toMajor(c.spentMinor), lastAt: c.lastAt }));
    sendData(res, {
      total: list.length,
      returning: list.filter((c) => c.interactions > 1).length,
      list,
    });
  } catch (err) {
    next(err);
  }
});

partnerRouter.get('/reviews', async (req, res, next) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { providerId: req.partner!.providerId },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const total = reviews.length;
    const average = total ? reviews.reduce((s, r) => s + r.rating, 0) / total : 0;
    const positive = reviews.filter((r) => r.rating >= 4).length;
    const distribution = [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: reviews.filter((r) => r.rating === stars).length,
    }));
    sendData(res, {
      average: Math.round(average * 10) / 10,
      total,
      positive,
      positivePct: total ? Math.round((positive / total) * 100) : 0,
      distribution,
      list: reviews.map((r) => ({
        rating: r.rating,
        title: '',
        comment: r.comment ?? '',
        customer: r.user.fullName,
        replied: false,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── Support tickets ──────────────────────────────────────────

partnerRouter.get('/support/tickets', async (req, res, next) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.auth!.sub },
      orderBy: { createdAt: 'desc' },
    });
    sendData(res, {
      tickets: tickets.map((t) => ({
        id: t.id,
        subject: t.subject,
        description: t.description,
        status: t.status,
        createdAt: t.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

partnerRouter.post(
  '/support/tickets',
  validate({
    body: z.object({
      subject: z.string().min(3).max(150),
      description: z.string().min(3).max(2000),
      category: z.string().max(40).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const ticket = await prisma.supportTicket.create({
        data: {
          userId: req.auth!.sub,
          subject: req.body.subject,
          description: req.body.description,
          referenceType: req.body.category ?? 'PARTNER',
        },
      });
      sendData(res, { id: ticket.id, subject: ticket.subject, status: ticket.status, createdAt: ticket.createdAt }, 201);
    } catch (err) {
      next(err);
    }
  },
);

// ── Image uploads (validated; local disk or S3 per MEDIA_STORAGE) ────────────

const upload = createImageUpload((req) => `partner-${req.partner?.providerId ?? 'x'}`);

partnerRouter.post('/uploads/images', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) throw AppError.badRequest('Attach an image file in the "image" field.');
    const url = publicUploadUrl(req, req.file.filename);
    sendData(res, { url }, 201);
  } catch (err) {
    next(err);
  }
});
