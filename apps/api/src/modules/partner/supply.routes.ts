import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { orderCode } from '../../lib/codes';
import { notifyProviderStaff } from '../../lib/notify';
import { validate } from '../../middleware/validate';
import { sendData } from './partner.middleware';
import { toMajor } from './partner.service';

/**
 * Voryn Supply — B2B restocking between partners.
 *
 * Verified SUPPLIER providers list a wholesale catalog (their normal Product
 * catalog); other partners browse them here and place restock orders.
 * Suppliers are NEVER visible to customers (discovery + checkout exclude the
 * SUPPLIER category). Payment is settled between the two businesses on
 * delivery; the platform records the order, totals and status only.
 *
 * Mounted under /v1/partner (requirePartner), dashboard envelope {ok,data},
 * money in MAJOR units at this boundary like the rest of the partner API.
 */
export const supplyRouter = Router();

const ORDER_INCLUDE = {
  items: true,
  supplier: { select: { id: true, name: true, logoUrl: true, phone: true, email: true } },
  buyer: { select: { id: true, name: true, logoUrl: true, phone: true, email: true } },
} satisfies Prisma.SupplyOrderInclude;

type OrderWithRelations = Prisma.SupplyOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

function orderView(order: OrderWithRelations, viewerProviderId: string) {
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    role: order.supplierId === viewerProviderId ? 'supplier' : 'buyer',
    supplier: order.supplier,
    buyer: order.buyer,
    note: order.note,
    subtotal: toMajor(order.subtotalMinor),
    total: toMajor(order.totalMinor),
    items: order.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.name,
      unitPrice: toMajor(i.unitPriceMinor),
      quantity: i.quantity,
      lineTotal: toMajor(i.unitPriceMinor * i.quantity),
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/** Marketplace: every verified supplier, with a peek at their catalog size. */
supplyRouter.get('/suppliers', async (req, res, next) => {
  try {
    const suppliers = await prisma.provider.findMany({
      where: {
        status: 'ACTIVE',
        categories: { has: 'SUPPLIER' },
        id: { not: req.partner!.providerId }, // don't offer a supplier to itself
      },
      orderBy: [{ ratingAvg: 'desc' }, { createdAt: 'asc' }],
      include: {
        branches: { where: { isPrimary: true }, take: 1, select: { city: true, parish: true } },
        stores: {
          where: { isActive: true },
          select: { _count: { select: { products: { where: { isActive: true } } } } },
        },
      },
    });
    sendData(res, {
      suppliers: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? '',
        logoUrl: s.logoUrl,
        coverUrl: s.coverUrl,
        isVerified: s.isVerified,
        city: s.branches[0]?.city ?? 'Portmore',
        parish: s.branches[0]?.parish ?? 'St. Catherine',
        productsCount: s.stores.reduce((n, st) => n + st._count.products, 0),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** Supplier detail + wholesale catalog. */
supplyRouter.get('/suppliers/:id', async (req, res, next) => {
  try {
    const supplier = await prisma.provider.findFirst({
      where: { id: req.params.id!, status: 'ACTIVE', categories: { has: 'SUPPLIER' } },
      include: {
        branches: { where: { isPrimary: true }, take: 1 },
        stores: {
          where: { isActive: true },
          include: {
            products: {
              where: { isActive: true },
              orderBy: { name: 'asc' },
              include: { inventory: { select: { quantity: true, isInStock: true } } },
            },
          },
        },
      },
    });
    if (!supplier) throw AppError.notFound('Supplier not found');
    const branch = supplier.branches[0];
    sendData(res, {
      supplier: {
        id: supplier.id,
        name: supplier.name,
        description: supplier.description ?? '',
        logoUrl: supplier.logoUrl,
        coverUrl: supplier.coverUrl,
        isVerified: supplier.isVerified,
        phone: supplier.phone,
        email: supplier.email,
        address: branch ? `${branch.line1}, ${branch.city}` : 'Portmore',
      },
      products: supplier.stores.flatMap((st) =>
        st.products.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description ?? '',
          price: toMajor(p.priceMinor),
          imageUrl: p.imageUrl,
          inStock: p.inventory ? p.inventory.isInStock && p.inventory.quantity > 0 : true,
          quantityAvailable: p.inventory?.quantity ?? 0,
        })),
      ),
    });
  } catch (err) {
    next(err);
  }
});

const placeOrderSchema = z.object({
  supplierId: z.string().min(1),
  note: z.string().max(500).optional(),
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(9999) }))
    .min(1)
    .max(100),
});

/** Place a restock order with a verified supplier. */
supplyRouter.post('/supply-orders', validate({ body: placeOrderSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof placeOrderSchema>;
    const buyerId = req.partner!.providerId;
    if (body.supplierId === buyerId) {
      throw AppError.badRequest('You cannot place a restock order with your own business.', 'SELF_ORDER');
    }
    const supplier = await prisma.provider.findFirst({
      where: { id: body.supplierId, status: 'ACTIVE', categories: { has: 'SUPPLIER' } },
    });
    if (!supplier) throw AppError.notFound('Supplier not found or not verified');

    const products = await prisma.product.findMany({
      where: {
        id: { in: body.items.map((i) => i.productId) },
        isActive: true,
        store: { providerId: supplier.id },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const missing = body.items.filter((i) => !byId.has(i.productId));
    if (missing.length > 0) {
      throw AppError.badRequest('Some items are no longer in this supplier\'s catalog.', 'ITEM_UNAVAILABLE');
    }

    const subtotalMinor = body.items.reduce(
      (sum, i) => sum + byId.get(i.productId)!.priceMinor * i.quantity,
      0,
    );

    const order = await prisma.supplyOrder.create({
      data: {
        code: orderCode('SO'),
        supplierId: supplier.id,
        buyerId,
        note: body.note?.trim() || null,
        subtotalMinor,
        totalMinor: subtotalMinor,
        items: {
          create: body.items.map((i) => {
            const p = byId.get(i.productId)!;
            return { productId: p.id, name: p.name, unitPriceMinor: p.priceMinor, quantity: i.quantity };
          }),
        },
      },
      include: ORDER_INCLUDE,
    });

    await notifyProviderStaff(
      supplier.id,
      'SYSTEM',
      'New restock order',
      `${order.buyer.name} placed restock order ${order.code}. Review it in Supply Orders.`,
    );
    sendData(res, { order: orderView(order, buyerId) }, 201);
  } catch (err) {
    next(err);
  }
});

/** My supply orders, as buyer (restocks I placed) or supplier (orders I received). */
supplyRouter.get(
  '/supply-orders',
  validate({
    query: z.object({
      role: z.enum(['buyer', 'supplier']).default('buyer'),
      status: z.enum(['PLACED', 'CONFIRMED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { role, status } = req.query as { role: 'buyer' | 'supplier'; status?: string };
      const providerId = req.partner!.providerId;
      const orders = await prisma.supplyOrder.findMany({
        where: {
          ...(role === 'buyer' ? { buyerId: providerId } : { supplierId: providerId }),
          ...(status ? { status: status as never } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: ORDER_INCLUDE,
      });
      sendData(res, { orders: orders.map((o) => orderView(o, providerId)) });
    } catch (err) {
      next(err);
    }
  },
);

supplyRouter.get('/supply-orders/:id', async (req, res, next) => {
  try {
    const providerId = req.partner!.providerId;
    const order = await prisma.supplyOrder.findFirst({
      where: { id: req.params.id!, OR: [{ buyerId: providerId }, { supplierId: providerId }] },
      include: ORDER_INCLUDE,
    });
    if (!order) throw AppError.notFound('Supply order not found');
    sendData(res, { order: orderView(order, providerId) });
  } catch (err) {
    next(err);
  }
});

/**
 * Status flow. Supplier drives fulfilment; the buyer can cancel while the
 * order is still PLACED, and the supplier can decline up to CONFIRMED.
 */
const TRANSITIONS: Record<string, { from: string[]; by: 'supplier' | 'buyer' | 'either'; to: string }> = {
  confirm: { from: ['PLACED'], by: 'supplier', to: 'CONFIRMED' },
  out_for_delivery: { from: ['CONFIRMED'], by: 'supplier', to: 'OUT_FOR_DELIVERY' },
  delivered: { from: ['CONFIRMED', 'OUT_FOR_DELIVERY'], by: 'supplier', to: 'DELIVERED' },
  cancel: { from: ['PLACED', 'CONFIRMED'], by: 'either', to: 'CANCELLED' },
};

supplyRouter.post(
  '/supply-orders/:id/status',
  validate({ body: z.object({ action: z.enum(['confirm', 'out_for_delivery', 'delivered', 'cancel']) }) }),
  async (req, res, next) => {
    try {
      const providerId = req.partner!.providerId;
      const { action } = req.body as { action: keyof typeof TRANSITIONS };
      const order = await prisma.supplyOrder.findFirst({
        where: { id: req.params.id!, OR: [{ buyerId: providerId }, { supplierId: providerId }] },
        include: ORDER_INCLUDE,
      });
      if (!order) throw AppError.notFound('Supply order not found');

      const rule = TRANSITIONS[action]!;
      const role = order.supplierId === providerId ? 'supplier' : 'buyer';
      if (rule.by !== 'either' && rule.by !== role) {
        throw AppError.forbidden(`Only the ${rule.by} can do this.`, 'WRONG_ROLE');
      }
      // Buyers can only cancel while the order is still PLACED.
      const allowedFrom = action === 'cancel' && role === 'buyer' ? ['PLACED'] : rule.from;
      if (!allowedFrom.includes(order.status)) {
        throw AppError.conflict(
          `This order is ${order.status.toLowerCase().replace(/_/g, ' ')} and can no longer be ${action === 'cancel' ? 'cancelled' : 'updated this way'}.`,
          'INVALID_TRANSITION',
        );
      }

      const updated = await prisma.supplyOrder.update({
        where: { id: order.id },
        data: { status: rule.to as never },
        include: ORDER_INCLUDE,
      });

      const counterpartyId = role === 'supplier' ? order.buyerId : order.supplierId;
      const label: Record<string, string> = {
        CONFIRMED: `Restock order ${order.code} was confirmed by ${order.supplier.name}.`,
        OUT_FOR_DELIVERY: `Restock order ${order.code} is out for delivery.`,
        DELIVERED: `Restock order ${order.code} was delivered. Settle payment with ${role === 'supplier' ? order.supplier.name : order.buyer.name} as agreed.`,
        CANCELLED: `Restock order ${order.code} was cancelled by ${role === 'supplier' ? order.supplier.name : order.buyer.name}.`,
      };
      await notifyProviderStaff(counterpartyId, 'SYSTEM', 'Supply order update', label[rule.to]!);

      sendData(res, { order: orderView(updated, providerId) });
    } catch (err) {
      next(err);
    }
  },
);
