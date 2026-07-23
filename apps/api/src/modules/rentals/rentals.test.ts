/**
 * Rental lifecycle integration tests — run against the local dev database
 * (docker compose up -d). Each run creates isolated fixtures (unique emails,
 * slugs, plates) and removes them afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma';
import { createApp } from '../../app';
import { rentalsService } from './rentals.service';

const app = createApp();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPass1!';

let customerId: string;
let providerId: string;
let vehicleId: string;
let token: string;

async function walletBalance(userId: string): Promise<number> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return wallet.balanceMinor;
}

beforeAll(async () => {
  const passwordHash = await argon2.hash(PASSWORD);
  const customer = await prisma.user.create({
    data: {
      fullName: 'Rental Tester',
      email: `rental-test-${stamp}@test.voryn.dev`,
      phone: `+1876000${stamp.slice(0, 4)}`,
      passwordHash,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      wallet: { create: {} },
      loyaltyAccount: { create: {} },
    },
  });
  customerId = customer.id;

  const provider = await prisma.provider.create({
    data: {
      slug: `test-rentals-${stamp}`,
      name: 'Test Rentals Co',
      categories: ['VEHICLE_RENTAL'],
      status: 'ACTIVE',
      isVerified: true,
      isSeedData: true,
    },
  });
  providerId = provider.id;

  const vehicle = await prisma.rentalVehicle.create({
    data: {
      providerId,
      make: 'Toyota',
      model: 'Test Axio',
      category: 'ECONOMY',
      dailyRateMinor: 650000, // JMD 6,500 / day
      depositMinor: 500000,
      plateNo: `TST ${stamp.slice(0, 4)}`,
      pickupBranchName: 'Test Branch',
    },
  });
  vehicleId = vehicle.id;

  const login = await request(app)
    .post('/v1/auth/login')
    .send({ identifier: customer.email, password: PASSWORD })
    .expect(200);
  token = login.body.accessToken;

  // Fund the wallet through the public top-up flow (sandbox card capture).
  await request(app)
    .post('/v1/wallet/top-up')
    .set('Authorization', `Bearer ${token}`)
    .send({ amountMinor: 10_000_000, idempotencyKey: `test-topup-${stamp}` })
    .expect(201);
});

afterAll(async () => {
  // Provider cascade removes the vehicle and its reservations.
  await prisma.provider.delete({ where: { id: providerId } }).catch(() => {});
  await prisma.user.delete({ where: { id: customerId } }).catch(() => {});
  await prisma.$disconnect();
});

const auth = () => ({ Authorization: `Bearer ${token}` });
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('rental quote', () => {
  it('prices days, add-ons, and the service fee in integer minor units', () => {
    const quote = rentalsService.quote({
      dailyRateMinor: 650000,
      depositMinor: 500000,
      pickupAt: new Date('2026-08-01T10:00:00Z'),
      returnAt: new Date('2026-08-03T10:00:00Z'),
      addOnKeys: ['basic_protection'],
    });
    expect(quote.days).toBe(2);
    expect(quote.rentalFeeMinor).toBe(1_300_000);
    expect(quote.protectionMinor).toBe(240_000);
    // Provider-funded commission model: no customer-facing service fee.
    expect(quote.serviceFeeMinor).toBe(0);
    expect(quote.totalMinor).toBe(1_540_000);
  });

  it('rounds partial days up and never below one day', () => {
    const partial = rentalsService.quote({
      dailyRateMinor: 650000,
      depositMinor: 0,
      pickupAt: new Date('2026-08-01T10:00:00Z'),
      returnAt: new Date('2026-08-02T18:00:00Z'), // 1 day 8 h → 2 days
      addOnKeys: [],
    });
    expect(partial.days).toBe(2);

    const short = rentalsService.quote({
      dailyRateMinor: 650000,
      depositMinor: 0,
      pickupAt: new Date('2026-08-01T10:00:00Z'),
      returnAt: new Date('2026-08-01T14:00:00Z'), // 4 h → still 1 day
      addOnKeys: [],
    });
    expect(short.days).toBe(1);
  });
});

describe('reservation lifecycle', () => {
  let reservationId: string;
  let reservedReturnAt: string;

  it('reserves with wallet payment and confirms atomically', async () => {
    const before = await walletBalance(customerId);
    const res = await request(app)
      .post('/v1/rentals/reserve')
      .set(auth())
      .send({
        vehicleId,
        pickupAt: day(10),
        returnAt: day(12),
        addOnKeys: ['basic_protection'],
        driverName: 'Rental Tester',
        idempotencyKey: `test-reserve-${stamp}`,
      })
      .expect(201);

    reservationId = res.body.reservation.id;
    reservedReturnAt = res.body.reservation.returnAt;
    expect(res.body.reservation.status).toBe('CONFIRMED');
    expect(res.body.reservation.totalMinor).toBe(1_540_000);
    expect(res.body.reservation.pickupCode).toMatch(/^\d{4}$/);
    expect(res.body.payment.status).toBe('CAPTURED');

    const after = await walletBalance(customerId);
    expect(before - after).toBe(1_540_000); // debited exactly once
  });

  it('rejects overlapping dates for the same vehicle', async () => {
    const res = await request(app)
      .post('/v1/rentals/reserve')
      .set(auth())
      .send({
        vehicleId,
        pickupAt: day(11),
        returnAt: day(13),
        addOnKeys: [],
        driverName: 'Second Driver',
        idempotencyKey: `test-overlap-${stamp}`,
      })
      .expect(409);
    expect(res.body.error.code).toBe('DATES_UNAVAILABLE');
  });

  it('allows back-to-back (non-overlapping) reservations', async () => {
    const res = await request(app)
      .post('/v1/rentals/reserve')
      .set(auth())
      .send({
        vehicleId,
        pickupAt: day(12), // starts exactly when the first one ends
        returnAt: day(13),
        addOnKeys: [],
        driverName: 'Adjacent Driver',
        idempotencyKey: `test-adjacent-${stamp}`,
      })
      .expect(201);
    expect(res.body.reservation.status).toBe('CONFIRMED');

    await request(app).post(`/v1/rentals/${res.body.reservation.id}/cancel`).set(auth()).send({}).expect(200);
  });

  it('does not double-charge when a reserve request is retried', async () => {
    const before = await walletBalance(customerId);
    await request(app)
      .post('/v1/rentals/reserve')
      .set(auth())
      .send({
        vehicleId,
        pickupAt: day(10),
        returnAt: day(12),
        addOnKeys: ['basic_protection'],
        driverName: 'Rental Tester',
        idempotencyKey: `test-reserve-${stamp}`, // same key as the confirmed reservation
      })
      .expect(409); // overlap guard also blocks the retry
    expect(await walletBalance(customerId)).toBe(before);
  });

  it('rejects a return time before pickup', async () => {
    await request(app)
      .post('/v1/rentals/reserve')
      .set(auth())
      .send({
        vehicleId,
        pickupAt: day(20),
        returnAt: day(19),
        addOnKeys: [],
        driverName: 'Backwards Driver',
        idempotencyKey: `test-backwards-${stamp}`,
      })
      .expect(400);
  });

  it('activates a confirmed reservation', async () => {
    const res = await request(app).post(`/v1/rentals/${reservationId}/activate`).set(auth()).expect(200);
    expect(res.body.reservation.status).toBe('ACTIVE');
  });

  it('refuses to activate twice', async () => {
    await request(app).post(`/v1/rentals/${reservationId}/activate`).set(auth()).expect(400);
  });

  it('extends the rental and charges only the extra days', async () => {
    const before = await walletBalance(customerId);
    // Exactly +24 h from the reserved return, mirroring the mobile extend flow.
    const newReturnAt = new Date(new Date(reservedReturnAt).getTime() + 86_400_000).toISOString();
    const res = await request(app)
      .post(`/v1/rentals/${reservationId}/extend`)
      .set(auth())
      .send({ newReturnAt, idempotencyKey: `test-extend-${stamp}` })
      .expect(200);
    expect(res.body.reservation.status).toBe('EXTENDED');
    expect(before - (await walletBalance(customerId))).toBe(650_000); // one extra day
  });

  it('rejects extensions that do not move the return time forward', async () => {
    await request(app)
      .post(`/v1/rentals/${reservationId}/extend`)
      .set(auth())
      .send({ newReturnAt: day(12), idempotencyKey: `test-extend-bad-${stamp}` })
      .expect(400);
  });

  it('completes the rental and releases the deposit', async () => {
    const res = await request(app).post(`/v1/rentals/${reservationId}/complete`).set(auth()).expect(200);
    expect(res.body.reservation.status).toBe('COMPLETED');
    expect(res.body.reservation.depositStatus).toBe('released');
  });

  it('refuses to cancel a completed rental', async () => {
    const res = await request(app)
      .post(`/v1/rentals/${reservationId}/cancel`)
      .set(auth())
      .send({})
      .expect(400);
    expect(res.body.error.code).toBe('NOT_CANCELLABLE');
  });

  it('records tracking events for each transition', async () => {
    const res = await request(app).get(`/v1/rentals/${reservationId}`).set(auth()).expect(200);
    const labels = res.body.events.map((e: { label: string }) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining(['Reservation confirmed', 'Rental started', 'Rental extended', 'Vehicle returned successfully']),
    );
  });
});

describe('cancellation and refunds', () => {
  it('refunds the wallet when a confirmed reservation is cancelled', async () => {
    const before = await walletBalance(customerId);
    const res = await request(app)
      .post('/v1/rentals/reserve')
      .set(auth())
      .send({
        vehicleId,
        pickupAt: day(30),
        returnAt: day(31),
        addOnKeys: [],
        driverName: 'Cancel Tester',
        idempotencyKey: `test-cancel-${stamp}`,
      })
      .expect(201);
    const total = res.body.reservation.totalMinor as number;
    expect(await walletBalance(customerId)).toBe(before - total);

    const cancel = await request(app)
      .post(`/v1/rentals/${res.body.reservation.id}/cancel`)
      .set(auth())
      .send({ reason: 'Changed plans' })
      .expect(200);
    expect(cancel.body.reservation.status).toBe('CANCELLED');
    expect(await walletBalance(customerId)).toBe(before); // fully refunded
  });

  it('fails with INSUFFICIENT_FUNDS without confirming the reservation', async () => {
    const balance = await walletBalance(customerId);
    const expensive = await prisma.rentalVehicle.create({
      data: {
        providerId,
        make: 'Test',
        model: 'Overpriced',
        category: 'PREMIUM',
        dailyRateMinor: balance + 1_000_000, // guaranteed to exceed funds
        depositMinor: 0,
      },
    });

    const res = await request(app)
      .post('/v1/rentals/reserve')
      .set(auth())
      .send({
        vehicleId: expensive.id,
        pickupAt: day(40),
        returnAt: day(41),
        addOnKeys: [],
        driverName: 'Broke Tester',
        idempotencyKey: `test-poor-${stamp}`,
      })
      .expect(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await walletBalance(customerId)).toBe(balance); // nothing charged

    const confirmed = await prisma.rentalReservation.findFirst({
      where: { vehicleId: expensive.id, status: 'CONFIRMED' },
    });
    expect(confirmed).toBeNull();
  });

  it('blocks access to another customer’s reservation', async () => {
    const otherHash = await argon2.hash(PASSWORD);
    const other = await prisma.user.create({
      data: {
        fullName: 'Other Tester',
        email: `rental-other-${stamp}@test.voryn.dev`,
        passwordHash: otherHash,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        wallet: { create: {} },
        loyaltyAccount: { create: {} },
      },
    });
    const login = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: other.email, password: PASSWORD })
      .expect(200);

    const mine = await prisma.rentalReservation.findFirst({ where: { customerId } });
    await request(app)
      .get(`/v1/rentals/${mine!.id}`)
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .expect(404);

    await prisma.user.delete({ where: { id: other.id } });
  });
});
