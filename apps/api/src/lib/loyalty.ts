import { MemberTier, ProviderCategory } from '@prisma/client';

/**
 * Voryn Points configuration and pure math. Nothing here touches the database
 * — see modules/rewards/rewards.service.ts for the stateful side.
 *
 * The programme is deliberately asymmetric: points are earned slowly (~1% of
 * eligible spend) but are worth a full JMD 1 each at redemption. That reads as
 * generous while costing about 1%, and it keeps the liability easy to value.
 *
 * The rule that actually protects the business is the commission safety cap:
 * a redemption may never exceed a set share of the commission Voryn expects to
 * earn on that same order, so no single order can be discounted into a loss.
 */

/** A point is always worth exactly JMD 1 when redeemed. */
export const POINT_VALUE_MINOR = 100;

/** Points may cover at most this share of an order's redeemable base. */
export const MAX_REDEEM_PERCENT = 20;

/**
 * …and never more than this share of the commission Voryn expects from the
 * order. This is what makes a loss-making redemption structurally impossible.
 */
export const COMMISSION_SAFETY_PERCENT = 80;

/** Small orders cannot be discounted with points at all. */
export const MIN_ORDER_FOR_REDEMPTION_MINOR = 150_000; // JMD 1,500

/**
 * Points may subsidise delivery but never make it free. At the current 20%
 * order cap this is already implied (20% of items+delivery is always below
 * items + half the delivery fee), so it is a backstop rather than a live
 * limit: it exists so that raising MAX_REDEEM_PERCENT later cannot silently
 * start handing out free delivery.
 */
export const MAX_DELIVERY_COVERAGE_PERCENT = 50;

export const POINTS_LIFETIME_MONTHS = 12;
export const EXPIRY_WARNING_DAYS = 30;

/** Share of Voryn's commission set aside to finance future redemptions. */
export const REWARDS_FUND_CONTRIBUTION_BPS = 50; // 0.5%

/**
 * How much eligible spend earns one point, per category. Lower is more
 * generous, and the generous categories are the high-margin ones — this is the
 * lever for steering demand toward profitable work, rather than point value.
 */
export const CATEGORY_MINOR_PER_POINT: Record<ProviderCategory, number | null> = {
  RESTAURANT: 10_000, // 1 point per JMD 100
  GROCERY: 13_333, // 0.75 per JMD 100 (thin margins)
  PHARMACY: 13_333,
  CONVENIENCE: 13_333,
  DRINKS: 13_333,
  RIDES: 12_000, // 1 point per JMD 120
  AUTO_CARE: 5_000, // 2 points per JMD 100
  TECHNICIAN: 5_000,
  HOME_SERVICES: 5_000,
  VEHICLE_RENTAL: 3_333, // 3 points per JMD 100
  SUPPLIER: null, // B2B restocking is not a consumer reward
};

/** Tiers raise the earn rate only. Point value never changes. */
export const TIER_MULTIPLIER_BPS: Record<MemberTier, number> = {
  BRONZE: 10_000, // 1.0x
  SILVER: 12_500, // 1.25x
  GOLD: 15_000, // 1.5x
  PLATINUM: 20_000, // 2.0x
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
  | 'DELIVERY_COVERAGE'
  | 'MIN_ORDER'
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
 * only ever make redemption safer. `expectedCommissionMinor` is what Voryn
 * earns from the provider on this order; when the reward is merchant-funded
 * that cap does not apply, because the merchant agreed to fund the discount.
 */
export function computeRedemptionCap(input: {
  pointsBalance: number;
  /** Items/service value after any promo discount. */
  itemsMinor: number;
  deliveryFeeMinor: number;
  expectedCommissionMinor: number;
  category: ProviderCategory;
  merchantFunded?: boolean;
  /** Negative fund balance tightens the safety cap; see rewards.service. */
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

  const balanceMinor = pointsToMinor(input.pointsBalance);
  const orderPercentMinor = Math.floor((redeemableBase * MAX_REDEEM_PERCENT) / 100);
  const deliveryCoverageMinor =
    input.itemsMinor +
    Math.floor((input.deliveryFeeMinor * MAX_DELIVERY_COVERAGE_PERCENT) / 100);
  const safetyPercent = input.commissionSafetyPercent ?? COMMISSION_SAFETY_PERCENT;
  const commissionSafetyMinor = input.merchantFunded
    ? Number.MAX_SAFE_INTEGER
    : Math.floor((Math.max(0, input.expectedCommissionMinor) * safetyPercent) / 100);

  const limits: Array<{ minor: number; limitedBy: RedemptionLimit; reason: string }> = [
    {
      minor: balanceMinor,
      limitedBy: 'BALANCE',
      reason: 'You are redeeming every point you have.',
    },
    {
      minor: orderPercentMinor,
      limitedBy: 'ORDER_PERCENT',
      reason: `Points can cover up to ${MAX_REDEEM_PERCENT}% of an order.`,
    },
    {
      minor: commissionSafetyMinor,
      limitedBy: 'COMMISSION_SAFETY',
      reason: `Points can cover up to ${MAX_REDEEM_PERCENT}% of an order. This one is capped a little lower.`,
    },
    {
      minor: deliveryCoverageMinor,
      limitedBy: 'DELIVERY_COVERAGE',
      reason: 'Points cannot cover the whole delivery fee.',
    },
  ];

  const tightest = limits.reduce((a, b) => (b.minor < a.minor ? b : a));
  const maxPoints = Math.max(0, Math.floor(tightest.minor / POINT_VALUE_MINOR));
  return {
    maxPoints,
    maxMinor: pointsToMinor(maxPoints),
    limitedBy: tightest.limitedBy,
    reason: tightest.reason,
  };
}
