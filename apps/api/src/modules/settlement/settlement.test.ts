/**
 * Money-model integration tests: provider-funded commission, delivery-margin
 * courier pay, Voryn Points (1 pt = JMD 1, 20% cap, earn at delivery), and the
 * separated provider earnings ledger. Runs against the local dev database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma';
import { createApp } from '../../app';
import { ordersService } from '../orders/orders.service';
import {
  commissionBpsForProvider,
  deliverySplit,
  rideDriverEarningsMinor,
} from '../../lib/commission';
import { maxRedeemablePoints, pointsEarnedFor } from '../../lib/loyalty';

const app = createApp();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPass1!';
const BRANCH = { latitude: 17.9702, longitude: -76.8878 };

let customerId: string;
let customerToken: string;
let providerId: string;
let partnerToken: string;
let restaurantId: string;
let addressId: string;
let courierUserId: string;
let courierProfileId: string;

const auth = () => ({ Authorization: `Bearer ${customerToken}` });
const pAuth = () => ({ Authorization: `Bearer ${partnerToken}` });

async function walletBalance(userId: string): Promise<number> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return wallet.balanceMinor;
}

async function pointsBalance(userId: string): Promise<number> {
  const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId } });
  return account.pointsBalance;
}

/** Fresh single-merchant cart: 2 × JMD 2,000 items = JMD 4,000 subtotal. */
async function seedCart() {
  await prisma.cart.updateMany({ where: { customerId }, data: { isActive: false } });
  await prisma.cart.create({
    data: {
      customerId,
      restaurantId,
      items: {
        create: [
          { name: 'Jerk Chicken Meal', unitPriceMinor: 200000, quantity: 1 },
          { name: 'Festival Combo', unitPriceMinor: 200000, quantity: 1 },
        ],
      },
    },
  });
}

beforeAll(async () => {
  const passwordHash = await argon2.hash(PASSWORD);

  // Restaurant partner via the real signup (creates provider + staff + token).
  const signup = await request(app)
    .post('/v1/partner/auth/signup')
    .send({
      businessName: `Settle Test Kitchen ${stamp.slice(0, 6)}`,
      email: `settle-partner-${stamp}@test.voryn.dev`,
      password: PASSWORD,
      serviceType: 'Restaurant / Food Delivery',
    })
    .expect(201);
  partnerToken = signup.body.data.token;
  providerId = signup.body.data.partner.id;
  await prisma.provider.update({
    where: { id: providerId },
    data: {
      status: 'ACTIVE',
      isVerified: true,
      branches: { create: { name: 'Main', line1: '1 Test Way', isPrimary: true, ...BRANCH } },
    },
  });
  const restaurant = await prisma.restaurant.create({
    data: {
      providerId,
      name: 'Settle Test Kitchen',
      cuisineTags: ['Test'],
      deliveryFeeMinor: 25000, // JMD 250 base fee, covers the first 2 km
    },
  });
  restaurantId = restaurant.id;

  const customer = await prisma.user.create({
    data: {
      fullName: 'Settlement Tester',
      email: `settle-customer-${stamp}@test.voryn.dev`,
      phone: `+1876003${stamp.slice(0, 4)}`,
      passwordHash,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      wallet: { create: {} },
      loyaltyAccount: { create: { pointsBalance: 1000 } },
      addresses: {
        // Same coordinates as the branch: distance 0, so the delivery fee is
        // exactly the merchant base fee and the test math is deterministic.
        create: { name: 'Home', line1: '2 Test Way', isDefault: true, ...BRANCH },
      },
    },
    include: { addresses: true },
  });
  customerId = customer.id;
  addressId = customer.addresses[0]!.id;

  const login = await request(app)
    .post('/v1/auth/login')
    .send({ identifier: customer.email, password: PASSWORD })
    .expect(200);
  customerToken = login.body.accessToken;

  await request(app)
    .post('/v1/wallet/top-up')
    .set(auth())
    .send({ amountMinor: 5_000_000, idempotencyKey: `settle-topup-${stamp}` })
    .expect(201);

  const courier = await prisma.user.create({
    data: {
      fullName: 'Settle Courier',
      email: `settle-courier-${stamp}@test.voryn.dev`,
      phone: `+1876004${stamp.slice(0, 4)}`,
      passwordHash,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      wallet: { create: {} },
      courierProfile: { create: { vehicleType: 'moto' } },
    },
    include: { courierProfile: true },
  });
  courierUserId = courier.id;
  courierProfileId = courier.courierProfile!.id;
});

afterAll(async () => {
  await prisma.provider.delete({ where: { id: providerId } }).catch(() => {});
  await prisma.user.delete({ where: { id: customerId } }).catch(() => {});
  await prisma.user.delete({ where: { id: courierUserId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('commission and split math', () => {
  it('uses category defaults with per-provider overrides', () => {
    expect(commissionBpsForProvider({ commissionBps: null, categories: ['RESTAURANT'] })).toBe(1000);
    expect(commissionBpsForProvider({ commissionBps: null, categories: ['GROCERY'] })).toBe(700);
    expect(commissionBpsForProvider({ commissionBps: null, categories: ['SUPPLIER'] })).toBe(400);
    expect(commissionBpsForProvider({ commissionBps: 850, categories: ['RESTAURANT'] })).toBe(850);
  });

  it('splits delivery fees into guaranteed courier pay plus a clamped margin', () => {
    // JMD 900 fee → JMD 200 margin (the spec example), courier gets JMD 700.
    expect(deliverySplit(90000)).toEqual({ courierCompensationMinor: 70000, vorynMarginMinor: 20000 });
    // JMD 250 fee → 22% rounds to JMD 60, courier gets JMD 190.
    expect(deliverySplit(25000)).toEqual({ courierCompensationMinor: 19000, vorynMarginMinor: 6000 });
    // JMD 150 fee → clamped up to the JMD 50 minimum margin.
    expect(deliverySplit(15000)).toEqual({ courierCompensationMinor: 10000, vorynMarginMinor: 5000 });
  });

  it('prices ride commission at 12% of the fare, never tips', () => {
    expect(rideDriverEarningsMinor(100000)).toBe(88000);
  });

  it('caps redemption at 20% of the eligible amount', () => {
    expect(maxRedeemablePoints(400000, 1000)).toBe(800); // 20% of JMD 4,000
    expect(maxRedeemablePoints(400000, 300)).toBe(300); // balance is the binding cap
    expect(pointsEarnedFor(370000)).toBe(37); // 1 pt per JMD 100
  });
});

describe('order checkout with points', () => {
  let orderId: string;

  it('quotes the redeemable cap and charges the discounted total', async () => {
    await seedCart();
    const quote = await request(app).get(`/v1/orders/quote?addressId=${addressId}`).set(auth()).expect(200);
    expect(quote.body.quote.serviceFeeMinor).toBe(0); // no customer platform fee
    expect(quote.body.quote.points).toEqual({
      balance: 1000,
      maxRedeemable: 800,
      valueMinor: 100,
      maxPercent: 20,
    });

    const before = await walletBalance(customerId);
    const res = await request(app)
      .post('/v1/orders/checkout')
      .set(auth())
      .send({
        addressId,
        paymentMethodType: 'VORYN_WALLET',
        tipMinor: 30000,
        pointsToRedeem: 300,
        idempotencyKey: `settle-co-1-${stamp}`,
      })
      .expect(201);
    orderId = res.body.order.id;

    // 4,000 items + 250 delivery + 400 tax + 300 tip − 300 points = 4,650.
    expect(res.body.order.totalMinor).toBe(465000);
    expect(res.body.order.pointsRedeemed).toBe(300);
    expect(res.body.order.pointsDiscountMinor).toBe(30000);
    expect(before - (await walletBalance(customerId))).toBe(465000);
    expect(await pointsBalance(customerId)).toBe(700); // debited at checkout
  });

  it('settles once at delivery: merchant net, courier split, points earn, ledger', async () => {
    await ordersService.assignCourier(orderId, courierProfileId);
    await ordersService.transition(orderId, 'DELIVERED', 'Delivered');

    // Merchant earning: commission on the full subtotal — the Voryn-funded
    // points discount never reduces what the merchant is owed.
    const earning = await prisma.providerEarning.findUniqueOrThrow({
      where: { referenceType_referenceId: { referenceType: 'order', referenceId: orderId } },
    });
    expect(earning.providerId).toBe(providerId);
    expect(earning.grossMinor).toBe(400000);
    expect(earning.commissionBps).toBe(1000);
    expect(earning.commissionMinor).toBe(40000);
    expect(earning.netMinor).toBe(360000);
    expect(earning.status).toBe('PENDING');

    // Courier: JMD 250 fee − 60 margin = 190, plus the full JMD 300 tip.
    expect(await walletBalance(courierUserId)).toBe(49000);

    // Points earned at delivery on the eligible amount (4,000 − 300 = 3,700 → 37 pts).
    expect(await pointsBalance(customerId)).toBe(737);

    // Full breakdown recorded — refunds and reports never guess from totals.
    const records = await prisma.settlementRecord.findMany({
      where: { referenceType: 'order', referenceId: orderId },
    });
    const byType = Object.fromEntries(records.map((r) => [r.entryType, r.amountMinor]));
    expect(byType).toMatchObject({
      CUSTOMER_PAYMENT: 465000,
      MERCHANT_GROSS_SALE: 400000,
      VORYN_COMMISSION: 40000,
      PROVIDER_NET_EARNING: 360000,
      DELIVERY_FEE: 25000,
      COURIER_EARNING: 19000,
      VORYN_DELIVERY_MARGIN: 6000,
      TIP: 30000,
      TAX: 40000,
      VORYN_FUNDED_DISCOUNT: 30000,
      POINTS_REDEEMED: 30000,
      POINTS_EARNED: 3700,
    });
    expect(byType.SERVICE_FEE).toBeUndefined(); // zero rows are not written
  });

  it('is idempotent when the order later completes', async () => {
    await ordersService.transition(orderId, 'COMPLETED', 'Completed');
    const earnings = await prisma.providerEarning.findMany({
      where: { referenceType: 'order', referenceId: orderId },
    });
    expect(earnings).toHaveLength(1);
    expect(await walletBalance(courierUserId)).toBe(49000); // no double payout
    expect(await pointsBalance(customerId)).toBe(737); // no double earn
  });

  it('restores redeemed points when an order is cancelled', async () => {
    await seedCart();
    const res = await request(app)
      .post('/v1/orders/checkout')
      .set(auth())
      .send({
        addressId,
        paymentMethodType: 'VORYN_WALLET',
        pointsToRedeem: 200,
        idempotencyKey: `settle-co-2-${stamp}`,
      })
      .expect(201);
    expect(await pointsBalance(customerId)).toBe(537);
    const before = await walletBalance(customerId);

    await request(app)
      .post(`/v1/orders/${res.body.order.id}/cancel`)
      .set(auth())
      .send({ reason: 'Changed my mind' })
      .expect(200);

    expect(await pointsBalance(customerId)).toBe(737); // points back
    expect((await walletBalance(customerId)) - before).toBe(res.body.order.totalMinor); // money back
  });

  it('caps a greedy redemption request at 20% of the eligible amount', async () => {
    await seedCart();
    const res = await request(app)
      .post('/v1/orders/checkout')
      .set(auth())
      .send({
        addressId,
        paymentMethodType: 'VORYN_WALLET',
        pointsToRedeem: 999999,
        idempotencyKey: `settle-co-3-${stamp}`,
      })
      .expect(201);
    // Balance 737, 20% cap 800 → redeems 737, never over-spends.
    expect(res.body.order.pointsRedeemed).toBe(737);
    expect(await pointsBalance(customerId)).toBe(0);
  });
});

describe('provider earnings ledger', () => {
  it('keeps pending and available earnings separate, then clears by date', async () => {
    const first = await request(app).get('/v1/partner/earnings').set(pAuth()).expect(200);
    const summary = first.body.data.summary;
    expect(summary.commissionRate).toBe(10);
    expect(summary.pending).toBeGreaterThan(0); // inside the clearance window
    expect(summary.available).toBe(0);

    // Time passes: the clearance date arrives and reads flip the status.
    await prisma.providerEarning.updateMany({
      where: { providerId },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    const second = await request(app).get('/v1/partner/earnings').set(pAuth()).expect(200);
    expect(second.body.data.summary.available).toBeGreaterThan(0);
    expect(second.body.data.summary.pending).toBe(0);

    const payouts = await request(app).get('/v1/partner/payouts').set(pAuth()).expect(200);
    expect(payouts.body.data.available).toBe(second.body.data.summary.available);
    expect(payouts.body.data.pendingEarnings).toBe(0);
  });
});
