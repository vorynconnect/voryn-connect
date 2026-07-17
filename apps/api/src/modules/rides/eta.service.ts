import type { TrackingSubjectType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { haversineKm } from '../../lib/pricing';
import { mapsService } from '../maps/maps.service';

/**
 * Authoritative live ETA: latest vehicle fix → road route → arrival time.
 * The route provider is only re-queried when the vehicle has actually moved,
 * the target changed, or the last calculation aged out — GPS pings alone
 * never trigger router calls. Consumers get freshness metadata so the UI can
 * say "Updating ETA…" instead of presenting stale numbers as current.
 */

export type LiveEta = {
  etaSeconds: number;
  etaMinutes: number;
  distanceMeters: number;
  /** route = road geometry from the provider; approximate = straight-line fallback. */
  source: 'route' | 'approximate';
  calculatedAt: string;
  driverLocationAt: string;
  /** True when the vehicle fix itself is too old to trust. */
  stale: boolean;
};

const STALE_FIX_SECONDS = 60;
const RECALC_MOVE_METERS = 120;
const RECALC_AGE_SECONDS = 30;
const CITY_KM_PER_MINUTE = 0.45;
const ROAD_WINDING_FACTOR = 1.3;

type Snapshot = {
  at: number;
  from: { lat: number; lng: number };
  target: { lat: number; lng: number };
  etaSeconds: number;
  distanceMeters: number;
  source: 'route' | 'approximate';
};

const snapshots = new Map<string, Snapshot>();

/** Tests need deterministic starts. */
export function clearEtaSnapshotsForTesting() {
  snapshots.clear();
}

export async function liveEta(
  subjectType: TrackingSubjectType,
  subjectId: string,
  target: { latitude: number; longitude: number },
): Promise<LiveEta | null> {
  const fix = await prisma.liveLocation.findFirst({
    where: { subjectType, subjectId },
    orderBy: { recordedAt: 'desc' },
  });
  if (!fix) return null;

  const stale = Date.now() - fix.recordedAt.getTime() > STALE_FIX_SECONDS * 1000;
  const key = `${subjectType}:${subjectId}`;
  const cached = snapshots.get(key);
  const movedMeters = cached
    ? haversineKm(cached.from.lat, cached.from.lng, fix.latitude, fix.longitude) * 1000
    : Number.POSITIVE_INFINITY;
  const targetMovedMeters = cached
    ? haversineKm(cached.target.lat, cached.target.lng, target.latitude, target.longitude) * 1000
    : Number.POSITIVE_INFINITY;
  const aged = cached ? Date.now() - cached.at > RECALC_AGE_SECONDS * 1000 : true;

  let snapshot = cached;
  if (!cached || aged || movedMeters > RECALC_MOVE_METERS || targetMovedMeters > 30) {
    const route = await mapsService.calculateRoute(
      { latitude: fix.latitude, longitude: fix.longitude },
      target,
    );
    if (route) {
      snapshot = {
        at: Date.now(),
        from: { lat: fix.latitude, lng: fix.longitude },
        target: { lat: target.latitude, lng: target.longitude },
        etaSeconds: Math.max(60, route.durationMinutes * 60),
        distanceMeters: Math.round(route.distanceKm * 1000),
        source: 'route',
      };
    } else {
      // Router unavailable — approximate honestly and label it as such.
      const km =
        haversineKm(fix.latitude, fix.longitude, target.latitude, target.longitude) * ROAD_WINDING_FACTOR;
      snapshot = {
        at: Date.now(),
        from: { lat: fix.latitude, lng: fix.longitude },
        target: { lat: target.latitude, lng: target.longitude },
        etaSeconds: Math.max(60, Math.round((km / CITY_KM_PER_MINUTE) * 60)),
        distanceMeters: Math.round(km * 1000),
        source: 'approximate',
      };
    }
    snapshots.set(key, snapshot);
  }

  return {
    etaSeconds: snapshot!.etaSeconds,
    etaMinutes: Math.max(1, Math.ceil(snapshot!.etaSeconds / 60)),
    distanceMeters: snapshot!.distanceMeters,
    source: snapshot!.source,
    calculatedAt: new Date(snapshot!.at).toISOString(),
    driverLocationAt: fix.recordedAt.toISOString(),
    stale,
  };
}
