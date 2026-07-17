import { haversineKm } from './pricing';

/**
 * Geofence rules for arrival/completion validation and GPS sanity checks.
 * Radii are deliberately generous: consumer GPS wanders 10–60 m in dense
 * areas, and blocking an honest driver is worse than admitting a lax one.
 * A support override path always exists — but it is logged.
 */
export const GEOFENCE = {
  /** "Arrived at pickup/merchant" must be within this many metres. */
  arrivalRadiusM: 150,
  /** Completion (drop-off/delivery) — looser: kerbs, gates, plazas. */
  completionRadiusM: 300,
  /** Extra allowance on top of every radius for GPS accuracy. */
  accuracyAllowanceM: 60,
  /** Fixes older than this can't verify anything. */
  maxFixAgeMs: 3 * 60 * 1000,
  /** Above this implied speed a location update is physically impossible. */
  impossibleSpeedKph: 220,
  /** Ignore speed spikes over tiny hops — GPS jitter, not teleporting. */
  minAnomalyDistanceM: 500,
} as const;

export type GeoPoint = { latitude: number; longitude: number };

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  return haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
}

export type GeofenceCheck = {
  ok: boolean;
  /** Metres from the target; null when there was no usable fix. */
  distanceM: number | null;
  radiusM: number;
};

/**
 * Is the latest fix close enough to the target? A missing or stale fix passes
 * (`distanceM: null`): we cannot verify anything without GPS, and stranding a
 * driver in a signal shadow is worse than trusting them for one tap.
 */
export function checkGeofence(
  fix: (GeoPoint & { recordedAt?: Date }) | null | undefined,
  target: GeoPoint,
  radiusM: number,
): GeofenceCheck {
  const effectiveRadius = radiusM + GEOFENCE.accuracyAllowanceM;
  if (!fix) return { ok: true, distanceM: null, radiusM: effectiveRadius };
  if (fix.recordedAt && Date.now() - fix.recordedAt.getTime() > GEOFENCE.maxFixAgeMs) {
    return { ok: true, distanceM: null, radiusM: effectiveRadius };
  }
  const distanceM = Math.round(distanceMeters(fix, target));
  return { ok: distanceM <= effectiveRadius, distanceM, radiusM: effectiveRadius };
}

export type SpeedAnomaly = {
  impossible: boolean;
  impliedKph: number | null;
  distanceM: number | null;
};

/**
 * Teleport detector: compares a new fix against the previous one. Flags only
 * clearly impossible jumps (fast AND far) — GPS jitter over short hops or
 * long gaps between fixes never trips it. Anomalies are logged and scored,
 * never auto-punished.
 */
export function detectSpeedAnomaly(
  previous: (GeoPoint & { recordedAt: Date }) | null | undefined,
  next: GeoPoint,
  nextAt: Date = new Date(),
): SpeedAnomaly {
  if (!previous) return { impossible: false, impliedKph: null, distanceM: null };
  const distanceM = distanceMeters(previous, next);
  const dtHours = Math.max((nextAt.getTime() - previous.recordedAt.getTime()) / 3_600_000, 1 / 3600);
  const impliedKph = distanceM / 1000 / dtHours;
  return {
    impossible: impliedKph > GEOFENCE.impossibleSpeedKph && distanceM > GEOFENCE.minAnomalyDistanceM,
    impliedKph: Math.round(impliedKph),
    distanceM: Math.round(distanceM),
  };
}
