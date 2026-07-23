import { ProviderCategory } from '@prisma/client';
import { env } from '../config/env';

/**
 * Voryn's revenue model is provider-funded: customers pay the displayed price
 * and Voryn deducts an agreed commission from the provider's earnings (or a
 * delivery margin from the delivery fee). Rates are basis points (100 = 1%).
 *
 * Rules that must hold everywhere:
 *  - Commission is computed on the amount the provider is contractually
 *    entitled to receive, BEFORE any Voryn-funded customer reward.
 *  - Merchant-funded discounts reduce the commission basis; Voryn-funded
 *    discounts (points) never do.
 *  - Tips carry no commission and are never reduced by points.
 */
export const CATEGORY_COMMISSION_BPS: Record<ProviderCategory, number> = {
  RESTAURANT: 1000,
  GROCERY: 700,
  PHARMACY: 700,
  CONVENIENCE: 700,
  DRINKS: 700,
  RIDES: 1200,
  VEHICLE_RENTAL: 1000,
  AUTO_CARE: 1000,
  TECHNICIAN: 1000,
  HOME_SERVICES: 1000,
  SUPPLIER: 400, // B2B settles on delivery; commission applies when wallet settlement lands
};

const DEFAULT_COMMISSION_BPS = 1000;

type ProviderRateInput = { commissionBps: number | null; categories: ProviderCategory[] };

/** Negotiated override wins; otherwise the provider's primary category rate. */
export function commissionBpsForProvider(provider: ProviderRateInput): number {
  if (provider.commissionBps != null) return provider.commissionBps;
  const primary = provider.categories[0];
  return primary ? CATEGORY_COMMISSION_BPS[primary] : DEFAULT_COMMISSION_BPS;
}

export function commissionOfMinor(basisMinor: number, bps: number): number {
  if (basisMinor <= 0) return 0;
  return Math.round((basisMinor * bps) / 10000);
}

/**
 * Delivery-margin model: the courier is guaranteed the delivery fee minus
 * Voryn's margin, plus 100% of tips. Shown to couriers as their earnings, not
 * as a fee deducted from a bigger number.
 */
export function deliverySplit(deliveryFeeMinor: number): {
  courierCompensationMinor: number;
  vorynMarginMinor: number;
} {
  if (deliveryFeeMinor <= 0) return { courierCompensationMinor: 0, vorynMarginMinor: 0 };
  const raw = Math.round((deliveryFeeMinor * env.DELIVERY_MARGIN_BPS) / 10000);
  const rounded = Math.round(raw / 1000) * 1000; // whole JMD 10 steps
  const margin = Math.min(
    Math.min(env.DELIVERY_MARGIN_MAX_MINOR, deliveryFeeMinor),
    Math.max(env.DELIVERY_MARGIN_MIN_MINOR, rounded),
  );
  return { courierCompensationMinor: deliveryFeeMinor - margin, vorynMarginMinor: margin };
}

/** Driver's take-home on a ride fare (tips excluded — they are added whole). */
export function rideDriverEarningsMinor(fareMinor: number): number {
  return fareMinor - commissionOfMinor(fareMinor, env.RIDE_COMMISSION_BPS);
}
