import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { haversineKm, type LatLng } from './geo';

/**
 * Road-following route geometry for the trip map. react-native-maps only
 * draws straight segments, so a real Uber-style route needs road geometry
 * from a routing service. Requests go through the Voryn backend (/v1/maps/route)
 * so the provider, its keys and its caching live server-side; if the backend
 * is unreachable we fall back to the public OSRM demo, and always fall back
 * to a straight line so the map still works offline.
 */
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

export type RouteInfo = {
  coords: LatLng[];
  /** Real driving distance/duration from the router; null on straight-line fallback. */
  distanceKm: number | null;
  durationMinutes: number | null;
};

const cache = new Map<string, RouteInfo>();
const key = (a: LatLng, b: LatLng) =>
  `${a.latitude.toFixed(4)},${a.longitude.toFixed(4)};${b.latitude.toFixed(4)},${b.longitude.toFixed(4)}`;

export async function fetchRouteInfo(from: LatLng, to: LatLng): Promise<RouteInfo> {
  const cacheKey = key(from, to);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const straight: RouteInfo = { coords: [from, to], distanceKm: null, durationMinutes: null };

  // Preferred path: the backend map service (central caching + provider keys).
  try {
    const data = await api<{
      route: { coordinates: LatLng[]; distanceKm: number; durationMinutes: number } | null;
    }>('/v1/maps/route', { method: 'POST', body: { from, to } });
    if (data.route && data.route.coordinates.length >= 2) {
      const info: RouteInfo = {
        coords: data.route.coordinates,
        distanceKm: data.route.distanceKm,
        durationMinutes: data.route.durationMinutes,
      };
      cache.set(cacheKey, info);
      return info;
    }
  } catch {
    // backend unreachable or unauthenticated — try the router directly
  }

  try {
    const url = `${OSRM_BASE}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return straight;
    const data = (await res.json()) as {
      code: string;
      routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }>;
    };
    const route = data.routes?.[0];
    const coords = route?.geometry.coordinates;
    if (data.code !== 'Ok' || !route || !coords || coords.length < 2) return straight;
    const info: RouteInfo = {
      coords: coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMinutes: Math.max(1, Math.round(route.duration / 60)),
    };
    cache.set(cacheKey, info);
    return info;
  } catch {
    return straight; // aborted, offline, or rate-limited — draw the direct line
  }
}

export async function fetchRoute(from: LatLng, to: LatLng): Promise<LatLng[]> {
  return (await fetchRouteInfo(from, to)).coords;
}

/**
 * Returns road geometry between two points, re-fetching when the destination
 * changes or the origin drifts past `minMoveMeters` (so a moving vehicle
 * re-snaps its remaining route without hammering the routing service).
 */
export function useRoute(
  from: LatLng | null | undefined,
  to: LatLng | null | undefined,
  opts: { minMoveMeters?: number } = {},
): LatLng[] {
  const minMove = opts.minMoveMeters ?? 0;
  const [line, setLine] = useState<LatLng[]>(() => (from && to ? [from, to] : []));
  const lastFromRef = useRef<LatLng | null>(null);

  const toLat = to?.latitude;
  const toLng = to?.longitude;
  const fromLat = from?.latitude;
  const fromLng = from?.longitude;

  useEffect(() => {
    if (fromLat == null || fromLng == null || toLat == null || toLng == null) return;
    const origin = { latitude: fromLat, longitude: fromLng };
    const dest = { latitude: toLat, longitude: toLng };

    if (lastFromRef.current && minMove > 0 && haversineKm(lastFromRef.current, origin) * 1000 < minMove) {
      return; // origin hasn't moved enough to bother re-routing
    }
    lastFromRef.current = origin;

    let cancelled = false;
    void fetchRoute(origin, dest).then((route) => {
      if (!cancelled) setLine(route);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLat, fromLng, toLat, toLng, minMove]);

  return line;
}

/** Full route info (geometry + real driving distance/duration) as a hook. */
export function useRouteInfo(from: LatLng | null | undefined, to: LatLng | null | undefined): RouteInfo | null {
  const [info, setInfo] = useState<RouteInfo | null>(null);

  const fromLat = from?.latitude;
  const fromLng = from?.longitude;
  const toLat = to?.latitude;
  const toLng = to?.longitude;

  useEffect(() => {
    if (fromLat == null || fromLng == null || toLat == null || toLng == null) return;
    let cancelled = false;
    void fetchRouteInfo({ latitude: fromLat, longitude: fromLng }, { latitude: toLat, longitude: toLng }).then(
      (result) => {
        if (!cancelled) setInfo(result);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fromLat, fromLng, toLat, toLng]);

  return info;
}
