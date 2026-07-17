import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import {
  createMapProvider,
  type AddressResult,
  type Coordinates,
  type MapProvider,
  type PlaceSuggestion,
  type RouteResult,
} from './maps.provider';

/**
 * Central map service: every geocoding/routing call in the backend goes
 * through here so caching, usage accounting and provider swaps happen in one
 * place. Components must not call provider APIs directly — that is how map
 * bills explode.
 */

type CacheEntry<T> = { value: T; expiresAt: number };

class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 2000,
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      // Drop the oldest entry — insertion order is good enough here.
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

/** ~11 m grid — close enough that one reverse-geocode serves the whole cell. */
const coordKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

/** Daily provider-call counters; logged so spikes are visible in ops. */
const usage: Record<string, { day: string; calls: number; cacheHits: number }> = {};

function recordUsage(operation: string, cacheHit: boolean) {
  const day = new Date().toISOString().slice(0, 10);
  const entry = usage[operation] ?? { day, calls: 0, cacheHits: 0 };
  if (entry.day !== day) {
    entry.day = day;
    entry.calls = 0;
    entry.cacheHits = 0;
  }
  if (cacheHit) entry.cacheHits += 1;
  else {
    entry.calls += 1;
    if (entry.calls === env.MAPS_DAILY_CALL_WARNING) {
      logger.warn({ operation, calls: entry.calls }, 'map provider usage crossed the daily warning threshold');
    }
  }
  usage[operation] = entry;
}

export function mapUsageSnapshot() {
  return Object.fromEntries(Object.entries(usage).map(([op, u]) => [op, { ...u }]));
}

class MapsService {
  private provider: MapProvider;
  private readonly suggestionCache = new TtlCache<PlaceSuggestion[]>(10 * 60 * 1000);
  private readonly reverseCache = new TtlCache<AddressResult | null>(24 * 60 * 60 * 1000);
  private readonly routeCache = new TtlCache<RouteResult | null>(10 * 60 * 1000);

  constructor() {
    this.provider = createMapProvider();
  }

  get providerName(): string {
    return this.provider.name;
  }

  /** Tests swap in a fake provider; production never calls this. */
  setProviderForTesting(provider: MapProvider): void {
    this.provider = provider;
    this.suggestionCache.clear();
    this.reverseCache.clear();
    this.routeCache.clear();
  }

  async getPlaceSuggestions(query: string, bias?: Coordinates): Promise<PlaceSuggestion[]> {
    const key = `${query.trim().toLowerCase()}|${bias ? coordKey(bias.latitude, bias.longitude) : ''}`;
    const cached = this.suggestionCache.get(key);
    if (cached) {
      recordUsage('suggestions', true);
      return cached;
    }
    recordUsage('suggestions', false);
    const results = await this.provider.getPlaceSuggestions(query, bias);
    if (results.length > 0) this.suggestionCache.set(key, results);
    return results;
  }

  async reverseGeocode(latitude: number, longitude: number): Promise<AddressResult | null> {
    const key = coordKey(latitude, longitude);
    const cached = this.reverseCache.get(key);
    if (cached !== undefined) {
      recordUsage('reverseGeocode', true);
      return cached;
    }
    recordUsage('reverseGeocode', false);
    const result = await this.provider.reverseGeocode(latitude, longitude);
    if (result) this.reverseCache.set(key, result);
    return result;
  }

  async calculateRoute(from: Coordinates, to: Coordinates): Promise<RouteResult | null> {
    const key = `${coordKey(from.latitude, from.longitude)};${coordKey(to.latitude, to.longitude)}`;
    const cached = this.routeCache.get(key);
    if (cached !== undefined) {
      recordUsage('route', true);
      return cached;
    }
    recordUsage('route', false);
    const result = await this.provider.calculateRoute(from, to);
    if (result) this.routeCache.set(key, result);
    return result;
  }
}

export const mapsService = new MapsService();
