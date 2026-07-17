import { api } from '@/lib/api';
import type { LatLng } from './geo';

/**
 * Place search + reverse geocoding via the Voryn backend (/v1/maps/*), which
 * proxies the configured map provider so API keys and usage limits stay
 * server-side. If the backend is unreachable the app falls back to calling
 * the public OSM services directly, so search keeps working in dev/offline.
 *
 * Callers must debounce — every request costs provider quota.
 */
const NOMINATIM = 'https://nominatim.openstreetmap.org';
/** left,top,right,bottom around the Kingston/Portmore metro area. */
const METRO_VIEWBOX = '-77.05,18.10,-76.60,17.85';

export type Place = {
  /** Short display name, e.g. "Portmore Mall". */
  name: string;
  /** Fuller context line, e.g. "Portmore, Saint Catherine". */
  detail: string;
  point: LatLng;
};

type NominatimResult = {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
};

const searchCache = new Map<string, Place[]>();

function toPlace(r: NominatimResult): Place {
  const parts = r.display_name.split(', ');
  const name = r.name && r.name.length > 0 ? r.name : parts[0] ?? r.display_name;
  const detail = parts.slice(1, 4).join(', ');
  return {
    name,
    detail,
    point: { latitude: Number(r.lat), longitude: Number(r.lon) },
  };
}

async function searchPlacesDirect(q: string): Promise<Place[]> {
  try {
    const url =
      `${NOMINATIM}/search?format=jsonv2&limit=6&countrycodes=jm&addressdetails=0` +
      `&viewbox=${METRO_VIEWBOX}&q=${encodeURIComponent(q)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = (await res.json()) as NominatimResult[];
    return data.map(toPlace).filter((p) => Number.isFinite(p.point.latitude));
  } catch {
    return []; // offline or rate-limited — the caller shows "no results"
  }
}

export async function searchPlaces(query: string, bias?: LatLng): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const cacheKey = q.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  let places: Place[] = [];
  try {
    const params = new URLSearchParams({ q });
    if (bias) {
      params.set('lat', String(bias.latitude));
      params.set('lng', String(bias.longitude));
    }
    const data = await api<{
      suggestions: Array<{ name: string; detail: string; latitude: number; longitude: number }>;
    }>(`/v1/maps/suggestions?${params.toString()}`);
    places = data.suggestions.map((s) => ({
      name: s.name,
      detail: s.detail,
      point: { latitude: s.latitude, longitude: s.longitude },
    }));
  } catch {
    places = await searchPlacesDirect(q);
  }

  if (places.length > 0) searchCache.set(cacheKey, places);
  return places;
}

/** Human-readable short label for a coordinate ("Braeton Parkway, Portmore"). */
export async function reverseLabel(point: LatLng): Promise<string | null> {
  try {
    const data = await api<{ address: { formattedAddress: string } | null }>('/v1/maps/reverse-geocode', {
      method: 'POST',
      body: { latitude: point.latitude, longitude: point.longitude },
    });
    if (data.address?.formattedAddress) return data.address.formattedAddress;
  } catch {
    // fall through to the direct lookup
  }

  try {
    const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${point.latitude}&lon=${point.longitude}&zoom=17`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimResult & { address?: Record<string, string> };
    const a = data.address ?? {};
    const road = a.road ?? a.neighbourhood ?? a.suburb ?? data.name;
    const area = a.suburb ?? a.town ?? a.city ?? a.county;
    if (!road) return null;
    return area && area !== road ? `${road}, ${area}` : road;
  } catch {
    return null;
  }
}
