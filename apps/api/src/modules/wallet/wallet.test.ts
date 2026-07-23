/**
 * Wallet ledger integration tests — top-up, transfers, withdrawals, loyalty
 * redemption, and PIN. Runs against the local dev database with isolated
 * fixtures per run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma';
import { createApp } from '../../app';

const app = createApp();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPass1!';

let aliceId: string;
let bobId: string;
let aliceToken: string;

async function makeUser(tag: string) {
  return prisma.user.create({
    data: {
      fullName: `Wallet ${tag}`,
      email: `wallet-${tag}-${stamp}@test.voryn.dev`,
      phone: `+1876${tag === 'alice' ? '11' : '22'}${stamp.slice(0, 5)}`,
      passwordHash: await argon2.hash(PASSWORD),
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      wallet: { create: {} },
      loyaltyAccount: { create: { pointsBalance: 800 } },
    },
  });
}

async function balance(userId: string) {
  return (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balanceMinor;
}

beforeAll(async () => {
  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  aliceId = alice.id;
  bobId = bob.id;
  const login = await request(app)
    .post('/v1/auth/login')
    .send({ identifier: alice.email, password: PASSWORD })
    .expect(200);
  aliceToken = login.body.accessToken;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [aliceId, bobId] } } });
  await prisma.$disconnect();
});

const auth = () => ({ Authorization: `Bearer ${aliceToken}` });

describe('top-up', () => {
  it('credits once even when the request is retried', async () => {
    const body = { amountMinor: 500_000, idempotencyKey: `w-topup-${stamp}` };
    await request(app).post('/v1/wallet/top-up').set(auth()).send(body).expect(201);
    const retry = await request(app).post('/v1/wallet/top-up').set(auth()).send(body).expect(200);
    expect(retry.body.retried).toBe(true);
    expect(await balance(aliceId)).toBe(500_000);
  });
});

describe('transfer', () => {
  it('moves funds atomically between both wallets', async () => {
    const bob = await prisma.user.findUniqueOrThrow({ where: { id: bobId } });
    await request(app)
      .post('/v1/wallet/transfer')
      .set(auth())
      .send({ recipientPhone: bob.phone, amountMinor: 100_000, idempotencyKey: `w-tr-${stamp}` })
      .expect(201);
    expect(await balance(aliceId)).toBe(400_000);
    expect(await balance(bobId)).toBe(100_000);
  });

  it('rejects transfers beyond the balance without touching either wallet', async () => {
    const bob = await prisma.user.findUniqueOrThrow({ where: { id: bobId } });
    const res = await request(app)
      .post('/v1/wallet/transfer')
      .set(auth())
      .send({ recipientPhone: bob.phone, amountMinor: 99_999_999, idempotencyKey: `w-tr-big-${stamp}` })
      .expect(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await balance(aliceId)).toBe(400_000);
    expect(await balance(bobId)).toBe(100_000);
  });

  it('rejects transfers to unknown recipients', async () => {
    await request(app)
      .post('/v1/wallet/transfer')
      .set(auth())
      .send({ recipientPhone: '+18760000000', amountMinor: 1000, idempotencyKey: `w-tr-ghost-${stamp}` })
      .expect(404);
  });
});

describe('withdrawal', () => {
  it('debits the ledger and blocks overdrafts', async () => {
    await request(app)
      .post('/v1/wallet/withdraw')
      .set(auth())
      .send({ amountMinor: 100_000, idempotencyKey: `w-wd-${stamp}` })
      .expect(201);
    expect(await balance(aliceId)).toBe(300_000);

    const res = await request(app)
      .post('/v1/wallet/withdraw')
      .set(auth())
      .send({ amountMinor: 99_999_999, idempotencyKey: `w-wd-big-${stamp}` })
      .expect(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('redeem points', () => {
  it('never converts points to wallet cash (BOJ stored-value guardrail)', async () => {
    const before = await balance(aliceId);
    const res = await request(app)
      .post('/v1/wallet/redeem-points')
      .set(auth())
      .send({ points: 500, idempotencyKey: `w-redeem-${stamp}` })
      .expect(400);
    expect(res.body.error.code).toBe('POINTS_NOT_CONVERTIBLE');
    expect(await balance(aliceId)).toBe(before); // wallet untouched

    const loyalty = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId: aliceId } });
    expect(loyalty.pointsBalance).toBe(800); // points untouched
  });

  it('reports the redemption terms on the wallet snapshot', async () => {
    const res = await request(app).get('/v1/wallet').set(auth()).expect(200);
    expect(res.body.loyalty.pointValueMinor).toBe(10); // 10 pts = JMD 1
    expect(res.body.loyalty.pointsPerJmd).toBe(10);
    expect(res.body.loyalty.maxRedeemPercent).toBe(5);
    expect(res.body.loyalty.minRedemptionPoints).toBe(500);
    expect(res.body.loyalty.cashConvertible).toBe(false);
  });
});

describe('wallet PIN', () => {
  it('sets, verifies, and requires the current PIN to change', async () => {
    await request(app).post('/v1/wallet/pin').set(auth()).send({ newPin: '1234' }).expect(200);

    await request(app).post('/v1/wallet/pin/verify').set(auth()).send({ pin: '0000' }).expect(401);
    const ok = await request(app).post('/v1/wallet/pin/verify').set(auth()).send({ pin: '1234' }).expect(200);
    expect(ok.body.verified).toBe(true);

    // Changing without the current PIN is rejected…
    await request(app).post('/v1/wallet/pin').set(auth()).send({ newPin: '9999' }).expect(400);
    // …and succeeds with it.
    await request(app)
      .post('/v1/wallet/pin')
      .set(auth())
      .send({ currentPin: '1234', newPin: '9999' })
      .expect(200);
    await request(app).post('/v1/wallet/pin/verify').set(auth()).send({ pin: '9999' }).expect(200);
  });
});

describe('password change', () => {
  it('requires the correct current password and keeps login working', async () => {
    await request(app)
      .post('/v1/users/me/password')
      .set(auth())
      .send({ currentPassword: 'nope', newPassword: 'NewPass123!' })
      .expect(401);

    await request(app)
      .post('/v1/users/me/password')
      .set(auth())
      .send({ currentPassword: PASSWORD, newPassword: 'NewPass123!' })
      .expect(200);

    const alice = await prisma.user.findUniqueOrThrow({ where: { id: aliceId } });
    await request(app)
      .post('/v1/auth/login')
      .send({ identifier: alice.email, password: 'NewPass123!' })
      .expect(200);
  });
});
