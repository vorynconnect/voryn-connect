/**
 * Rewards engine tests. The first block reproduces the worked examples from
 * the money model spec exactly, so a change to any rate or cap that would move
 * those numbers fails here first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import {
  COMMISSION_SAFETY_PERCENT,
  MAX_REDEEM_PERCENT,
  MIN_REDEMPTION_POINTS,
  POINT_VALUE_MINOR,
  REDEMPTION_INCREMENT_POINTS,
  computePointsEarned,
  computeRedemptionCap,
  normaliseRequestedPoints,
  tierForSpend,
} from '../../lib/loyalty';
import { CATEGORY_COMMISSION_BPS, commissionOfMinor, deliverySplit } from '../../lib/commission';
import { safeMarginMinor } from '../../lib/margin';
import {
  awardPoints,
  expireStalePoints,
  expiringSoon,
  issuePendingPoints,
  pointsSnapshot,
  releasePendingPoints,
  restorePoints,
  reverseEarnedPoints,
  rewardsFund,
  spendPoints,
  voidPendingPoints,
} from './rewards.service';

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string;

async function balance(): Promise<number> {
  const a = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId } });
  return a.pointsBalance;
}

async function pending(): Promise<number> {
  const a = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId } });
  return a.pendingPoints;
}

async function setBalance(points: number) {
  await prisma.loyaltyTransaction.deleteMany({ where: { account: { userId } } });
  await prisma.loyaltyAccount.update({
    where: { userId },
    data: { pointsBalance: 0, pendingPoints: 0 },
  });
  if (points > 0) {
    await restorePoints({ userId, points, description: 'test seed', referenceType: 'test' });
  }
}

/**
 * Cap for a wallet-paid order, the way the engine computes it in production.
 * `pointsBalance` defaults high so the business limits are what bind.
 */
function capFor(input: {
  itemsMinor: number;
  deliveryFeeMinor?: number;
  commissionBps: number;
  pointsBalance?: number;
}) {
  const deliveryFeeMinor = input.deliveryFeeMinor ?? 0;
  const commissionMinor = commissionOfMinor(input.itemsMinor, input.commissionBps);
  const orderValueMinor = input.itemsMinor + deliveryFeeMinor;
  return computeRedemptionCap({
    pointsBalance: input.pointsBalance ?? 1_000_000,
    itemsMinor: input.itemsMinor,
    deliveryFeeMinor,
    expectedCommissionMinor: commissionMinor,
    safeMarginMinor: safeMarginMinor({
      commissionMinor,
      customerPaidMinor: orderValueMinor,
      orderValueMinor,
      paymentMethod: 'VORYN_WALLET',
    }),
    category: 'RESTAURANT',
  });
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      fullName: 'Rewards Tester',
      email: `rewards-${stamp}@test.voryn.dev`,
      phone: `+1876009${stamp.slice(0, 4)}`,
      passwordHash: await argon2.hash('TestPass1!'),
      role: 'CUSTOMER',
      status: 'ACTIVE',
      wallet: { create: {} },
      loyaltyAccount: { create: { pointsBalance: 0 } },
      customerProfile: { create: {} },
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('spec worked examples', () => {
  it('restaurant: JMD 5,000 at 10% caps redemption on commission, not order size', () => {
    const cap = capFor({ itemsMinor: 500_000, commissionBps: 1000 });
    // 5% of the order is JMD 250, but 25% of the JMD 500 commission is JMD 125,
    // rounded down to a whole 100-point step: JMD 120.
    expect(cap.limitedBy).toBe('COMMISSION_SAFETY');
    expect(cap.maxMinor).toBe(12_000);
    expect(cap.maxPoints).toBe(1200);
  });

  it('home service: JMD 10,000 at 12% allows exactly the spec figure', () => {
    const cap = capFor({ itemsMinor: 1_000_000, commissionBps: 1200 });
    // Commission JMD 1,200; 25% of it is JMD 300, which the spec calls out.
    expect(cap.maxMinor).toBe(30_000);
    expect(cap.maxPoints).toBe(3000);
    expect(cap.limitedBy).toBe('COMMISSION_SAFETY');
  });

  it('retail: the 8% rate protects a thinner-margin category', () => {
    const cap = capFor({ itemsMinor: 500_000, commissionBps: 800 });
    // 5% of the order is JMD 250, but commission is only JMD 400, so JMD 100.
    expect(cap.maxMinor).toBe(10_000);
    expect(cap.maxPoints).toBe(1000);
  });

  it('ride: JMD 2,000 fare at 15% rounds down to a whole redemption step', () => {
    const cap = capFor({ itemsMinor: 200_000, commissionBps: 1500 });
    // 25% of the JMD 300 commission is JMD 75, but redemption moves in
    // 100-point (JMD 10) steps, so the customer may use JMD 70.
    expect(cap.maxMinor).toBe(7_000);
    expect(cap.maxPoints).toBe(700);
  });

  it('earns 5 points per JMD 100 worth JMD 0.10 each: a 0.5% reward', () => {
    for (const [spendMinor, expected] of [
      [100_000, 50],
      [500_000, 250],
      [1_000_000, 500],
      [5_000_000, 2500],
    ] as const) {
      const points = computePointsEarned({
        eligibleMinor: spendMinor,
        category: 'RESTAURANT',
        tier: 'BRONZE',
      });
      expect(points).toBe(expected);
      // Half a percent of spend, in discount value.
      expect(points * POINT_VALUE_MINOR).toBe(Math.round(spendMinor * 0.005));
    }
  });

  it('prices every provider category at the agreed commission', () => {
    // Rides/deliveries 9.99%; every other provider type 11.99%.
    expect(CATEGORY_COMMISSION_BPS.RESTAURANT).toBe(1199);
    expect(CATEGORY_COMMISSION_BPS.GROCERY).toBe(1199);
    expect(CATEGORY_COMMISSION_BPS.HOME_SERVICES).toBe(1199);
    expect(CATEGORY_COMMISSION_BPS.TECHNICIAN).toBe(1199);
    expect(CATEGORY_COMMISSION_BPS.AUTO_CARE).toBe(1199);
    expect(CATEGORY_COMMISSION_BPS.VEHICLE_RENTAL).toBe(1199);
    expect(CATEGORY_COMMISSION_BPS.RIDES).toBe(999);
    expect(CATEGORY_COMMISSION_BPS.SUPPLIER).toBe(1199);
  });

  it('charges couriers 9.99% of the delivery fee and never touches tips', () => {
    // JMD 700 delivery fee: Voryn takes ~JMD 70, the courier keeps ~JMD 630.
    expect(deliverySplit(70_000)).toEqual({
      courierCompensationMinor: 63_007,
      vorynMarginMinor: 6_993,
    });
  });
});

describe('redemption caps', () => {
  it('stops at the customer balance when that is smallest', () => {
    const cap = capFor({ itemsMinor: 1_000_000, commissionBps: 1200, pointsBalance: 600 });
    expect(cap.maxPoints).toBe(600);
    expect(cap.limitedBy).toBe('BALANCE');
  });

  it('applies the 5% order limit when commission is generous', () => {
    // A 40% commission leaves plenty of headroom, so order size binds.
    const cap = capFor({ itemsMinor: 1_000_000, commissionBps: 4000 });
    expect(cap.limitedBy).toBe('ORDER_PERCENT');
    expect(cap.maxMinor).toBe(Math.floor((1_000_000 * MAX_REDEEM_PERCENT) / 100));
  });

  it('blocks redemption on orders under the minimum', () => {
    const cap = capFor({ itemsMinor: 100_000, deliveryFeeMinor: 20_000, commissionBps: 1000 });
    expect(cap.maxPoints).toBe(0);
    expect(cap.limitedBy).toBe('MIN_ORDER');
  });

  it('refuses redemptions below the 500-point floor', () => {
    // JMD 1,600 order at 5% = JMD 80 by order size, but 25% of the JMD 160
    // commission is JMD 40 — under the JMD 50 minimum, so nothing is allowed.
    const cap = capFor({ itemsMinor: 160_000, commissionBps: 1000 });
    expect(cap.maxPoints).toBe(0);
    expect(cap.limitedBy).toBe('BELOW_MINIMUM');
    expect(cap.reason).toContain('500');
  });

  it('protects the contribution margin, not just the commission', () => {
    const itemsMinor = 1_000_000;
    const commissionMinor = commissionOfMinor(itemsMinor, 1200);
    // A card payment carries gateway fees that a wallet payment does not.
    const cardMargin = safeMarginMinor({
      commissionMinor,
      customerPaidMinor: itemsMinor,
      orderValueMinor: itemsMinor,
      paymentMethod: 'CARD',
    });
    const walletMargin = safeMarginMinor({
      commissionMinor,
      customerPaidMinor: itemsMinor,
      orderValueMinor: itemsMinor,
      paymentMethod: 'VORYN_WALLET',
    });
    expect(cardMargin).toBeLessThan(walletMargin);

    // Where the margin is thinner than 25% of commission, the margin wins.
    const cap = computeRedemptionCap({
      pointsBalance: 1_000_000,
      itemsMinor,
      deliveryFeeMinor: 0,
      expectedCommissionMinor: commissionMinor,
      safeMarginMinor: 5_000, // only JMD 50 of margin left
      category: 'RESTAURANT',
    });
    expect(cap.limitedBy).toBe('MARGIN_SAFETY');
    expect(cap.maxMinor).toBe(5_000);
  });

  it('lifts the Voryn-cost caps when the merchant funds the reward', () => {
    const cap = computeRedemptionCap({
      pointsBalance: 1_000_000,
      itemsMinor: 500_000,
      deliveryFeeMinor: 0,
      expectedCommissionMinor: 50_000,
      safeMarginMinor: 0, // would normally block everything
      category: 'RESTAURANT',
      merchantFunded: true,
    });
    expect(cap.limitedBy).toBe('ORDER_PERCENT');
    expect(cap.maxMinor).toBe(25_000);
  });

  it('pays no points on B2B supplier orders', () => {
    const cap = computeRedemptionCap({
      pointsBalance: 1_000_000,
      itemsMinor: 500_000,
      deliveryFeeMinor: 0,
      expectedCommissionMinor: 50_000,
      safeMarginMinor: 50_000,
      category: 'SUPPLIER',
    });
    expect(cap.limitedBy).toBe('CATEGORY_INELIGIBLE');
    expect(computePointsEarned({ eligibleMinor: 500_000, category: 'SUPPLIER', tier: 'BRONZE' })).toBe(0);
  });

  it('never covers the whole delivery fee, whatever the order shape', () => {
    for (const itemsMinor of [200_000, 500_000, 2_000_000]) {
      for (const deliveryFeeMinor of [20_000, 70_000, 200_000]) {
        const cap = computeRedemptionCap({
          pointsBalance: 10_000_000,
          itemsMinor,
          deliveryFeeMinor,
          expectedCommissionMinor: 100_000_000,
          safeMarginMinor: 100_000_000,
          category: 'RESTAURANT',
        });
        expect(cap.maxMinor).toBeLessThanOrEqual(itemsMinor + Math.floor(deliveryFeeMinor / 2));
        expect(cap.maxMinor).toBeLessThan(itemsMinor + deliveryFeeMinor);
      }
    }
  });

  it('rounds a requested redemption down to a whole step', () => {
    const cap = capFor({ itemsMinor: 1_000_000, commissionBps: 1200 }); // 3,000 pts
    expect(normaliseRequestedPoints(2_750, cap)).toBe(2_700);
    expect(normaliseRequestedPoints(99_999, cap)).toBe(3_000);
    expect(normaliseRequestedPoints(400, cap)).toBe(0); // under the floor
    expect(REDEMPTION_INCREMENT_POINTS).toBe(100);
    expect(MIN_REDEMPTION_POINTS).toBe(500);
  });
});

describe('earn rates and tiers', () => {
  it('multiplies by tier without changing what a point is worth', () => {
    const args = { eligibleMinor: 1_000_000, category: 'RESTAURANT' as const };
    expect(computePointsEarned({ ...args, tier: 'BRONZE' })).toBe(500);
    expect(computePointsEarned({ ...args, tier: 'SILVER' })).toBe(625);
    expect(computePointsEarned({ ...args, tier: 'GOLD' })).toBe(750);
    expect(computePointsEarned({ ...args, tier: 'PLATINUM' })).toBe(1000);
    // Even at the top tier the reward is 1% of spend, not 5%.
    expect(1000 * POINT_VALUE_MINOR).toBe(Math.round(1_000_000 * 0.01));
  });

  it('stacks a campaign on top of the tier rate', () => {
    const args = { eligibleMinor: 1_000_000, category: 'RESTAURANT' as const, tier: 'GOLD' as const };
    expect(computePointsEarned({ ...args, campaignMultiplierBps: 20_000 })).toBe(1500);
    expect(computePointsEarned({ ...args, campaignBonusPoints: 50 })).toBe(800);
  });

  it('assigns tiers from trailing spend', () => {
    expect(tierForSpend(0)).toBe('BRONZE');
    expect(tierForSpend(5_000_000)).toBe('SILVER');
    expect(tierForSpend(15_000_000)).toBe('GOLD');
    expect(tierForSpend(40_000_000)).toBe('PLATINUM');
  });
});

describe('pending points', () => {
  beforeEach(async () => {
    await setBalance(0);
  });

  it('holds points pending until the transaction completes', async () => {
    const issued = await issuePendingPoints({
      userId,
      eligibleMinor: 1_000_000,
      category: 'RESTAURANT',
      referenceType: 'test',
      referenceId: `pend-${stamp}`,
      code: 'PEND',
    });
    expect(issued).toBe(500);
    expect(await pending()).toBe(500);
    expect(await balance()).toBe(0); // not spendable yet

    // Pending points cannot be spent.
    expect(await spendPoints({ userId, points: 500, description: 'early', referenceType: 'test' })).toBe(false);

    const released = await releasePendingPoints({
      userId,
      referenceType: 'test',
      referenceId: `pend-${stamp}`,
      code: 'PEND',
    });
    expect(released).toBe(500);
    expect(await pending()).toBe(0);
    expect(await balance()).toBe(500);
  });

  it('voids pending points when the transaction never completes', async () => {
    await issuePendingPoints({
      userId,
      eligibleMinor: 1_000_000,
      category: 'RESTAURANT',
      referenceType: 'test',
      referenceId: `void-${stamp}`,
      code: 'VOID',
    });
    expect(await pending()).toBe(500);

    await voidPendingPoints({ userId, referenceType: 'test', referenceId: `void-${stamp}` });
    expect(await pending()).toBe(0);
    expect(await balance()).toBe(0);
  });

  it('starts the expiry clock at release, not at purchase', async () => {
    await issuePendingPoints({
      userId,
      eligibleMinor: 1_000_000,
      category: 'RESTAURANT',
      referenceType: 'test',
      referenceId: `clock-${stamp}`,
      code: 'CLOCK',
    });
    const beforeRelease = await prisma.loyaltyTransaction.findFirstOrThrow({
      where: { account: { userId }, type: 'EARN' },
    });
    expect(beforeRelease.expiresAt).toBeNull();

    await releasePendingPoints({
      userId,
      referenceType: 'test',
      referenceId: `clock-${stamp}`,
      code: 'CLOCK',
    });
    const afterRelease = await prisma.loyaltyTransaction.findFirstOrThrow({
      where: { account: { userId }, type: 'EARN' },
    });
    expect(afterRelease.expiresAt).toBeInstanceOf(Date);
    expect(afterRelease.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('point lots and expiry', () => {
  beforeEach(async () => {
    await setBalance(0);
  });

  it('spends the oldest points first', async () => {
    await awardPoints({
      userId,
      eligibleMinor: 1_000_000, // 500 pts
      category: 'RESTAURANT',
      referenceType: 'test',
      referenceId: `old-${stamp}`,
      code: 'OLD',
    });
    const older = await prisma.loyaltyTransaction.findFirstOrThrow({
      where: { account: { userId }, type: 'EARN' },
    });
    await prisma.loyaltyTransaction.update({
      where: { id: older.id },
      data: { expiresAt: new Date(Date.now() + 30 * 86_400_000) },
    });
    await awardPoints({
      userId,
      eligibleMinor: 1_000_000,
      category: 'RESTAURANT',
      referenceType: 'test',
      referenceId: `new-${stamp}`,
      code: 'NEW',
    });

    expect(await balance()).toBe(1000);
    await spendPoints({ userId, points: 600, description: 'test spend', referenceType: 'test' });

    const lots = await prisma.loyaltyTransaction.findMany({
      where: { account: { userId }, type: 'EARN' },
      orderBy: { expiresAt: 'asc' },
    });
    expect(lots[0]!.pointsRemaining).toBe(0);
    expect(lots[1]!.pointsRemaining).toBe(400);
    expect(await balance()).toBe(400);
  });

  it('expires points after their lifetime and credits the fund', async () => {
    await awardPoints({
      userId,
      eligibleMinor: 1_000_000, // 500 pts = JMD 50
      category: 'RESTAURANT',
      referenceType: 'test',
      referenceId: `exp-${stamp}`,
      code: 'EXP',
    });
    await prisma.loyaltyTransaction.updateMany({
      where: { account: { userId }, type: 'EARN' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const fundBefore = await rewardsFund.balanceMinor();
    expect(await expireStalePoints(userId)).toBe(500);
    expect(await balance()).toBe(0);
    expect(await rewardsFund.balanceMinor()).toBe(fundBefore + 5_000);
  });

  it('warns about points expiring inside the notice window', async () => {
    await awardPoints({
      userId,
      eligibleMinor: 600_000, // 300 pts
      category: 'RESTAURANT',
      referenceType: 'test',
      referenceId: `soon-${stamp}`,
      code: 'SOON',
    });
    await prisma.loyaltyTransaction.updateMany({
      where: { account: { userId }, type: 'EARN' },
      data: { expiresAt: new Date(Date.now() + 10 * 86_400_000) },
    });
    expect((await expiringSoon(userId)).points).toBe(300);

    const snapshot = await pointsSnapshot(userId);
    expect(snapshot.expiringPoints).toBe(300);
    expect(snapshot.cashConvertible).toBe(false);
    expect(snapshot.pointsValueMinor).toBe(300 * POINT_VALUE_MINOR);
  });

  it('claws back points on a refund, allowing a controlled deficit', async () => {
    await awardPoints({
      userId,
      eligibleMinor: 600_000, // 300 pts
      category: 'RESTAURANT',
      referenceType: 'test',
      referenceId: `claw-${stamp}`,
      code: 'CLAW',
    });
    await spendPoints({ userId, points: 300, description: 'spent', referenceType: 'test' });
    expect(await balance()).toBe(0);

    await reverseEarnedPoints({
      userId,
      points: 300,
      description: 'refund reversal',
      referenceType: 'test',
    });
    expect(await balance()).toBe(-300);
  });
});

describe('rewards fund', () => {
  it('provisions 5% of commission and is idempotent per transaction', async () => {
    const before = await rewardsFund.balanceMinor();
    const args = {
      commissionMinor: 100_000, // JMD 1,000 commission
      referenceType: 'test',
      referenceId: `fund-${stamp}`,
      code: 'FUND',
    };
    await rewardsFund.contributeFromCommission(args);
    await rewardsFund.contributeFromCommission(args); // retry must not double-count
    expect(await rewardsFund.balanceMinor()).toBe(before + 5_000); // 5% = JMD 50
  });

  it('tolerates an early deficit rather than halving everyone rewards', () => {
    expect(env.REWARDS_FUND_DEFICIT_TOLERANCE_MINOR).toBeGreaterThan(0);
    const full = capFor({ itemsMinor: 1_000_000, commissionBps: 1200 });
    const tightened = computeRedemptionCap({
      pointsBalance: 1_000_000,
      itemsMinor: 1_000_000,
      deliveryFeeMinor: 0,
      expectedCommissionMinor: 120_000,
      safeMarginMinor: 108_000,
      category: 'RESTAURANT',
      commissionSafetyPercent: Math.floor(COMMISSION_SAFETY_PERCENT / 2),
    });
    // Halving 25% floors to 12%, then the 100-point step rounds JMD 144 to 140.
    expect(full.maxMinor).toBe(30_000);
    expect(tightened.maxMinor).toBe(14_000);
  });
});
