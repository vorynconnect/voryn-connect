import { env } from '../../config/env';
import { AppError } from '../../lib/errors';

/**
 * Map-provider abstraction. Voryn is not tied to one vendor: geocoding and
 * routing go through this interface, and the concrete provider is chosen by
 * environment configuration. Swapping to Google/Mapbox/HERE means adding one
 * class here — routes, quotes, mobile clients and dashboards are unaffected.
 *
 * Provider base URLs (and later, keys) live in env only. Nothing here is ever
 * bundled into the mobile app; clients call our /v1/maps endpoints.
 */

export type Coordinates = { latitude: number; longitude: number };

export type PlaceSuggestion = {
  /** Short display name, e.g. "Portmore Mall". */
  name: string;
  /** Fuller context line, e.g. "Portmore, Saint Catherine". */
  detail: string;
  latitude: number;
  longitude: number;
  /** Provider-scoped id when the vendor supplies one. */
  placeId?: string;
};

export type AddressResult = {
  formattedAddress: string;
  street?: string;
  community?: string;
  city?: string;
  parish?: string;
  country?: string;
  latitude: number;
  longitude: number;
};

export type RouteResult = {
  coordinates: Coordinates[];
  distanceKm: number;
  durationMinutes: number;
};

export interface MapProvider {
  readonly name: string;
  getPlaceSuggestions(query: string, bias?: Coordinates): Promise<PlaceSuggestion[]>;
  reverseGeocode(latitude: number, longitude: number): Promise<AddressResult | null>;
  calculateRoute(from: Coordinates, to: Coordinates): Promise<RouteResult | null>;
}

export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    // (0,0) is the Atlantic null island — always a bug, never a real user.
    !(latitude === 0 && longitude === 0)
  );
}

export function assertValidCoordinate(latitude: number, longitude: number): void {
  if (!isValidCoordinate(latitude, longitude)) {
    throw AppError.badRequest('Invalid coordinates.', 'INVALID_COORDINATES');
  }
}

const FETCH_TIMEOUT_MS = 7000;

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'VorynConnect/1.0' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // provider down, rate-limited, or timed out — callers degrade gracefully
  } finally {
    clearTimeout(timeout);
  }
}

type NominatimResult = {
  place_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: Record<string, string>;
};

/** left,top,right,bottom around the Kingston/Portmore metro area. */
const METRO_VIEWBOX = '-77.05,18.10,-76.60,17.85';

/**
 * OpenStreetMap-compatible provider: Nominatim geocoding + OSRM routing.
 * Works against the public demo servers in dev and any self-hosted or keyed
 * OSM-compatible endpoints in production via MAPS_GEOCODER_URL / MAPS_ROUTER_URL.
 */
class OsmMapProvider implements MapProvider {
  readonly name = 'osm';

  constructor(
    private readonly geocoderBase: string,
    private readonly routerBase: string,
    private readonly geocoderKey = '',
    private readonly routerKey = '',
  ) {}

  /** Append `&key=` for keyed OSM-compatible providers (LocationIQ, Geoapify). */
  private withKey(url: string, key: string): string {
    if (!key) return url;
    return url + (url.includes('?') ? '&' : '?') + `key=${encodeURIComponent(key)}`;
  }

  async getPlaceSuggestions(query: string, bias?: Coordinates): Promise<PlaceSuggestion[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    // Bias toward the caller's area when known, else the Portmore/Kingston metro.
    const viewbox = bias
      ? `${bias.longitude - 0.25},${bias.latitude + 0.15},${bias.longitude + 0.25},${bias.latitude - 0.15}`
      : METRO_VIEWBOX;
    // format=json (not jsonv2): LocationIQ silently falls back to XML on
    // formats it doesn't know, and plain json parses identically everywhere.
    const url =
      `${this.geocoderBase}/search?format=json&limit=6&countrycodes=jm&addressdetails=0` +
      `&viewbox=${viewbox}&q=${encodeURIComponent(q)}`;
    const data = await fetchJson<NominatimResult[]>(this.withKey(url, this.geocoderKey));
    if (!data) return [];
    return data
      .map((r) => {
        const parts = r.display_name.split(', ');
        return {
          name: r.name && r.name.length > 0 ? r.name : (parts[0] ?? r.display_name),
          detail: parts.slice(1, 4).join(', '),
          latitude: Number(r.lat),
          longitude: Number(r.lon),
          placeId: r.place_id != null ? String(r.place_id) : undefined,
        };
      })
      .filter((p) => isValidCoordinate(p.latitude, p.longitude));
  }

  async reverseGeocode(latitude: number, longitude: number): Promise<AddressResult | null> {
    const url = `${this.geocoderBase}/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=17&addressdetails=1`;
    const data = await fetchJson<NominatimResult>(this.withKey(url, this.geocoderKey));
    if (!data || !data.display_name) return null;
    const a = data.address ?? {};
    const street = a.road ?? a.neighbourhood ?? a.suburb ?? data.name;
    const community = a.suburb ?? a.neighbourhood;
    const city = a.town ?? a.city ?? a.village;
    const shortParts = [street, city ?? a.county].filter((v, i, arr) => v && arr.indexOf(v) === i);
    return {
      formattedAddress: shortParts.length > 0 ? shortParts.join(', ') : data.display_name,
      street,
      community,
      city,
      parish: a.county ?? a.state,
      country: a.country_code?.toUpperCase() ?? 'JM',
      latitude,
      longitude,
    };
  }

  async calculateRoute(from: Coordinates, to: Coordinates): Promise<RouteResult | null> {
    // OSRM serves routes at /route/v1/driving; LocationIQ's OSRM-compatible
    // directions API lives at /directions/driving on the same base URL.
    const routePath = this.routerBase.includes('locationiq') ? 'directions/driving' : 'route/v1/driving';
    const url =
      `${this.routerBase}/${routePath}/` +
      `${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
      `?overview=full&geometries=geojson`;
    const data = await fetchJson<{
      code: string;
      routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }>;
    }>(this.withKey(url, this.routerKey));
    const route = data?.routes?.[0];
    if (data?.code !== 'Ok' || !route || route.geometry.coordinates.length < 2) return null;
    return {
      coordinates: route.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMinutes: Math.max(1, Math.round(route.duration / 60)),
    };
  }
}

export function createMapProvider(): MapProvider {
  return new OsmMapProvider(
    env.MAPS_GEOCODER_URL,
    env.MAPS_ROUTER_URL,
    env.MAPS_GEOCODER_KEY,
    env.MAPS_ROUTER_KEY,
  );
}
