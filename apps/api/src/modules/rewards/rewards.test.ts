/**
 * Rewards engine tests: the redemption caps that keep every order profitable,
 * category/tier/campaign earn rates, FIFO point expiry, and the rewards fund.
 * Runs against the local dev database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import {
  COMMISSION_SAFETY_PERCENT,
  MAX_REDEEM_PERCENT,
  MIN_ORDER_FOR_REDEMPTION_MINOR,
  computePointsEarned,
  computeRedemptionCap,
  tierForSpend,
} from '../../lib/loyalty';
import {
  awardPoints,
  expireStalePoints,
  expiringSoon,
  pointsSnapshot,
  restorePoints,
  reverseEarnedPoints,
  rewardsFund,
  spendPoints,
} from './rewards.service';

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string;

async function balance(): Promise<number> {
  const a = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId } });
  return a.pointsBalance;
}

async function setBalance(points: number) {
  await prisma.loyaltyTransaction.deleteMany({ where: { account: { userId } } });
  await prisma.loyaltyAccount.update({ where: { userId }, data: { pointsBalance: 0 } });
  if (points > 0) {
    await restorePoints({
      userId,
      points,
      description: 'test seed',
      referenceType: 'test',
    });
  }
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

describe('redemption caps', () => {
  // JMD 5,000 of food + JMD 700 delivery, restaurant at 10% => JMD 500 commission.
  const order = {
    itemsMinor: 500_000,
    deliveryFeeMinor: 70_000,
    expectedCommissionMinor: 50_000,
    category: 'RESTAURANT' as const,
  };

  it('never lets a redemption exceed 80% of expected commission', () => {
    // The customer holds JMD 2,000 of points and 20% of the order would be
    // JMD 1,140, but only JMD 400 is safe to give back.
    const cap = computeRedemptionCap({ ...order, pointsBalance: 2000 });
    expect(cap.maxMinor).toBe(40_000);
    expect(cap.limitedBy).toBe('COMMISSION_SAFETY');
    // Voryn still clears JMD 100 on the order rather than losing JMD 200.
    expect(order.expectedCommissionMinor - cap.maxMinor).toBe(10_000);
  });

  it('applies the 20% order limit when commission is generous', () => {
    // A 40% commission would allow far more, so the order percentage binds.
    const cap = computeRedemptionCap({
      ...order,
      expectedCommissionMinor: 200_000,
      pointsBalance: 5000,
    });
    expect(cap.maxMinor).toBe(Math.floor((570_000 * MAX_REDEEM_PERCENT) / 100));
    expect(cap.limitedBy).toBe('ORDER_PERCENT');
  });

  it('stops at the customer balance when that is smallest', () => {
    const cap = computeRedemptionCap({ ...order, pointsBalance: 50 });
    expect(cap.maxPoints).toBe(50);
    expect(cap.limitedBy).toBe('BALANCE');
  });

  it('blocks redemption on orders under the minimum', () => {
    const cap = computeRedemptionCap({
      itemsMinor: 100_000,
      deliveryFeeMinor: 20_000, // JMD 1,200 total, under the JMD 1,500 floor
      expectedCommissionMinor: 10_000,
      category: 'RESTAURANT',
      pointsBalance: 5000,
    });
    expect(cap.maxPoints).toBe(0);
    expect(cap.limitedBy).toBe('MIN_ORDER');
    expect(cap.reason).toContain('300');
  });

  it('never covers the whole delivery fee, whatever the order shape', () => {
    // Property check rather than a single case: with unlimited points and
    // unlimited commission headroom, no split of items vs delivery may leave
    // the customer paying nothing towards delivery.
    for (const itemsMinor of [10_000, 200_000, 500_000, 2_000_000]) {
      for (const deliveryFeeMinor of [20_000, 70_000, 200_000]) {
        const cap = computeRedemptionCap({
          itemsMinor,
          deliveryFeeMinor,
          expectedCommissionMinor: 100_000_000,
          category: 'RESTAURANT',
          pointsBalance: 10_000_000,
        });
        // Even with unlimited points and commission headroom, the discount can
        // never reach the value of the items plus the whole delivery fee.
        expect(cap.maxMinor).toBeLessThanOrEqual(
          itemsMinor + Math.floor(deliveryFeeMinor / 2),
        );
        expect(cap.maxMinor).toBeLessThan(itemsMinor + deliveryFeeMinor);
      }
    }
  });

  it('lifts the commission cap when the merchant funds the reward', () => {
    const cap = computeRedemptionCap({ ...order, pointsBalance: 5000, merchantFunded: true });
    expect(cap.limitedBy).toBe('ORDER_PERCENT');
    expect(cap.maxMinor).toBeGreaterThan(
      Math.floor((order.expectedCommissionMinor * COMMISSION_SAFETY_PERCENT) / 100),
    );
  });

  it('pays no points on B2B supplier orders', () => {
    const cap = computeRedemptionCap({ ...order, category: 'SUPPLIER', pointsBalance: 5000 });
    expect(cap.maxPoints).toBe(0);
    expect(cap.limitedBy).toBe('CATEGORY_INELIGIBLE');
    expect(computePointsEarned({ eligibleMinor: 500_000, category: 'SUPPLIER', tier: 'BRONZE' })).toBe(0);
  });
});

describe('earn rates', () => {
  it('earns at the category rate', () => {
    const spend = 1_000_000; // JMD 10,000
    expect(computePointsEarned({ eligibleMinor: spend, category: 'RESTAURANT', tier: 'BRONZE' })).toBe(100);
    expect(computePointsEarned({ eligibleMinor: spend, category: 'GROCERY', tier: 'BRONZE' })).toBe(75);
    expect(computePointsEarned({ eligibleMinor: spend, category: 'RIDES', tier: 'BRONZE' })).toBe(83);
    expect(computePointsEarned({ eligibleMinor: spend, category: 'HOME_SERVICES', tier: 'BRONZE' })).toBe(200);
    expect(computePointsEarned({ eligibleMinor: spend, category: 'VEHICLE_RENTAL', tier: 'BRONZE' })).toBe(300);
  });

  it('multiplies by tier without changing what a point is worth', () => {
    const args = { eligibleMinor: 1_000_000, category: 'RESTAURANT' as const };
    expect(computePointsEarned({ ...args, tier: 'BRONZE' })).toBe(100);
    expect(computePointsEarned({ ...args, tier: 'SILVER' })).toBe(125);
    expect(computePointsEarned({ ...args, tier: 'GOLD' })).toBe(150);
    expect(computePointsEarned({ ...args, tier: 'PLATINUM' })).toBe(200);
  });

  it('stacks a campaign on top of the tier rate', () => {
    const args = { eligibleMinor: 1_000_000, category: 'RESTAURANT' as const, tier: 'GOLD' as const };
    expect(computePointsEarned({ ...args, campaignMultiplierBps: 20_000 })).toBe(300); // double points
    expect(computePointsEarned({ ...args, campaignBonusPoints: 50 })).toBe(200);
  });

  it('assigns tiers from trailing spend', () => {
    expect(tierForSpend(0)).toBe('BRONZE');
    expect(tierForSpend(5_000_000)).toBe('SILVER');
    expect(tierForSpend(15_000_000)).toBe('GOLD');
    expect(tierForSpend(40_000_000)).toBe('PLATINUM');
  });
});

describe('point lots and expiry', () => {
  beforeEach(async () => {
    await setBalance(0);
  });

  it('spends the oldest points first', async () => {
    await awardPoints({
      userId,
      eligibleMinor: 1_000_000, // 100 pts, older lot
      category: 'RESTAURANT',
      referenceType: 'test',
      referenceId: `old-${stamp}`,
      code: 'OLD',
    });
    const older = await prisma.loyaltyTransaction.findFirstOrThrow({
      where: { account: { userId }, type: 'EARN' },
    });
    // Age the first lot so FIFO ordering is unambiguous.
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

    expect(await balance()).toBe(200);
    await spendPoints({ userId, points: 120, description: 'test spend', referenceType: 'test' });

    const lots = await prisma.loyaltyTransaction.findMany({
      where: { account: { userId }, type: 'EARN' },
      orderBy: { expiresAt: 'asc' },
    });
    expect(lots[0]!.pointsRemaining).toBe(0); // oldest fully consumed
    expect(lots[1]!.pointsRemaining).toBe(80);
    expect(await balance()).toBe(80);
  });

  it('expires points after their lifetime and credits the fund', async () => {
    await awardPoints({
      userId,
      eligibleMinor: 500_000, // 50 pts
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
    const expired = await expireStalePoints(userId);
    expect(expired).toBe(50);
    expect(await balance()).toBe(0);
    // The provision for points that will never be redeemed returns to the fund.
    expect(await rewardsFund.balanceMinor()).toBe(fundBefore + 5_000);

    const rows = await prisma.loyaltyTransaction.findMany({
      where: { account: { userId }, type: 'EXPIRE' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.points).toBe(-50);
  });

  it('warns about points expiring inside the notice window', async () => {
    await awardPoints({
      userId,
      eligibleMinor: 300_000, // 30 pts
      category: 'RESTAURANT',
      referenceType: 'test',
      referenceId: `soon-${stamp}`,
      code: 'SOON',
    });
    await prisma.loyaltyTransaction.updateMany({
      where: { account: { userId }, type: 'EARN' },
      data: { expiresAt: new Date(Date.now() + 10 * 86_400_000) },
    });
    const soon = await expiringSoon(userId);
    expect(soon.points).toBe(30);
    expect(soon.at).toBeInstanceOf(Date);

    const snapshot = await pointsSnapshot(userId);
    expect(snapshot.expiringPoints).toBe(30);
    expect(snapshot.cashConvertible).toBe(false);
  });

  it('refuses to spend more points than the balance', async () => {
    await setBalance(40);
    expect(await spendPoints({ userId, points: 100, description: 'too much', referenceType: 'test' })).toBe(false);
    expect(await balance()).toBe(40);
  });

  it('claws back points on a refund, allowing a controlled deficit', async () => {
    await setBalance(0);
    await awardPoints({
      userId,
      eligibleMinor: 300_000, // 30 pts
      category: 'RESTAURANT',
      referenceType: 'test',
      referenceId: `claw-${stamp}`,
      code: 'CLAW',
    });
    // Customer spends them before the refund lands.
    await spendPoints({ userId, points: 30, description: 'spent', referenceType: 'test' });
    expect(await balance()).toBe(0);

    await reverseEarnedPoints({
      userId,
      points: 30,
      description: 'refund reversal',
      referenceType: 'test',
    });
    // The cash refund is never blocked; the points account carries the debt.
    expect(await balance()).toBe(-30);
  });
});

describe('rewards fund', () => {
  it('does not tighten redemption while the deficit is within tolerance', async () => {
    // The fund starts empty and customers redeem before contributions build
    // up, so an early deficit is expected. It must not quietly halve rewards.
    const tolerance = env.REWARDS_FUND_DEFICIT_TOLERANCE_MINOR;
    const full = computeRedemptionCap({
      itemsMinor: 500_000,
      deliveryFeeMinor: 70_000,
      expectedCommissionMinor: 50_000,
      category: 'RESTAURANT',
      pointsBalance: 5000,
      commissionSafetyPercent: COMMISSION_SAFETY_PERCENT,
    });
    const tightened = computeRedemptionCap({
      itemsMinor: 500_000,
      deliveryFeeMinor: 70_000,
      expectedCommissionMinor: 50_000,
      category: 'RESTAURANT',
      pointsBalance: 5000,
      commissionSafetyPercent: Math.floor(COMMISSION_SAFETY_PERCENT / 2),
    });
    expect(full.maxMinor).toBe(40_000); // 80% of JMD 500
    expect(tightened.maxMinor).toBe(20_000); // what a real overdraft would do
    expect(tolerance).toBeGreaterThan(0);
  });

  it('sets aside a slice of commission and is idempotent per transaction', async () => {
    const before = await rewardsFund.balanceMinor();
    const args = {
      commissionMinor: 100_000, // JMD 1,000 commission
      referenceType: 'test',
      referenceId: `fund-${stamp}`,
      code: 'FUND',
    };
    await rewardsFund.contributeFromCommission(args);
    await rewardsFund.contributeFromCommission(args); // retry must not double-count
    expect(await rewardsFund.balanceMinor()).toBe(before + 500); // 0.5% = JMD 5
  });
});
