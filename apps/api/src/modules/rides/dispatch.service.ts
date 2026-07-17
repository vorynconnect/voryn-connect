import { createHash } from 'node:crypto';
import { RideCategory, RideStatus, type RideRequest } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { haversineKm } from '../../lib/pricing';
import { recordTrackingEvent } from '../tracking/tracking.service';

/**
 * Driver dispatch: real eligibility, an expanding search radius derived from
 * configurable stages, and honest supply data for the customer app.
 *
 * The search "session" is computed from the ride request's creation time and
 * the stage configuration rather than a background worker: every read
 * evaluates the current stage, and the request lazily flips to
 * NO_DRIVER_AVAILABLE once the search window closes. With Portmore-scale
 * supply this stays exact and needs no timers; a queue/worker can replace it
 * without changing any consumer.
 *
 * Geospatial filtering is an indexed candidate fetch + Haversine cut. That is
 * the documented fallback for fleets this size — swap in PostGIS/Redis GEO
 * behind `eligibleDrivers` when the fleet outgrows it.
 */

const RIDE_ONGOING: RideStatus[] = [
  RideStatus.DRIVER_ASSIGNED,
  RideStatus.DRIVER_ARRIVING,
  RideStatus.ARRIVED,
  RideStatus.IN_PROGRESS,
];

/** ~27 km/h door-to-door city speed; roads wind ~1.3× the straight line. */
const CITY_KM_PER_MINUTE = 0.45;
const ROAD_WINDING_FACTOR = 1.3;

export type EligibleDriver = {
  driverId: string;
  userId: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  category: RideCategory;
  ratingAvg: number;
  distanceKm: number;
  lastLocationAt: Date;
};

export async function eligibleDrivers(opts: {
  lat: number;
  lng: number;
  radiusKm: number;
  category?: RideCategory;
  freshSeconds?: number;
  limit?: number;
}): Promise<EligibleDriver[]> {
  const freshAfter = new Date(
    Date.now() - (opts.freshSeconds ?? env.DRIVER_PRESENCE_DISPATCH_FRESH_SECONDS) * 1000,
  );
  const candidates = await prisma.driverProfile.findMany({
    where: {
      isOnline: true,
      ...(opts.category ? { rideCategory: opts.category } : {}),
      lastLocationAt: { gte: freshAfter },
      lastLat: { not: null },
      lastLng: { not: null },
      // A driver already on an ongoing trip is not available for dispatch.
      rideTrips: { none: { status: { in: RIDE_ONGOING } } },
    },
    select: {
      id: true,
      userId: true,
      lastLat: true,
      lastLng: true,
      lastHeading: true,
      rideCategory: true,
      ratingAvg: true,
      lastLocationAt: true,
    },
    take: 200,
  });

  return candidates
    .map((d) => ({
      driverId: d.id,
      userId: d.userId,
      latitude: d.lastLat!,
      longitude: d.lastLng!,
      heading: d.lastHeading,
      category: d.rideCategory,
      ratingAvg: d.ratingAvg,
      distanceKm: haversineKm(opts.lat, opts.lng, d.lastLat!, d.lastLng!),
      lastLocationAt: d.lastLocationAt!,
    }))
    .filter((d) => d.distanceKm <= opts.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || b.ratingAvg - a.ratingAvg)
    .slice(0, opts.limit ?? 25);
}

const stages = () => env.RIDE_SEARCH_RADII_KM;
export const maxSearchRadiusKm = () => stages()[stages().length - 1]!;

/** Radius stage for a search that started at `startedAt`, evaluated lazily. */
export function currentSearchStage(startedAt: Date, now = new Date()) {
  const elapsedSeconds = Math.max(0, (now.getTime() - startedAt.getTime()) / 1000);
  const stage = Math.min(Math.floor(elapsedSeconds / env.RIDE_SEARCH_STAGE_SECONDS), stages().length - 1);
  return {
    stage,
    stageCount: stages().length,
    radiusKm: stages()[stage]!,
    expired: elapsedSeconds > env.RIDE_SEARCH_MAX_SECONDS,
    expiresAt: new Date(startedAt.getTime() + env.RIDE_SEARCH_MAX_SECONDS * 1000),
  };
}

export type RideSearchStatus = {
  status: 'SEARCHING' | 'DRIVER_ASSIGNED' | 'NO_DRIVER_FOUND' | 'CANCELLED' | 'ENDED';
  currentRadiusKm: number;
  stage: number;
  stageCount: number;
  maxRadiusKm: number;
  eligibleDriverCount: number;
  searchStartedAt: string;
  searchExpiresAt: string;
};

/**
 * Live search state for one ride request. Reading it advances the lazy
 * session: a request whose window has closed flips to NO_DRIVER_AVAILABLE
 * right here, so pollers always see an honest terminal state.
 */
export async function rideSearchStatus(request: RideRequest): Promise<RideSearchStatus> {
  const { stage, stageCount, radiusKm, expired, expiresAt } = currentSearchStage(request.createdAt);

  let status: RideSearchStatus['status'];
  if (request.status === RideStatus.SEARCHING) status = 'SEARCHING';
  else if (request.status === RideStatus.NO_DRIVER_AVAILABLE) status = 'NO_DRIVER_FOUND';
  else if (request.status === RideStatus.CANCELLED_BY_CUSTOMER) status = 'CANCELLED';
  else if (
    request.status === RideStatus.DRIVER_ASSIGNED ||
    request.status === RideStatus.DRIVER_ARRIVING ||
    request.status === RideStatus.ARRIVED ||
    request.status === RideStatus.IN_PROGRESS
  )
    status = 'DRIVER_ASSIGNED';
  else status = 'ENDED';

  if (status === 'SEARCHING' && expired) {
    // Only flip if it is still SEARCHING — never clobber a concurrent accept.
    const flipped = await prisma.rideRequest.updateMany({
      where: { id: request.id, status: RideStatus.SEARCHING },
      data: { status: RideStatus.NO_DRIVER_AVAILABLE },
    });
    if (flipped.count > 0) {
      status = 'NO_DRIVER_FOUND';
      await recordTrackingEvent({
        subjectType: 'RIDE',
        subjectId: request.id,
        status: RideStatus.NO_DRIVER_AVAILABLE,
        label: 'No drivers available right now',
      });
    }
  }

  const eligible =
    status === 'SEARCHING'
      ? await eligibleDrivers({
          lat: request.pickupLat,
          lng: request.pickupLng,
          radiusKm,
          category: request.category,
        })
      : [];

  return {
    status,
    currentRadiusKm: radiusKm,
    stage,
    stageCount,
    maxRadiusKm: maxSearchRadiusKm(),
    eligibleDriverCount: eligible.length,
    searchStartedAt: request.createdAt.toISOString(),
    searchExpiresAt: expiresAt.toISOString(),
  };
}

/**
 * Honest pickup ETA per category from the nearest eligible driver's real
 * position (straight line × road winding at city speed — a road-route call
 * per category per poll would be wasteful before a driver is even assigned).
 * Null means no eligible driver of that category is nearby — the UI must say
 * so rather than invent a number.
 */
export async function pickupEtaByCategory(pickup: { lat: number; lng: number }) {
  const drivers = await eligibleDrivers({
    lat: pickup.lat,
    lng: pickup.lng,
    radiusKm: maxSearchRadiusKm(),
  });
  const result: Partial<Record<RideCategory, number | null>> = {};
  for (const category of Object.values(RideCategory)) {
    const nearest = drivers.find((d) => d.category === category);
    result[category] = nearest
      ? Math.max(1, Math.round((nearest.distanceKm * ROAD_WINDING_FACTOR) / CITY_KM_PER_MINUTE))
      : null;
  }
  return result;
}

/**
 * Anonymized nearby-driver markers for customer maps. Positions are offset
 * deterministically (~±90 m, seeded by driver id) so markers stay stable
 * between polls without exposing exact driver locations pre-assignment; no
 * identity leaves the backend.
 */
export async function nearbyDriverMarkers(opts: { lat: number; lng: number; category?: RideCategory }) {
  const drivers = await eligibleDrivers({
    lat: opts.lat,
    lng: opts.lng,
    radiusKm: maxSearchRadiusKm(),
    category: opts.category,
    freshSeconds: env.DRIVER_PRESENCE_MARKER_FRESH_SECONDS,
  });
  return drivers.map((d) => {
    const digest = createHash('sha1').update(`voryn-marker:${d.driverId}`).digest();
    const jitter = (byte: number) => ((byte / 255) * 2 - 1) * 0.0008; // ±~90 m
    return {
      key: digest.toString('hex').slice(0, 12),
      latitude: d.latitude + jitter(digest[0]!),
      longitude: d.longitude + jitter(digest[1]!),
      heading: d.heading ?? (digest[2]! / 255) * 360,
      category: d.category,
    };
  });
}
