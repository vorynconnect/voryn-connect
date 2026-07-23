import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { mapsService } from '../maps/maps.service';
import { deliverySplit } from '../../lib/commission';
import {
  computeDeliveryFee,
  distanceEtaMinutes,
  haversineKm,
  type DeliveryVehicle,
  type PackageClass,
} from '../../lib/pricing';

export const OUT_OF_ZONE_MESSAGE =
  'This location is currently outside the delivery area. Choose pickup or another address.';

export type DeliveryQuoteResult = {
  providerId: string;
  merchantName: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  /** Road distance merchant → drop-off (km). Null when a point is unknown. */
  distanceKm: number | null;
  routeDistanceMeters: number | null;
  estimatedDurationSeconds: number | null;
  /** JMD 500 flat covering the first 3 km. */
  baseFeeMinor: number;
  /** Additional-distance portion on top of the base fee. */
  distanceFeeMinor: number;
  vehicle: DeliveryVehicle;
  vehicleAdjustmentMinor: number;
  packageClass: PackageClass;
  packageAdjustmentMinor: number;
  additionalPickupFeeMinor: number;
  demandMultiplierBps: number;
  demandAdjustmentMinor: number;
  waitingFeeMinor: number;
  /** The whole fee the customer pays — also the courier's gross pay for the trip. */
  deliveryFeeMinor: number;
  courierCommissionBps: number;
  estimatedCourierEarningMinor: number;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  /** True when the drop-off is beyond the extended delivery radius. */
  outOfZone: boolean;
  maxDeliveryKm: number;
};

export type DeliveryQuoteOptions = {
  vehicle?: DeliveryVehicle;
  packageClass?: PackageClass;
  /** Merchants on the order; >1 adds a JMD 250 pickup fee per extra merchant. */
  merchantCount?: number;
  /** Estimated waiting minutes to fold in; usually 0 at quote time. */
  waitingMinutes?: number;
};

type CartMerchant = { restaurantId: string | null; storeId: string | null };

/** Road distance from the maps provider, falling back to straight-line. */
async function roadDistance(
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number },
): Promise<{ distanceKm: number; meters: number; durationSeconds: number }> {
  try {
    const route = await mapsService.calculateRoute(
      { latitude: pickup.lat, longitude: pickup.lng },
      { latitude: dropoff.lat, longitude: dropoff.lng },
    );
    if (route) {
      return {
        distanceKm: Math.round(route.distanceKm * 10) / 10,
        meters: Math.round(route.distanceKm * 1000),
        durationSeconds: route.durationMinutes * 60,
      };
    }
  } catch (err) {
    logger.warn({ err }, 'delivery route lookup failed; using straight-line distance');
  }
  const straightKm = Math.round(haversineKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) * 10) / 10;
  return { distanceKm: straightKm, meters: Math.round(straightKm * 1000), durationSeconds: 0 };
}

/**
 * Prices the delivery leg of a cart: merchant primary branch → drop-off, using
 * the actual road distance and the full fee stack. The courier is paid this fee
 * (less commission) plus tips, so the number is both the customer's fee and the
 * courier's pay estimate.
 */
export async function deliveryQuote(
  cart: CartMerchant,
  dropoff: { lat: number; lng: number } | null,
  opts: DeliveryQuoteOptions = {},
): Promise<DeliveryQuoteResult> {
  let providerId: string;
  let merchantName: string;
  let etaMinMinutes: number;
  let etaMaxMinutes: number;

  if (cart.restaurantId) {
    const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: cart.restaurantId } });
    providerId = restaurant.providerId;
    merchantName = restaurant.name;
    etaMinMinutes = restaurant.minDeliveryMinutes;
    etaMaxMinutes = restaurant.maxDeliveryMinutes;
  } else if (cart.storeId) {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: cart.storeId } });
    providerId = store.providerId;
    merchantName = store.name;
    etaMinMinutes = store.minDeliveryMinutes;
    etaMaxMinutes = store.maxDeliveryMinutes;
  } else {
    throw AppError.badRequest('Cart has no merchant.');
  }

  const branch = await prisma.providerBranch.findFirst({
    where: { providerId, isActive: true },
    orderBy: { isPrimary: 'desc' },
    select: { latitude: true, longitude: true },
  });

  let distanceKm: number | null = null;
  let routeDistanceMeters: number | null = null;
  let estimatedDurationSeconds: number | null = null;
  let pickupLat: number | null = branch?.latitude ?? null;
  let pickupLng: number | null = branch?.longitude ?? null;

  if (branch && dropoff) {
    const road = await roadDistance(
      { lat: branch.latitude, lng: branch.longitude },
      dropoff,
    );
    distanceKm = road.distanceKm;
    routeDistanceMeters = road.meters;
    estimatedDurationSeconds = road.durationSeconds;
    ({ etaMinMinutes, etaMaxMinutes } = distanceEtaMinutes(etaMinMinutes, etaMaxMinutes, distanceKm));
  }

  // A missing point means we cannot route yet: the fee falls back to the flat
  // base (JMD 500), which is also the platform minimum.
  const fee = computeDeliveryFee({
    distanceKm: distanceKm ?? 0,
    vehicle: opts.vehicle,
    packageClass: opts.packageClass,
    merchantCount: opts.merchantCount,
    demandMultiplierBps: env.DELIVERY_PEAK_MULTIPLIER_BPS,
    waitingMinutes: opts.waitingMinutes,
  });

  const maxDeliveryKm = env.DELIVERY_EXTENDED_MAX_KM;
  const outOfZone = distanceKm != null && distanceKm > maxDeliveryKm;

  const split = deliverySplit(fee.finalDeliveryFeeMinor);

  return {
    providerId,
    merchantName,
    pickupLat,
    pickupLng,
    dropoffLat: dropoff?.lat ?? null,
    dropoffLng: dropoff?.lng ?? null,
    distanceKm,
    routeDistanceMeters,
    estimatedDurationSeconds,
    baseFeeMinor: fee.baseFeeMinor,
    distanceFeeMinor: fee.distanceFeeMinor,
    vehicle: fee.vehicle,
    vehicleAdjustmentMinor: fee.vehicleAdjustmentMinor,
    packageClass: fee.packageClass,
    packageAdjustmentMinor: fee.packageAdjustmentMinor,
    additionalPickupFeeMinor: fee.additionalPickupFeeMinor,
    demandMultiplierBps: fee.demandMultiplierBps,
    demandAdjustmentMinor: fee.demandAdjustmentMinor,
    waitingFeeMinor: fee.waitingFeeMinor,
    deliveryFeeMinor: fee.finalDeliveryFeeMinor,
    courierCommissionBps: env.COURIER_COMMISSION_BPS,
    estimatedCourierEarningMinor: split.courierCompensationMinor,
    etaMinMinutes,
    etaMaxMinutes,
    outOfZone,
    maxDeliveryKm,
  };
}

/**
 * Persists an already-computed delivery quote so checkout can lock the fee to a
 * quote id. The customer confirms this exact fee; the app never recomputes it
 * (spec §14). Returns null when there is no drop-off to sign against.
 */
export async function persistDeliveryQuote(
  customerId: string,
  q: DeliveryQuoteResult,
  merchantCount = 1,
) {
  if (q.dropoffLat == null || q.dropoffLng == null) return null;
  const expiresAt = new Date(Date.now() + env.DELIVERY_QUOTE_TTL_MINUTES * 60_000);
  return prisma.deliveryQuote.create({
    data: {
      customerId,
      providerId: q.providerId,
      merchantName: q.merchantName,
      pickupLat: q.pickupLat ?? q.dropoffLat,
      pickupLng: q.pickupLng ?? q.dropoffLng,
      dropoffLat: q.dropoffLat,
      dropoffLng: q.dropoffLng,
      routeDistanceMeters: q.routeDistanceMeters ?? 0,
      estimatedDurationSeconds: q.estimatedDurationSeconds ?? 0,
      distanceKm: q.distanceKm ?? 0,
      vehicle: q.vehicle,
      packageClass: q.packageClass,
      merchantCount,
      baseFeeMinor: q.baseFeeMinor,
      distanceFeeMinor: q.distanceFeeMinor,
      vehicleAdjustmentMinor: q.vehicleAdjustmentMinor,
      packageAdjustmentMinor: q.packageAdjustmentMinor,
      additionalPickupFeeMinor: q.additionalPickupFeeMinor,
      demandMultiplierBps: q.demandMultiplierBps,
      demandAdjustmentMinor: q.demandAdjustmentMinor,
      estimatedWaitingFeeMinor: q.waitingFeeMinor,
      discountMinor: 0,
      finalDeliveryFeeMinor: q.deliveryFeeMinor,
      courierCommissionBps: q.courierCommissionBps,
      estimatedCourierEarningMinor: q.estimatedCourierEarningMinor,
      pricingVersion: env.DELIVERY_PRICING_VERSION,
      expiresAt,
    },
  });
}

/**
 * Validates and burns a signed delivery quote at checkout. The quote must
 * belong to the customer, be unused and unexpired, and match the drop-off the
 * order is going to (a destination change invalidates the locked price).
 */
export async function consumeDeliveryQuote(input: {
  quoteId: string;
  customerId: string;
  providerId: string;
  dropoff: { lat: number; lng: number };
}) {
  const row = await prisma.deliveryQuote.findUnique({ where: { id: input.quoteId } });
  if (!row || row.customerId !== input.customerId) {
    throw AppError.notFound('Delivery quote not found');
  }
  if (row.usedAt) throw AppError.conflict('This delivery quote has already been used.', 'QUOTE_USED');
  if (row.expiresAt.getTime() < Date.now()) {
    throw AppError.badRequest('Your delivery quote expired. Refreshing the price.', 'QUOTE_EXPIRED');
  }
  if (row.providerId !== input.providerId) {
    throw AppError.badRequest('This delivery quote is for a different merchant.', 'QUOTE_MISMATCH');
  }
  // The signed price is only valid for the exact drop-off it was quoted for.
  const sameDropoff =
    Math.abs(row.dropoffLat - input.dropoff.lat) < 1e-5 &&
    Math.abs(row.dropoffLng - input.dropoff.lng) < 1e-5;
  if (!sameDropoff) {
    throw AppError.badRequest('The delivery address changed. Refreshing the price.', 'QUOTE_EXPIRED');
  }

  await prisma.deliveryQuote.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row;
}
