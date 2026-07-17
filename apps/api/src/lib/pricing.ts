/**
 * Distance-based pricing shared by rides and deliveries.
 *
 * Deliveries: the merchant's configured fee is the base and covers the first
 * INCLUDED_KM; beyond that the customer pays PER_KM on top, clamped and
 * rounded so quotes look like money, not math. The courier is paid the full
 * delivery fee (plus tip), so this is also the courier's pay estimate.
 */

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const DELIVERY_PRICING = {
  /** Kilometres the merchant's base fee already covers. */
  includedKm: 2,
  /** JMD 50/km beyond the included distance. */
  perKmMinor: 5000,
  /** Floor so short hops still pay the courier fairly (JMD 150). */
  minFeeMinor: 15000,
  /** Ceiling to keep long-haul quotes sane (JMD 800). */
  maxFeeMinor: 80000,
  /** Quotes rounded to whole JMD 10. */
  roundToMinor: 1000,
  /** Extra travel minutes per km beyond the included distance. */
  extraMinutesPerKm: 3,
} as const;

/** Delivery fee for a trip of `distanceKm`, on top of the merchant's base fee. */
export function distanceDeliveryFeeMinor(baseFeeMinor: number, distanceKm: number): number {
  const { includedKm, perKmMinor, minFeeMinor, maxFeeMinor, roundToMinor } = DELIVERY_PRICING;
  const extraKm = Math.max(0, distanceKm - includedKm);
  const raw = baseFeeMinor + extraKm * perKmMinor;
  const clamped = Math.min(maxFeeMinor, Math.max(minFeeMinor, raw));
  return Math.round(clamped / roundToMinor) * roundToMinor;
}

/** Merchant ETA window stretched for drop-offs beyond the included distance. */
export function distanceEtaMinutes(
  etaMinMinutes: number,
  etaMaxMinutes: number,
  distanceKm: number,
): { etaMinMinutes: number; etaMaxMinutes: number } {
  const extraKm = Math.max(0, distanceKm - DELIVERY_PRICING.includedKm);
  const extraMinutes = Math.ceil(extraKm * DELIVERY_PRICING.extraMinutesPerKm);
  return { etaMinMinutes: etaMinMinutes + extraMinutes, etaMaxMinutes: etaMaxMinutes + extraMinutes };
}
