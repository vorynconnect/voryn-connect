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
  // Rides and deliveries are charged 9.99%; every other provider type 11.99%.
  RIDES: 999, // 9.99%
  RESTAURANT: 1199, // 11.99%
  GROCERY: 1199,
  PHARMACY: 1199,
  CONVENIENCE: 1199,
  DRINKS: 1199,
  VEHICLE_RENTAL: 1199,
  AUTO_CARE: 1199,
  TECHNICIAN: 1199,
  HOME_SERVICES: 1199,
  SUPPLIER: 1199, // "other marketplace providers"; B2B settles on delivery
};

const DEFAULT_COMMISSION_BPS = 1199;

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
 * Courier settlement. Couriers pay a straight commission on the delivery fee
 * (COURIER_COMMISSION_BPS, 9.99%) so every provider type is priced the same
 * way and couriers can see the rate they are charged. Tips are never
 * commissioned and are paid to the courier in full.
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
