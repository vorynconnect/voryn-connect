import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { distanceDeliveryFeeMinor, distanceEtaMinutes, haversineKm } from '../../lib/pricing';

export const OUT_OF_ZONE_MESSAGE =
  'This location is currently outside the delivery area. Choose pickup or another address.';

export type DeliveryQuote = {
  providerId: string;
  merchantName: string;
  /** The merchant's configured flat fee (covers the included distance). */
  baseFeeMinor: number;
  /** Distance-priced fee the customer pays — also the courier's pay for the trip. */
  deliveryFeeMinor: number;
  /** Merchant branch → drop-off. Null when either point is unknown (flat fee applies). */
  distanceKm: number | null;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  /** True when the drop-off is beyond the platform delivery radius. */
  outOfZone: boolean;
  maxDeliveryKm: number;
};

/**
 * Prices the delivery leg of a cart: merchant primary branch → drop-off.
 * The courier is paid this fee in full (plus tip), so the same number is
 * both the customer's fee and the courier's pay estimate.
 */
export async function deliveryQuote(
  cart: { restaurantId: string | null; storeId: string | null },
  dropoff: { lat: number; lng: number } | null,
): Promise<DeliveryQuote> {
  let providerId: string;
  let merchantName: string;
  let baseFeeMinor: number;
  let etaMinMinutes: number;
  let etaMaxMinutes: number;

  if (cart.restaurantId) {
    const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: cart.restaurantId } });
    providerId = restaurant.providerId;
    merchantName = restaurant.name;
    baseFeeMinor = restaurant.deliveryFeeMinor;
    etaMinMinutes = restaurant.minDeliveryMinutes;
    etaMaxMinutes = restaurant.maxDeliveryMinutes;
  } else if (cart.storeId) {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: cart.storeId } });
    providerId = store.providerId;
    merchantName = store.name;
    baseFeeMinor = store.deliveryFeeMinor;
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
  let deliveryFeeMinor = baseFeeMinor;
  if (branch && dropoff) {
    distanceKm = Math.round(haversineKm(branch.latitude, branch.longitude, dropoff.lat, dropoff.lng) * 10) / 10;
    deliveryFeeMinor = distanceDeliveryFeeMinor(baseFeeMinor, distanceKm);
    ({ etaMinMinutes, etaMaxMinutes } = distanceEtaMinutes(etaMinMinutes, etaMaxMinutes, distanceKm));
  }

  const maxDeliveryKm = env.DELIVERY_MAX_KM;
  const outOfZone = distanceKm != null && distanceKm > maxDeliveryKm;

  return {
    providerId,
    merchantName,
    baseFeeMinor,
    deliveryFeeMinor,
    distanceKm,
    etaMinMinutes,
    etaMaxMinutes,
    outOfZone,
    maxDeliveryKm,
  };
}
