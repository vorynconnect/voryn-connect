import { MemberTier, ProviderCategory } from '@prisma/client';

/**
 * Voryn Points configuration and pure math. Nothing here touches the database
 * — see modules/rewards/rewards.service.ts for the stateful side.
 *
 * The programme is deliberately asymmetric. Customers earn a headline-friendly
 * 5 points per JMD 100, but a point is worth JMD 0.10, so the real reward is
 * 0.5% of eligible spend. That lets Voryn advertise "5 points per JMD 100"
 * without running a 5% cashback programme it cannot afford.
 *
 * Four separate limits cap what any one order can absorb, and the tightest
 * wins. The last two make a loss-making redemption structurally impossible.
 */

/** 10 points = JMD 1, so one point is worth 10 minor units. */
export const POINT_VALUE_MINOR = 10;
export const POINTS_PER_JMD = 10;

/** Eligible spend that earns one point: JMD 20 (5 points per JMD 100). */
export const EARN_MINOR_PER_POINT = 2_000;

/** Nothing below this may be redeemed, and only in whole increments. */
export const MIN_REDEMPTION_POINTS = 500; // JMD 50
export const REDEMPTION_INCREMENT_POINTS = 100; // JMD 10

/** Points may cover at most this share of an order's redeemable base. */
export const MAX_REDEEM_PERCENT = 5;

/**
 * …and never more than this share of the commission Voryn expects from the
 * order. Protects thin-margin categories, where 5% of the order can easily
 * exceed the whole commission.
 */
export const COMMISSION_SAFETY_PERCENT = 25;

/** Small orders cannot be discounted with points at all. */
export const MIN_ORDER_FOR_REDEMPTION_MINOR = 150_000; // JMD 1,500

/**
 * Points may subsidise delivery but never make it free. At the current 5%
 * order cap this is already implied, so it is a backstop rather than a live
 * limit: it exists so that raising MAX_REDEEM_PERCENT later cannot silently
 * start handing out free delivery.
 */
export const MAX_DELIVERY_COVERAGE_PERCENT = 50;

export const POINTS_LIFETIME_MONTHS = 12;
export const EXPIRY_WARNING_DAYS = 30;

/** Share of Voryn's commission set aside to finance future redemptions. */
export const REWARDS_FUND_CONTRIBUTION_BPS = 500; // 5%

/**
 * How much eligible spend earns one point. Uniform at launch (5 points per
 * JMD 100 everywhere) — the per-category lever stays here so earn rates can be
 * tuned toward higher-margin work later without touching point value, which
 * must never change. B2B supply orders earn nothing: they are not consumer
 * purchases.
 */
export const CATEGORY_MINOR_PER_POINT: Record<ProviderCategory, number | null> = {
  RESTAURANT: EARN_MINOR_PER_POINT,
  GROCERY: EARN_MINOR_PER_POINT,
  PHARMACY: EARN_MINOR_PER_POINT,
  CONVENIENCE: EARN_MINOR_PER_POINT,
  DRINKS: EARN_MINOR_PER_POINT,
  RIDES: EARN_MINOR_PER_POINT,
  AUTO_CARE: EARN_MINOR_PER_POINT,
  TECHNICIAN: EARN_MINOR_PER_POINT,
  HOME_SERVICES: EARN_MINOR_PER_POINT,
  VEHICLE_RENTAL: EARN_MINOR_PER_POINT,
  SUPPLIER: null,
};

/** Tiers raise the earn rate only. Point value never changes. */
export const TIER_MULTIPLIER_BPS: Record<MemberTier, number> = {
  BRONZE: 10_000, // 1.0x → 0.5% reward
  SILVER: 12_500, // 1.25x
  GOLD: 15_000, // 1.5x
  PLATINUM: 20_000, // 2.0x → 1.0% reward
};

/** Trailing-12-month eligible spend needed to hold each tier. */
export const TIER_THRESHOLDS_MINOR: Array<{ tier: MemberTier; minSpendMinor: number }> = [
  { tier: 'PLATINUM', minSpendMinor: 40_000_000 }, // JMD 400,000
  { tier: 'GOLD', minSpendMinor: 15_000_000 }, // JMD 150,000
  { tier: 'SILVER', minSpendMinor: 5_000_000 }, // JMD 50,000
  { tier: 'BRONZE', minSpendMinor: 0 },
];

export function tierForSpend(trailingSpendMinor: number): MemberTier {
  return (
    TIER_THRESHOLDS_MINOR.find((t) => trailingSpendMinor >= t.minSpendMinor)?.tier ?? 'BRONZE'
  );
}

export function pointsToMinor(points: number): number {
  return points * POINT_VALUE_MINOR;
}

/**
 * Points earned on an order. Category sets the base rate, tier multiplies it,
 * and an active campaign multiplies or tops it up. Every step rounds down, so
 * the programme never issues a point it did not fully earn.
 */
export function computePointsEarned(input: {
  eligibleMinor: number;
  category: ProviderCategory;
  tier: MemberTier;
  campaignMultiplierBps?: number;
  campaignBonusPoints?: number;
}): number {
  const minorPerPoint = CATEGORY_MINOR_PER_POINT[input.category];
  if (minorPerPoint == null || input.eligibleMinor <= 0) return 0;

  const base = Math.floor(input.eligibleMinor / minorPerPoint);
  const tiered = Math.floor((base * TIER_MULTIPLIER_BPS[input.tier]) / 10_000);
  const campaigned =
    input.campaignMultiplierBps && input.campaignMultiplierBps !== 10_000
      ? Math.floor((tiered * input.campaignMultiplierBps) / 10_000)
      : tiered;
  return Math.max(0, campaigned + (input.campaignBonusPoints ?? 0));
}

/** Which rule held the redemption down. Drives the message shown at checkout. */
export type RedemptionLimit =
  | 'BALANCE'
  | 'ORDER_PERCENT'
  | 'COMMISSION_SAFETY'
  | 'MARGIN_SAFETY'
  | 'DELIVERY_COVERAGE'
  | 'MIN_ORDER'
  | 'BELOW_MINIMUM'
  | 'CATEGORY_INELIGIBLE';

export type RedemptionCap = {
  maxPoints: number;
  maxMinor: number;
  limitedBy: RedemptionLimit;
  /** Customer-facing sentence explaining the cap. */
  reason: string;
};

/**
 * The rewards engine's core decision: how much of this order may points cover?
 *
 * Every limit is evaluated and the tightest wins, so adding a rule later can
 * only ever make redemption safer.
 *
 *  - `expectedCommissionMinor` is what Voryn earns from the provider here.
 *  - `safeMarginMinor` is that commission less the order's direct costs and
 *    Voryn's minimum profit, so a discount can never eat the contribution
 *    margin (see lib/margin.ts).
 *
 * When the reward is merchant-funded, the commission and margin caps do not
 * apply — the merchant agreed to fund the discount, so it is not Voryn's cost.
 */
export function computeRedemptionCap(input: {
  pointsBalance: number;
  /** Items/service value after any promo discount. */
  itemsMinor: number;
  deliveryFeeMinor: number;
  expectedCommissionMinor: number;
  safeMarginMinor: number;
  category: ProviderCategory;
  merchantFunded?: boolean;
  commissionSafetyPercent?: number;
}): RedemptionCap {
  const none = (limitedBy: RedemptionLimit, reason: string): RedemptionCap => ({
    maxPoints: 0,
    maxMinor: 0,
    limitedBy,
    reason,
  });

  if (CATEGORY_MINOR_PER_POINT[input.category] == null) {
    return none('CATEGORY_INELIGIBLE', 'Points cannot be redeemed on this type of order.');
  }

  const redeemableBase = input.itemsMinor + input.deliveryFeeMinor;
  if (redeemableBase < MIN_ORDER_FOR_REDEMPTION_MINOR) {
    const shortfall = MIN_ORDER_FOR_REDEMPTION_MINOR - redeemableBase;
    return none(
      'MIN_ORDER',
      `Spend JMD ${(shortfall / 100).toLocaleString('en-JM')} more to use points on this order.`,
    );
  }

  const unlimited = Number.MAX_SAFE_INTEGER;
  const safetyPercent = input.commissionSafetyPercent ?? COMMISSION_SAFETY_PERCENT;

  const limits: Array<{ minor: number; limitedBy: RedemptionLimit; reason: string }> = [
    {
      minor: pointsToMinor(input.pointsBalance),
      limitedBy: 'BALANCE',
      reason: 'You are redeeming every point you have.',
    },
    {
      minor: Math.floor((redeemableBase * MAX_REDEEM_PERCENT) / 100),
      limitedBy: 'ORDER_PERCENT',
      reason: `Points can cover up to ${MAX_REDEEM_PERCENT}% of an order.`,
    },
    {
      minor: input.merchantFunded
        ? unlimited
        : Math.floor((Math.max(0, input.expectedCommissionMinor) * safetyPercent) / 100),
      limitedBy: 'COMMISSION_SAFETY',
      reason: `Points can cover up to ${MAX_REDEEM_PERCENT}% of an order. This one is capped a little lower.`,
    },
    {
      minor: input.merchantFunded ? unlimited : Math.max(0, input.safeMarginMinor),
      limitedBy: 'MARGIN_SAFETY',
      reason: `Points can cover up to ${MAX_REDEEM_PERCENT}% of an order. This one is capped a little lower.`,
    },
    {
      minor:
        input.itemsMinor +
        Math.floor((input.deliveryFeeMinor * MAX_DELIVERY_COVERAGE_PERCENT) / 100),
      limitedBy: 'DELIVERY_COVERAGE',
      reason: 'Points cannot cover the whole delivery fee.',
    },
  ];

  const tightest = limits.reduce((a, b) => (b.minor < a.minor ? b : a));
  // Redemption happens in whole increments, so round down to the nearest step.
  const rawPoints = Math.floor(tightest.minor / POINT_VALUE_MINOR);
  const maxPoints =
    Math.floor(rawPoints / REDEMPTION_INCREMENT_POINTS) * REDEMPTION_INCREMENT_POINTS;

  if (maxPoints < MIN_REDEMPTION_POINTS) {
    return none(
      'BELOW_MINIMUM',
      `You need at least ${MIN_REDEMPTION_POINTS.toLocaleString('en-JM')} points to redeem on an order this size.`,
    );
  }

  return {
    maxPoints,
    maxMinor: pointsToMinor(maxPoints),
    limitedBy: tightest.limitedBy,
    reason: tightest.reason,
  };
}

/** Clamp a requested redemption to the cap and the increment rules. */
export function normaliseRequestedPoints(requested: number, cap: RedemptionCap): number {
  if (cap.maxPoints < MIN_REDEMPTION_POINTS) return 0;
  const bounded = Math.min(requested, cap.maxPoints);
  const stepped =
    Math.floor(bounded / REDEMPTION_INCREMENT_POINTS) * REDEMPTION_INCREMENT_POINTS;
  return stepped >= MIN_REDEMPTION_POINTS ? stepped : 0;
}
