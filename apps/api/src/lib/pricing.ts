/**
 * Distance-based delivery pricing.
 *
 * The customer's delivery fee is built from the *road* distance between the
 * merchant pickup and the drop-off (never the straight-line distance — see
 * modules/orders/delivery-quote.ts, which sources the distance from the maps
 * service). The tiered formula, the fee stack applied on top of it, and the
 * rounding rule all follow the published Voryn delivery pricing model:
 *
 *   0–3 km    JMD 500 flat
 *   3–10 km   JMD 500 + JMD 100 per additional km
 *   over 10   JMD 1,200 + JMD 130 per additional km
 *   rounding  up to the nearest JMD 50
 *
 * On top of the distance fee the pipeline applies, in order: a vehicle
 * multiplier, flat package and additional-pickup adjustments, a controlled
 * peak-demand multiplier, and any waiting-time fee. The courier is paid this
 * fee (less commission) plus 100% of tips, so the same number drives both the
 * customer quote and the courier's pay estimate.
 *
 * Everything here is pure. The stateful side (persisted signed quotes) lives in
 * modules/orders/delivery-quote.ts and delivery-quote.service.ts.
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
  /** Flat fee covering the first `includedKm` kilometres (JMD 500). */
  baseFeeMinor: 50_000,
  includedKm: 3,
  /** JMD 100 per km from the included distance up to the tier-1 ceiling. */
  tier1PerKmMinor: 10_000,
  tier1CeilingKm: 10,
  /** Fee at exactly the tier-1 ceiling (JMD 1,200), where tier 2 takes over. */
  tier1CeilingFeeMinor: 120_000,
  /** JMD 130 per km beyond the tier-1 ceiling. */
  tier2PerKmMinor: 13_000,
  /** Final fees are rounded up to a whole JMD 50. */
  roundToMinor: 5_000,
  /** No delivery is ever priced below the base fee (JMD 500). */
  minFeeMinor: 50_000,
  /** Extra travel minutes per km beyond the included distance (ETA fallback). */
  extraMinutesPerKm: 2,
} as const;

/** Round an amount UP to the nearest `stepMinor` (spec: round up to JMD 50). */
export function roundUpToMinor(amountMinor: number, stepMinor: number): number {
  if (stepMinor <= 0) return amountMinor;
  return Math.ceil(amountMinor / stepMinor) * stepMinor;
}

/**
 * The tiered distance fee for a road distance of `distanceKm`, rounded up to
 * the nearest JMD 50. This is the standard motorcycle price before any vehicle,
 * package, peak or waiting adjustment.
 */
export function distanceDeliveryFeeMinor(distanceKm: number): number {
  const { baseFeeMinor, includedKm, tier1PerKmMinor, tier1CeilingKm, tier1CeilingFeeMinor, tier2PerKmMinor, minFeeMinor } =
    DELIVERY_PRICING;
  const km = Math.max(0, distanceKm);

  let rawMinor: number;
  if (km <= includedKm) {
    rawMinor = baseFeeMinor;
  } else if (km <= tier1CeilingKm) {
    rawMinor = baseFeeMinor + (km - includedKm) * tier1PerKmMinor;
  } else {
    rawMinor = tier1CeilingFeeMinor + (km - tier1CeilingKm) * tier2PerKmMinor;
  }

  return roundUpToMinor(Math.max(minFeeMinor, rawMinor), DELIVERY_PRICING.roundToMinor);
}

/** Required/booked delivery vehicle. Bigger vehicles cost the courier more to run. */
export type DeliveryVehicle = 'MOTORCYCLE' | 'CAR' | 'SUV' | 'VAN';

/** Vehicle price multipliers in basis points (10000 = 1.00×). */
export const VEHICLE_MULTIPLIER_BPS: Record<DeliveryVehicle, number> = {
  MOTORCYCLE: 10_000, // 1.00×
  CAR: 12_000, // 1.20×
  SUV: 13_500, // 1.35×
  VAN: 16_000, // 1.60×
};

/** Merchant package classification. Larger packages carry a flat adjustment. */
export type PackageClass = 'SMALL' | 'MEDIUM' | 'LARGE' | 'OVERSIZED';

/**
 * Flat package adjustments. OVERSIZED carries no automatic fee — it is priced
 * with a custom quote or a larger vehicle, so it must never surprise-charge.
 */
export const PACKAGE_ADJUSTMENT_MINOR: Record<PackageClass, number> = {
  SMALL: 0,
  MEDIUM: 10_000, // JMD 100 (medium grocery order)
  LARGE: 25_000, // JMD 250 (large grocery or retail order)
  OVERSIZED: 0,
};

/** Flat fee per additional merchant pickup on a multi-merchant order (JMD 250). */
export const ADDITIONAL_PICKUP_FEE_MINOR = 25_000;

export function additionalPickupFeeMinor(merchantCount: number): number {
  return Math.max(0, Math.ceil(merchantCount) - 1) * ADDITIONAL_PICKUP_FEE_MINOR;
}

/** Controlled peak-demand levels. Never uncontrolled surge; capped at 1.30×. */
export type DemandLevel = 'NORMAL' | 'MODERATE' | 'HIGH' | 'SEVERE';

export const DEMAND_MULTIPLIER_BPS: Record<DemandLevel, number> = {
  NORMAL: 10_000, // 1.00×
  MODERATE: 11_000, // 1.10×
  HIGH: 12_000, // 1.20×
  SEVERE: 13_000, // 1.30× (maximum)
};

/** Hard ceiling on any peak multiplier, whatever the configured level. */
export const MAX_DEMAND_MULTIPLIER_BPS = 13_000;

export const WAITING_FEE = {
  /** Minutes at pickup that are always free. */
  freeMinutes: 10,
  /** JMD 20 per chargeable minute after the free period. */
  perMinuteMinor: 2_000,
  /** Maximum automatic waiting charge (JMD 400); beyond this needs support. */
  maxMinor: 40_000,
} as const;

/** Automatic waiting-time fee for `minutes` spent waiting at a pickup. */
export function waitingFeeMinor(minutes: number): number {
  const chargeable = Math.max(0, Math.floor(minutes) - WAITING_FEE.freeMinutes);
  return Math.min(WAITING_FEE.maxMinor, chargeable * WAITING_FEE.perMinuteMinor);
}

/** An approved destination change never adds less than this (JMD 200). */
export const MIN_DESTINATION_CHANGE_MINOR = 20_000;

export const CANCELLATION_FEE = {
  /** Courier accepted but has not reached the pickup yet (JMD 150). */
  courierEnRouteMinor: 15_000,
  /** Courier has arrived at the pickup (JMD 250). */
  courierAtPickupMinor: 25_000,
} as const;

export type DeliveryFeeInput = {
  distanceKm: number;
  vehicle?: DeliveryVehicle;
  packageClass?: PackageClass;
  /** Total merchants on the order; anything over 1 adds a pickup fee each. */
  merchantCount?: number;
  demandLevel?: DemandLevel;
  /** Peak multiplier as basis points; overrides `demandLevel` when provided. */
  demandMultiplierBps?: number;
  waitingMinutes?: number;
};

export type DeliveryFeeBreakdown = {
  baseFeeMinor: number;
  /** Additional-distance portion (final distance fee minus the base fee). */
  distanceFeeMinor: number;
  vehicle: DeliveryVehicle;
  vehicleMultiplierBps: number;
  vehicleAdjustmentMinor: number;
  packageClass: PackageClass;
  packageAdjustmentMinor: number;
  additionalPickupFeeMinor: number;
  demandMultiplierBps: number;
  demandAdjustmentMinor: number;
  waitingFeeMinor: number;
  /** The whole fee the customer pays and the courier's gross pay for the trip. */
  finalDeliveryFeeMinor: number;
};

/**
 * The full delivery-fee pipeline. Applies, in order: the tiered distance fee,
 * the vehicle multiplier (re-rounded), flat package and pickup adjustments, the
 * peak-demand multiplier (re-rounded), then the waiting fee. Matches the spec's
 * worked examples exactly.
 */
export function computeDeliveryFee(input: DeliveryFeeInput): DeliveryFeeBreakdown {
  const vehicle = input.vehicle ?? 'MOTORCYCLE';
  const packageClass = input.packageClass ?? 'SMALL';
  const step = DELIVERY_PRICING.roundToMinor;

  const distanceTotalMinor = distanceDeliveryFeeMinor(input.distanceKm);
  const distanceFeeMinor = Math.max(0, distanceTotalMinor - DELIVERY_PRICING.baseFeeMinor);

  const vehicleMultiplierBps = VEHICLE_MULTIPLIER_BPS[vehicle];
  const afterVehicleMinor = roundUpToMinor(
    Math.round((distanceTotalMinor * vehicleMultiplierBps) / 10_000),
    step,
  );
  const vehicleAdjustmentMinor = afterVehicleMinor - distanceTotalMinor;

  const packageAdjustmentMinor = PACKAGE_ADJUSTMENT_MINOR[packageClass];
  const pickupFeeMinor = additionalPickupFeeMinor(input.merchantCount ?? 1);

  const beforeDemandMinor = afterVehicleMinor + packageAdjustmentMinor + pickupFeeMinor;

  const rawDemandBps =
    input.demandMultiplierBps ?? DEMAND_MULTIPLIER_BPS[input.demandLevel ?? 'NORMAL'];
  const demandMultiplierBps = Math.min(MAX_DEMAND_MULTIPLIER_BPS, Math.max(10_000, rawDemandBps));
  const afterDemandMinor = roundUpToMinor(
    Math.round((beforeDemandMinor * demandMultiplierBps) / 10_000),
    step,
  );
  const demandAdjustmentMinor = afterDemandMinor - beforeDemandMinor;

  const waitFeeMinor = waitingFeeMinor(input.waitingMinutes ?? 0);
  const finalDeliveryFeeMinor = afterDemandMinor + waitFeeMinor;

  return {
    baseFeeMinor: DELIVERY_PRICING.baseFeeMinor,
    distanceFeeMinor,
    vehicle,
    vehicleMultiplierBps,
    vehicleAdjustmentMinor,
    packageClass,
    packageAdjustmentMinor,
    additionalPickupFeeMinor: pickupFeeMinor,
    demandMultiplierBps,
    demandAdjustmentMinor,
    waitingFeeMinor: waitFeeMinor,
    finalDeliveryFeeMinor,
  };
}

/** The cancellation fee for a delivery, by how far the courier has progressed. */
export function cancellationFeeMinor(
  stage: 'BEFORE_COURIER' | 'COURIER_EN_ROUTE' | 'COURIER_AT_PICKUP' | 'COLLECTED',
  deliveryFeeMinor: number,
): number {
  switch (stage) {
    case 'BEFORE_COURIER':
      return 0;
    case 'COURIER_EN_ROUTE':
      return CANCELLATION_FEE.courierEnRouteMinor;
    case 'COURIER_AT_PICKUP':
      return CANCELLATION_FEE.courierAtPickupMinor;
    case 'COLLECTED':
      // Full delivery fee, subject to support review.
      return Math.max(0, deliveryFeeMinor);
  }
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
