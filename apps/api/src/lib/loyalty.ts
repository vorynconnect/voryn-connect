/**
 * Voryn Points launch configuration.
 *  - 1 point = JMD 1 of discount (100 minor units).
 *  - Earn 1 point per JMD 100 of eligible spend (~1% reward rate).
 *  - Eligible spend = product/service subtotal after discounts; never
 *    delivery fees, platform fees, taxes, or tips.
 *  - Redemption is capped at 20% of the eligible amount per order.
 *  - Points are never convertible to cash and never touch tips.
 */
export const POINT_VALUE_MINOR = 100;
export const EARN_MINOR_PER_POINT = 10000;
export const MAX_REDEEM_PERCENT = 20;

export function pointsEarnedFor(eligibleMinor: number): number {
  return Math.max(0, Math.floor(eligibleMinor / EARN_MINOR_PER_POINT));
}

export function maxRedeemablePoints(eligibleMinor: number, pointsBalance: number): number {
  const capMinor = Math.floor((eligibleMinor * MAX_REDEEM_PERCENT) / 100);
  return Math.max(0, Math.min(pointsBalance, Math.floor(capMinor / POINT_VALUE_MINOR)));
}
