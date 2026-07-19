/**
 * Voryn Supply (B2B restocking) integration tests — run against the local dev
 * database. Covers: supplier signup category mapping, the customer-app
 * exclusion (suppliers must never be discoverable), the partner-side
 * marketplace, order placement and the fulfilment state machine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma';
import { createApp } from '../../app';

const app = createApp();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPass1!';

let supplierToken: string;
let supplierProviderId: string;
let supplierUserId: string;
let buyerToken: string;
let buyerProviderId: string;
let buyerUserId: string;
let customerToken: string;
let customerId: string;
let productA: { id: string; priceMinor: number };
let productB: { id: string; priceMinor: number };
let orderId: string;

const sAuth = () => ({ Authorization: `Bearer ${supplierToken}` });
const bAuth = () => ({ Authorization: `Bearer ${buyerToken}` });
const cAuth = () => ({ Authorization: `Bearer ${customerToken}` });

async function signupPartner(name: string, email: string, serviceType: string) {
  const res = await request(app)
    .post('/v1/partner/auth/signup')
    .send({ businessName: name, email, password: PASSWORD, serviceType })
    .expect(201);
  return { token: res.body.data.token as string, providerId: res.body.data.partner.id as string };
}

beforeAll(async () => {
  const passwordHash = await argon2.hash(PASSWORD);

  const customer = await prisma.user.create({
    data: {
      fullName: 'Supply Customer',
      email: `supply-customer-${stamp}@test.voryn.dev`,
      phone: `+1876002${stamp.slice(0, 4)}`,
      passwordHash,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      wallet: { create: {} },
    },
  });
  customerId = customer.id;
  const customerLogin = await request(app)
    .post('/v1/auth/login')
    .send({ identifier: customer.email, password: PASSWORD })
    .expect(200);
  customerToken = customerLogin.body.accessToken;

  const supplier = await signupPartner(
    `Supply Test Wholesale ${stamp.slice(0, 6)}`,
    `supply-supplier-${stamp}@test.voryn.dev`,
    'Supplier',
  );
  supplierToken = supplier.token;
  supplierProviderId = supplier.providerId;
  supplierUserId = (await prisma.providerStaff.findFirstOrThrow({ where: { providerId: supplierProviderId } })).userId;

  const buyer = await signupPartner(
    `Supply Test Grocery ${stamp.slice(0, 6)}`,
    `supply-buyer-${stamp}@test.voryn.dev`,
    'Grocery',
  );
  buyerToken = buyer.token;
  buyerProviderId = buyer.providerId;
  buyerUserId = (await prisma.providerStaff.findFirstOrThrow({ where: { providerId: buyerProviderId } })).userId;

  // Both pass verification (approved by the team elsewhere; set directly here).
  await prisma.provider.updateMany({
    where: { id: { in: [supplierProviderId, buyerProviderId] } },
    data: { status: 'ACTIVE', isVerified: true },
  });

  // Supplier wholesale catalog.
  const store = await prisma.store.create({
    data: { providerId: supplierProviderId, name: 'Wholesale Depot', category: 'SUPPLIER', isActive: true },
  });
  const a = await prisma.product.create({
    data: {
      storeId: store.id,
      name: `SupplyCase Flour ${stamp.slice(0, 6)}`,
      priceMinor: 250000, // JMD 2,500 per case
      isActive: true,
      inventory: { create: { quantity: 40, isInStock: true } },
    },
  });
  const b = await prisma.product.create({
    data: {
      storeId: store.id,
      name: `SupplyCase Oil ${stamp.slice(0, 6)}`,
      priceMinor: 480000, // JMD 4,800 per case
      isActive: true,
      inventory: { create: { quantity: 15, isInStock: true } },
    },
  });
  productA = { id: a.id, priceMinor: a.priceMinor };
  productB = { id: b.id, priceMinor: b.priceMinor };
});

afterAll(async () => {
  await prisma.supplyOrder.deleteMany({
    where: { OR: [{ supplierId: supplierProviderId }, { buyerId: buyerProviderId }] },
  }).catch(() => {});
  for (const providerId of [supplierProviderId, buyerProviderId]) {
    if (providerId) await prisma.provider.delete({ where: { id: providerId } }).catch(() => {});
  }
  for (const userId of [supplierUserId, buyerUserId, customerId]) {
    if (userId) {
      await prisma.notification.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  }
  await prisma.$disconnect();
});

describe('supplier accounts', () => {
  it('maps the Supplier service type to the SUPPLIER category', async () => {
    const provider = await prisma.provider.findUniqueOrThrow({ where: { id: supplierProviderId } });
    expect(provider.categories).toContain('SUPPLIER');
  });

  it('never shows suppliers in the customer app, even when ACTIVE', async () => {
    const list = await request(app)
      .get(`/v1/discovery/providers?q=Supply Test Wholesale ${stamp.slice(0, 6)}`)
      .set(cAuth())
      .expect(200);
    expect(list.body.providers).toHaveLength(0);

    const search = await request(app)
      .get(`/v1/discovery/search?q=SupplyCase Flour ${stamp.slice(0, 6)}`)
      .set(cAuth())
      .expect(200);
    expect(search.body.providers).toHaveLength(0);
    expect(search.body.products).toHaveLength(0);

    await request(app).get(`/v1/discovery/providers/${supplierProviderId}`).set(cAuth()).expect(404);
  });
});

describe('partner-side marketplace', () => {
  it('lists verified suppliers with catalog size', async () => {
    const res = await request(app).get('/v1/partner/suppliers').set(bAuth()).expect(200);
    const found = res.body.data.suppliers.find((s: { id: string }) => s.id === supplierProviderId);
    expect(found).toBeTruthy();
    expect(found.productsCount).toBe(2);
    expect(found.isVerified).toBe(true);
  });

  it('does not offer a supplier to itself', async () => {
    const res = await request(app).get('/v1/partner/suppliers').set(sAuth()).expect(200);
    const self = res.body.data.suppliers.find((s: { id: string }) => s.id === supplierProviderId);
    expect(self).toBeUndefined();
  });

  it('returns supplier detail with the wholesale catalog', async () => {
    const res = await request(app)
      .get(`/v1/partner/suppliers/${supplierProviderId}`)
      .set(bAuth())
      .expect(200);
    expect(res.body.data.products).toHaveLength(2);
    const flour = res.body.data.products.find((p: { id: string }) => p.id === productA.id);
    expect(flour.price).toBe(2500);
    expect(flour.inStock).toBe(true);
  });
});

describe('restock orders', () => {
  it('places a restock order with correct totals', async () => {
    const res = await request(app)
      .post('/v1/partner/supply-orders')
      .set(bAuth())
      .send({
        supplierId: supplierProviderId,
        note: 'Deliver to the back entrance please.',
        items: [
          { productId: productA.id, quantity: 4 }, // 4 × 2,500 = 10,000
          { productId: productB.id, quantity: 2 }, // 2 × 4,800 = 9,600
        ],
      })
      .expect(201);
    const order = res.body.data.order;
    orderId = order.id;
    expect(order.status).toBe('PLACED');
    expect(order.total).toBe(19600);
    expect(order.code).toMatch(/^SO-/);
    expect(order.role).toBe('buyer');

    const note = await prisma.notification.findFirst({
      where: { userId: supplierUserId, title: 'New restock order' },
    });
    expect(note?.body).toContain(order.code);
  });

  it('rejects ordering from yourself and unknown catalog items', async () => {
    const self = await request(app)
      .post('/v1/partner/supply-orders')
      .set(sAuth())
      .send({ supplierId: supplierProviderId, items: [{ productId: productA.id, quantity: 1 }] })
      .expect(400);
    expect(self.body.error.code).toBe('SELF_ORDER');

    const bad = await request(app)
      .post('/v1/partner/supply-orders')
      .set(bAuth())
      .send({ supplierId: supplierProviderId, items: [{ productId: 'nope', quantity: 1 }] })
      .expect(400);
    expect(bad.body.error.code).toBe('ITEM_UNAVAILABLE');
  });

  it('shows the order to both sides with the right role', async () => {
    const asBuyer = await request(app)
      .get('/v1/partner/supply-orders?role=buyer')
      .set(bAuth())
      .expect(200);
    expect(asBuyer.body.data.orders.map((o: { id: string }) => o.id)).toContain(orderId);

    const asSupplier = await request(app)
      .get('/v1/partner/supply-orders?role=supplier')
      .set(sAuth())
      .expect(200);
    const mine = asSupplier.body.data.orders.find((o: { id: string }) => o.id === orderId);
    expect(mine.role).toBe('supplier');
  });

  it('only the supplier can confirm', async () => {
    const wrong = await request(app)
      .post(`/v1/partner/supply-orders/${orderId}/status`)
      .set(bAuth())
      .send({ action: 'confirm' })
      .expect(403);
    expect(wrong.body.error.code).toBe('WRONG_ROLE');

    const ok = await request(app)
      .post(`/v1/partner/supply-orders/${orderId}/status`)
      .set(sAuth())
      .send({ action: 'confirm' })
      .expect(200);
    expect(ok.body.data.order.status).toBe('CONFIRMED');
  });

  it('buyer can no longer cancel after confirmation', async () => {
    const res = await request(app)
      .post(`/v1/partner/supply-orders/${orderId}/status`)
      .set(bAuth())
      .send({ action: 'cancel' })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('supplier delivers; buyer is notified', async () => {
    const res = await request(app)
      .post(`/v1/partner/supply-orders/${orderId}/status`)
      .set(sAuth())
      .send({ action: 'delivered' })
      .expect(200);
    expect(res.body.data.order.status).toBe('DELIVERED');

    const note = await prisma.notification.findFirst({
      where: { userId: buyerUserId, title: 'Supply order update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(note?.body).toContain('delivered');
  });
});
