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
  RESTAURANT: 1000, // 10%
  GROCERY: 800, // 8%
  PHARMACY: 800,
  CONVENIENCE: 800,
  DRINKS: 800,
  RIDES: 1500, // 15%
  VEHICLE_RENTAL: 1000, // 10%
  AUTO_CARE: 1200, // 12%
  TECHNICIAN: 1200,
  HOME_SERVICES: 1200,
  SUPPLIER: 500, // 5%; B2B settles on delivery
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
 * Courier settlement. Couriers now pay a straight commission on the delivery
 * fee (COURIER_COMMISSION_BPS, 12%) rather than the older "Voryn keeps the
 * remaining margin" model, so every provider type is priced the same way and
 * couriers can see the rate they are charged. Tips are never commissioned.
 */
export function deliverySplit(deliveryFeeMinor: number): {
  courierCompensationMinor: number;
  vorynMarginMinor: number;
} {
  if (deliveryFeeMinor <= 0) return { courierCompensationMinor: 0, vorynMarginMinor: 0 };
  const commission = commissionOfMinor(deliveryFeeMinor, env.COURIER_COMMISSION_BPS);
  return {
    courierCompensationMinor: deliveryFeeMinor - commission,
    vorynMarginMinor: commission,
  };
}

/** Driver's take-home on a ride fare (tips excluded — they are added whole). */
export function rideDriverEarningsMinor(fareMinor: number): number {
  return fareMinor - commissionOfMinor(fareMinor, env.RIDE_COMMISSION_BPS);
}
