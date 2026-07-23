import {
  LoyaltyCampaignType,
  MemberTier,
  Prisma,
  ProviderCategory,
  RewardsFundEntryType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { commissionBpsForProvider, commissionOfMinor } from '../../lib/commission';
import {
  CATEGORY_MINOR_PER_POINT,
  COMMISSION_SAFETY_PERCENT,
  EXPIRY_WARNING_DAYS,
  MAX_REDEEM_PERCENT,
  MIN_ORDER_FOR_REDEMPTION_MINOR,
  POINTS_LIFETIME_MONTHS,
  POINT_VALUE_MINOR,
  REWARDS_FUND_CONTRIBUTION_BPS,
  TIER_MULTIPLIER_BPS,
  computePointsEarned,
  computeRedemptionCap,
  pointsToMinor,
  tierForSpend,
  type RedemptionCap,
} from '../../lib/loyalty';

type Tx = Prisma.TransactionClient;

function expiryFromNow(from = new Date()): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + POINTS_LIFETIME_MONTHS);
  return d;
}

// ── Rewards fund ────────────────────────────────────────────
//
// Redemptions are financed from a ring-fenced fund rather than straight out of
// each order's cash, so a burst of redemptions cannot drain operating cash.
// The fund is an accounting device: it never blocks a customer, but a deficit
// tightens the safety cap until contributions catch up.

export const rewardsFund = {
  async balanceMinor(client: Tx | typeof prisma = prisma): Promise<number> {
    const agg = await client.rewardsFundEntry.aggregate({ _sum: { amountMinor: true } });
    return agg._sum.amountMinor ?? 0;
  },

  /** Append a fund movement. A repeated idempotency key is a no-op. */
  async record(input: {
    type: RewardsFundEntryType;
    amountMinor: number; // signed
    description: string;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey?: string;
  }) {
    if (input.amountMinor === 0) return null;
    try {
      return await prisma.$transaction(async (tx) => {
        if (input.idempotencyKey) {
          const existing = await tx.rewardsFundEntry.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
          });
          if (existing) return existing;
        }
        const balance = await rewardsFund.balanceMinor(tx);
        return tx.rewardsFundEntry.create({
          data: {
            type: input.type,
            amountMinor: input.amountMinor,
            balanceAfterMinor: balance + input.amountMinor,
            description: input.description,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            idempotencyKey: input.idempotencyKey,
          },
        });
      });
    } catch (err) {
      // Concurrent write with the same key: the other one won, which is the
      // outcome we wanted anyway.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  },

  /** Called at settlement: set aside a slice of commission for future rewards. */
  contributeFromCommission(input: {
    commissionMinor: number;
    referenceType: string;
    referenceId: string;
    code: string;
  }) {
    const amountMinor = Math.floor(
      (Math.max(0, input.commissionMinor) * REWARDS_FUND_CONTRIBUTION_BPS) / 10_000,
    );
    return rewardsFund.record({
      type: RewardsFundEntryType.COMMISSION_CONTRIBUTION,
      amountMinor,
      description: `Rewards provision from ${input.code}`,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: `fund-contrib:${input.referenceType}:${input.referenceId}`,
    });
  },
};

// ── Tiers ───────────────────────────────────────────────────

/**
 * Tier follows trailing-12-month eligible spend. Recomputed lazily whenever we
 * quote or award points, so there is no nightly job to keep alive.
 */
export async function currentTier(userId: string): Promise<MemberTier> {
  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
    select: { memberTier: true, tierReviewedAt: true },
  });
  if (!profile) return 'BRONZE';

  const dayOld = Date.now() - (profile.tierReviewedAt?.getTime() ?? 0) > 86_400_000;
  if (!dayOld) return profile.memberTier;

  const since = new Date(Date.now() - 365 * 86_400_000);
  const [orders, bookings, rentals] = await Promise.all([
    prisma.order.aggregate({
      where: { customerId: userId, status: { in: ['DELIVERED', 'COMPLETED'] }, createdAt: { gte: since } },
      _sum: { subtotalMinor: true },
    }),
    prisma.serviceBooking.aggregate({
      where: { customerId: userId, status: 'COMPLETED', createdAt: { gte: since } },
      _sum: { serviceFeeMinor: true },
    }),
    prisma.rentalReservation.aggregate({
      where: { customerId: userId, status: 'COMPLETED', createdAt: { gte: since } },
      _sum: { rentalFeeMinor: true },
    }),
  ]);
  const spend =
    (orders._sum.subtotalMinor ?? 0) +
    (bookings._sum.serviceFeeMinor ?? 0) +
    (rentals._sum.rentalFeeMinor ?? 0);
  const tier = tierForSpend(spend);
  await prisma.customerProfile.update({
    where: { userId },
    data: { memberTier: tier, tierReviewedAt: new Date() },
  });
  return tier;
}

// ── Campaigns ───────────────────────────────────────────────

/**
 * Best applicable campaign for an order. At most one multiplier and one bonus
 * apply — campaigns never stack, so a promotions mistake cannot multiply into
 * a runaway liability.
 */
export async function activeCampaignBoost(input: {
  category: ProviderCategory;
  eligibleMinor: number;
  isFirstOrder: boolean;
}): Promise<{ multiplierBps: number; bonusPoints: number; names: string[] }> {
  const now = new Date();
  const campaigns = await prisma.loyaltyCampaign.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
      minSpendMinor: { lte: input.eligibleMinor },
    },
  });
  const applicable = campaigns.filter(
    (c) =>
      (c.categories.length === 0 || c.categories.includes(input.category)) &&
      (!c.firstOrderOnly || input.isFirstOrder),
  );

  const multiplier = applicable
    .filter((c) => c.type === LoyaltyCampaignType.MULTIPLIER)
    .reduce<{ value: number; name: string } | null>(
      (best, c) => (best && best.value >= c.value ? best : { value: c.value, name: c.name }),
      null,
    );
  const bonus = applicable
    .filter((c) => c.type === LoyaltyCampaignType.BONUS_POINTS)
    .reduce<{ value: number; name: string } | null>(
      (best, c) => (best && best.value >= c.value ? best : { value: c.value, name: c.name }),
      null,
    );

  return {
    multiplierBps: multiplier?.value ?? 10_000,
    bonusPoints: bonus?.value ?? 0,
    names: [multiplier?.name, bonus?.name].filter((n): n is string => Boolean(n)),
  };
}

// ── Expiry ──────────────────────────────────────────────────

/**
 * Sweep lots whose 12 months are up. Runs lazily on read/write paths rather
 * than on a scheduler; the provision returns to the rewards fund because that
 * liability will never be redeemed.
 */
export async function expireStalePoints(userId: string): Promise<number> {
  const account = await prisma.loyaltyAccount.findUnique({ where: { userId } });
  if (!account) return 0;

  const stale = await prisma.loyaltyTransaction.findMany({
    where: {
      accountId: account.id,
      type: 'EARN',
      expiresAt: { lte: new Date() },
      pointsRemaining: { gt: 0 },
    },
  });
  if (stale.length === 0) return 0;

  const expired = stale.reduce((sum, lot) => sum + (lot.pointsRemaining ?? 0), 0);
  await prisma.$transaction([
    ...stale.map((lot) =>
      prisma.loyaltyTransaction.update({ where: { id: lot.id }, data: { pointsRemaining: 0 } }),
    ),
    prisma.loyaltyTransaction.create({
      data: {
        accountId: account.id,
        type: 'EXPIRE',
        points: -expired,
        description: `${expired} points expired after ${POINTS_LIFETIME_MONTHS} months`,
      },
    }),
    prisma.loyaltyAccount.update({
      where: { id: account.id },
      data: { pointsBalance: { decrement: expired } },
    }),
  ]);

  await rewardsFund.record({
    type: RewardsFundEntryType.EXPIRY_CREDIT,
    amountMinor: pointsToMinor(expired),
    description: `${expired} points expired unredeemed`,
    referenceType: 'loyalty-account',
    referenceId: account.id,
  });
  return expired;
}

/** Points that will lapse inside the warning window, so the app can nudge. */
export async function expiringSoon(userId: string): Promise<{ points: number; at: Date | null }> {
  const account = await prisma.loyaltyAccount.findUnique({ where: { userId } });
  if (!account) return { points: 0, at: null };
  const horizon = new Date(Date.now() + EXPIRY_WARNING_DAYS * 86_400_000);
  const lots = await prisma.loyaltyTransaction.findMany({
    where: {
      accountId: account.id,
      type: 'EARN',
      pointsRemaining: { gt: 0 },
      expiresAt: { gt: new Date(), lte: horizon },
    },
    orderBy: { expiresAt: 'asc' },
  });
  return {
    points: lots.reduce((sum, l) => sum + (l.pointsRemaining ?? 0), 0),
    at: lots[0]?.expiresAt ?? null,
  };
}

// ── Earning and spending ────────────────────────────────────

/** Award points for a settled transaction, opening a fresh 12-month lot. */
export async function awardPoints(input: {
  userId: string;
  eligibleMinor: number;
  category: ProviderCategory;
  referenceType: string;
  referenceId: string;
  code: string;
  isFirstOrder?: boolean;
}): Promise<number> {
  const [tier, boost] = await Promise.all([
    currentTier(input.userId),
    activeCampaignBoost({
      category: input.category,
      eligibleMinor: input.eligibleMinor,
      isFirstOrder: input.isFirstOrder ?? false,
    }),
  ]);

  const points = computePointsEarned({
    eligibleMinor: input.eligibleMinor,
    category: input.category,
    tier,
    campaignMultiplierBps: boost.multiplierBps,
    campaignBonusPoints: boost.bonusPoints,
  });
  if (points <= 0) return 0;

  const suffix = boost.names.length ? ` (${boost.names.join(', ')})` : '';
  await prisma.$transaction([
    prisma.loyaltyAccount.update({
      where: { userId: input.userId },
      data: { pointsBalance: { increment: points } },
    }),
    prisma.loyaltyTransaction.create({
      data: {
        account: { connect: { userId: input.userId } },
        type: 'EARN',
        points,
        description: `Earned on ${input.code}${suffix}`,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        expiresAt: expiryFromNow(),
        pointsRemaining: points,
      },
    }),
  ]);
  return points;
}

/**
 * Spend points, drawing down the oldest lots first so customers always use the
 * points closest to expiring. Returns false when the balance moved underneath
 * us, which the caller surfaces as INSUFFICIENT_POINTS.
 */
export async function spendPoints(input: {
  userId: string;
  points: number;
  description: string;
  referenceType: string;
  referenceId?: string;
}): Promise<boolean> {
  if (input.points <= 0) return true;
  await expireStalePoints(input.userId);

  return prisma.$transaction(async (tx) => {
    const debited = await tx.loyaltyAccount.updateMany({
      where: { userId: input.userId, pointsBalance: { gte: input.points } },
      data: { pointsBalance: { decrement: input.points } },
    });
    if (debited.count === 0) return false;

    const account = await tx.loyaltyAccount.findUniqueOrThrow({ where: { userId: input.userId } });
    const lots = await tx.loyaltyTransaction.findMany({
      where: { accountId: account.id, type: 'EARN', pointsRemaining: { gt: 0 } },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });

    let outstanding = input.points;
    for (const lot of lots) {
      if (outstanding <= 0) break;
      const take = Math.min(lot.pointsRemaining ?? 0, outstanding);
      await tx.loyaltyTransaction.update({
        where: { id: lot.id },
        data: { pointsRemaining: (lot.pointsRemaining ?? 0) - take },
      });
      outstanding -= take;
    }

    await tx.loyaltyTransaction.create({
      data: {
        accountId: account.id,
        type: 'REDEEM',
        points: -input.points,
        description: input.description,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    });
    return true;
  });
}

/**
 * Give spent points back (cancelled order). They return as a fresh lot rather
 * than to the exact lots they came from: simpler, and it only ever favours the
 * customer, whose points were spent moments ago anyway.
 */
export async function restorePoints(input: {
  userId: string;
  points: number;
  description: string;
  referenceType: string;
  referenceId?: string;
}) {
  if (input.points <= 0) return;
  await prisma.$transaction([
    prisma.loyaltyAccount.update({
      where: { userId: input.userId },
      data: { pointsBalance: { increment: input.points } },
    }),
    prisma.loyaltyTransaction.create({
      data: {
        account: { connect: { userId: input.userId } },
        type: 'ADJUSTMENT',
        points: input.points,
        description: input.description,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        expiresAt: expiryFromNow(),
        pointsRemaining: input.points,
      },
    }),
  ]);
}

/**
 * Claw back points awarded for something later refunded. The balance is
 * allowed to go negative: the alternative is refusing the customer's cash
 * refund because they already spent the points, which is worse. Future earnings
 * pay the deficit off before the balance becomes spendable again.
 */
export async function reverseEarnedPoints(input: {
  userId: string;
  points: number;
  description: string;
  referenceType: string;
  referenceId?: string;
}) {
  if (input.points <= 0) return;
  const account = await prisma.loyaltyAccount.findUnique({ where: { userId: input.userId } });
  if (!account) return;

  const lots = await prisma.loyaltyTransaction.findMany({
    where: { accountId: account.id, type: 'EARN', pointsRemaining: { gt: 0 } },
    orderBy: [{ createdAt: 'desc' }],
  });
  let outstanding = input.points;
  const lotUpdates = [];
  for (const lot of lots) {
    if (outstanding <= 0) break;
    const take = Math.min(lot.pointsRemaining ?? 0, outstanding);
    lotUpdates.push(
      prisma.loyaltyTransaction.update({
        where: { id: lot.id },
        data: { pointsRemaining: (lot.pointsRemaining ?? 0) - take },
      }),
    );
    outstanding -= take;
  }

  await prisma.$transaction([
    ...lotUpdates,
    prisma.loyaltyAccount.update({
      where: { id: account.id },
      data: { pointsBalance: { decrement: input.points } },
    }),
    prisma.loyaltyTransaction.create({
      data: {
        accountId: account.id,
        type: 'ADJUSTMENT',
        points: -input.points,
        description: input.description,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    }),
  ]);
}

// ── The engine ──────────────────────────────────────────────

export type RedemptionQuote = RedemptionCap & {
  pointsBalance: number;
  pointValueMinor: number;
  maxPercent: number;
  minOrderMinor: number;
  tier: MemberTier;
  earnRateLabel: string;
};

/**
 * How much of this order may points cover? Applies every limit and reports
 * which one bound, so checkout can explain itself instead of silently
 * offering less than the customer expects.
 */
export async function quoteRedemption(input: {
  userId: string;
  itemsMinor: number;
  deliveryFeeMinor: number;
  provider: { commissionBps: number | null; categories: ProviderCategory[] };
  merchantFunded?: boolean;
}): Promise<RedemptionQuote> {
  await expireStalePoints(input.userId);
  const [account, tier, fundBalance] = await Promise.all([
    prisma.loyaltyAccount.findUnique({ where: { userId: input.userId } }),
    currentTier(input.userId),
    rewardsFund.balanceMinor(),
  ]);

  const category = input.provider.categories[0] ?? ProviderCategory.RESTAURANT;
  const commissionBps = commissionBpsForProvider(input.provider);
  const expectedCommissionMinor = commissionOfMinor(input.itemsMinor, commissionBps);

  // The fund is a provision, not a gate. It starts empty and customers redeem
  // before contributions accumulate, so an early deficit is normal and must not
  // quietly halve everyone's rewards. Only a deficit past the configured
  // tolerance tightens the cap, which is the signal that the contribution rate
  // or the caps need a deliberate revision.
  const overdrawn = fundBalance < -env.REWARDS_FUND_DEFICIT_TOLERANCE_MINOR;
  const commissionSafetyPercent = overdrawn
    ? Math.floor(COMMISSION_SAFETY_PERCENT / 2)
    : COMMISSION_SAFETY_PERCENT;

  const cap = computeRedemptionCap({
    pointsBalance: Math.max(0, account?.pointsBalance ?? 0),
    itemsMinor: input.itemsMinor,
    deliveryFeeMinor: input.deliveryFeeMinor,
    expectedCommissionMinor,
    category,
    merchantFunded: input.merchantFunded,
    commissionSafetyPercent,
  });

  const minorPerPoint = CATEGORY_MINOR_PER_POINT[category];
  const perHundred = minorPerPoint
    ? ((10_000 / minorPerPoint) * (TIER_MULTIPLIER_BPS[tier] / 10_000)).toFixed(2).replace(/\.?0+$/, '')
    : '0';

  return {
    ...cap,
    pointsBalance: account?.pointsBalance ?? 0,
    pointValueMinor: POINT_VALUE_MINOR,
    maxPercent: MAX_REDEEM_PERCENT,
    minOrderMinor: MIN_ORDER_FOR_REDEMPTION_MINOR,
    tier,
    earnRateLabel: `${perHundred} ${perHundred === '1' ? 'point' : 'points'} per JMD 100`,
  };
}

/** Wallet/points screen summary. */
export async function pointsSnapshot(userId: string) {
  await expireStalePoints(userId);
  const [account, tier, soon] = await Promise.all([
    prisma.loyaltyAccount.findUnique({ where: { userId } }),
    currentTier(userId),
    expiringSoon(userId),
  ]);
  return {
    pointsBalance: account?.pointsBalance ?? 0,
    pointValueMinor: POINT_VALUE_MINOR,
    maxRedeemPercent: MAX_REDEEM_PERCENT,
    minOrderMinor: MIN_ORDER_FOR_REDEMPTION_MINOR,
    cashConvertible: false,
    tier,
    tierMultiplier: TIER_MULTIPLIER_BPS[tier] / 10_000,
    expiringPoints: soon.points,
    expiringAt: soon.at,
  };
}

export const rewardsService = {
  rewardsFund,
  currentTier,
  activeCampaignBoost,
  expireStalePoints,
  expiringSoon,
  awardPoints,
  spendPoints,
  restorePoints,
  reverseEarnedPoints,
  quoteRedemption,
  pointsSnapshot,
};
