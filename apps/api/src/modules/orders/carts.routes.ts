import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { deliveryQuote } from './delivery-quote';

export const cartsRouter = Router();
cartsRouter.use(requireAuth);

async function getActiveCart(customerId: string) {
  return prisma.cart.findFirst({
    where: { customerId, isActive: true },
    include: { items: true, promoCode: true },
    orderBy: { updatedAt: 'desc' },
  });
}

cartsRouter.get('/', async (req, res, next) => {
  try {
    const cart = await getActiveCart(req.auth!.sub);
    // Distance-priced fee/ETA (default address) so the cart total matches checkout.
    let deliveryFeeMinor: number | null = null;
    let distanceKm: number | null = null;
    let etaMinMinutes: number | null = null;
    let etaMaxMinutes: number | null = null;
    if (cart && (cart.restaurantId || cart.storeId)) {
      const address = await prisma.address.findFirst({
        where: { userId: req.auth!.sub },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
      const quote = await deliveryQuote(
        cart,
        address ? { lat: address.latitude, lng: address.longitude } : null,
      );
      deliveryFeeMinor = quote.deliveryFeeMinor;
      distanceKm = quote.distanceKm;
      etaMinMinutes = quote.etaMinMinutes;
      etaMaxMinutes = quote.etaMaxMinutes;
    }
    res.json({ cart: cart ? { ...cart, deliveryFeeMinor, distanceKm, etaMinMinutes, etaMaxMinutes } : null });
  } catch (err) {
    next(err);
  }
});

const addItemBody = z.object({
  menuItemId: z.string().optional(),
  productId: z.string().optional(),
  quantity: z.number().int().min(1).max(50).default(1),
  options: z
    .array(z.object({ group: z.string(), name: z.string(), priceDeltaMinor: z.number().int() }))
    .default([]),
  notes: z.string().max(300).optional(),
});

cartsRouter.post('/items', validate({ body: addItemBody }), async (req, res, next) => {
  try {
    const { menuItemId, productId, quantity, options, notes } = req.body;
    if (!menuItemId && !productId) throw AppError.badRequest('Choose an item to add.');

    // Resolve item + owning merchant so carts stay single-merchant.
    let name: string;
    let imageUrl: string | null;
    let unitPriceMinor: number;
    let restaurantId: string | null = null;
    let storeId: string | null = null;

    if (menuItemId) {
      const item = await prisma.menuItem.findUnique({
        where: { id: menuItemId },
        include: { category: { include: { menu: true } } },
      });
      if (!item || !item.isAvailable) throw AppError.notFound('This item is no longer available.', 'ITEM_UNAVAILABLE');
      name = item.name;
      imageUrl = item.imageUrl;
      unitPriceMinor =
        item.priceMinor + options.reduce((sum: number, o: { priceDeltaMinor: number }) => sum + o.priceDeltaMinor, 0);
      restaurantId = item.category.menu.restaurantId;
    } else {
      const product = await prisma.product.findUnique({
        where: { id: productId! },
        include: { inventory: true },
      });
      if (!product || !product.isActive) throw AppError.notFound('This product is no longer available.', 'ITEM_UNAVAILABLE');
      if (product.inventory && (!product.inventory.isInStock || product.inventory.quantity < quantity)) {
        throw AppError.badRequest('This item is sold out.', 'ITEM_SOLD_OUT');
      }
      name = product.name;
      imageUrl = product.imageUrl;
      unitPriceMinor = product.priceMinor;
      storeId = product.storeId;
    }

    let cart = await getActiveCart(req.auth!.sub);
    const sameMerchant =
      cart && ((restaurantId && cart.restaurantId === restaurantId) || (storeId && cart.storeId === storeId));

    if (cart && !sameMerchant && cart.items.length > 0) {
      // Starting a new merchant replaces the previous cart (classic delivery UX).
      await prisma.cart.update({ where: { id: cart.id }, data: { isActive: false } });
      cart = null;
    }

    cart ??= await prisma.cart
      .create({
        data: { customerId: req.auth!.sub, restaurantId, storeId },
        include: { items: true, promoCode: true },
      });

    const item = await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        menuItemId,
        productId,
        name,
        imageUrl,
        unitPriceMinor,
        quantity,
        optionsJson: options,
        notes,
      },
    });

    const updated = await getActiveCart(req.auth!.sub);
    res.status(201).json({ cart: updated, addedItem: item });
  } catch (err) {
    next(err);
  }
});

cartsRouter.patch(
  '/items/:itemId',
  validate({ body: z.object({ quantity: z.number().int().min(0).max(50) }) }),
  async (req, res, next) => {
    try {
      const cart = await getActiveCart(req.auth!.sub);
      const item = cart?.items.find((i) => i.id === req.params.itemId);
      if (!cart || !item) throw AppError.notFound('Cart item not found');

      if (req.body.quantity === 0) {
        await prisma.cartItem.delete({ where: { id: item.id } });
      } else {
        await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: req.body.quantity } });
      }
      res.json({ cart: await getActiveCart(req.auth!.sub) });
    } catch (err) {
      next(err);
    }
  },
);

cartsRouter.delete('/items/:itemId', async (req, res, next) => {
  try {
    const cart = await getActiveCart(req.auth!.sub);
    const item = cart?.items.find((i) => i.id === req.params.itemId);
    if (!cart || !item) throw AppError.notFound('Cart item not found');
    await prisma.cartItem.delete({ where: { id: item.id } });
    res.json({ cart: await getActiveCart(req.auth!.sub) });
  } catch (err) {
    next(err);
  }
});

cartsRouter.post(
  '/promo-code',
  validate({ body: z.object({ code: z.string().min(2).max(40) }) }),
  async (req, res, next) => {
    try {
      const cart = await getActiveCart(req.auth!.sub);
      if (!cart) throw AppError.notFound('Your cart is empty.');
      const promo = await prisma.promoCode.findUnique({ where: { code: req.body.code.toUpperCase() } });
      if (!promo || !promo.isActive || (promo.expiresAt && promo.expiresAt < new Date())) {
        throw AppError.badRequest('This promo code is invalid or has expired.', 'PROMO_INVALID');
      }
      const uses = await prisma.promoRedemption.count({
        where: { promoCodeId: promo.id, userId: req.auth!.sub },
      });
      if (uses >= promo.perUserLimit) {
        throw AppError.badRequest('You have already used this promo code.', 'PROMO_USED');
      }
      await prisma.cart.update({ where: { id: cart.id }, data: { promoCodeId: promo.id } });
      res.json({ cart: await getActiveCart(req.auth!.sub) });
    } catch (err) {
      next(err);
    }
  },
);
