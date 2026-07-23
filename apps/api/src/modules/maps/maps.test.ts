/**
 * Map platform tests — provider abstraction + caching, /v1/maps endpoints,
 * geofence and spoof-detection rules, server-authoritative ride quotes, and
 * delivery-zone enforcement. Runs against the local dev database with
 * isolated fixtures; the map provider itself is faked (no network).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma';
import { createApp } from '../../app';
import { env } from '../../config/env';
import { GEOFENCE, checkGeofence, detectSpeedAnomaly } from '../../lib/geofence';
import { deliveryQuote } from '../orders/delivery-quote';
import { mapsService } from './maps.service';
import type { MapProvider } from './maps.provider';

const app = createApp();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPass1!';

const PICKUP = { lat: 17.9583, lng: -76.8822 };
const DROPOFF = { lat: 17.99, lng: -76.85 };

/** Deterministic in-memory provider so tests hit no external service. */
function makeFakeProvider() {
  const calls = { suggestions: 0, reverse: 0, route: 0 };
  const provider: MapProvider = {
    name: 'fake',
    async getPlaceSuggestions(query) {
      calls.suggestions += 1;
      return [
        { name: `${query} Mall`, detail: 'Portmore, St. Catherine', latitude: 17.96, longitude: -76.88 },
        { name: `${query} Plaza`, detail: 'Kingston', latitude: 17.99, longitude: -76.79 },
      ];
    },
    async reverseGeocode(latitude, longitude) {
      calls.reverse += 1;
      return { formattedAddress: 'Braeton Parkway, Portmore', street: 'Braeton Parkway', latitude, longitude };
    },
    async calculateRoute(from, to) {
      calls.route += 1;
      // A road distance is longer than the straight line: ~1.3× the haversine,
      // rounded to 0.1 km. For the PICKUP→DROPOFF pair this yields 6.4 km, the
      // value the ride-quote tests below pin down.
      const R = 6371;
      const rad = (x: number) => (x * Math.PI) / 180;
      const dLat = rad(to.latitude - from.latitude);
      const dLng = rad(to.longitude - from.longitude);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLng / 2) ** 2;
      const straightKm = 2 * R * Math.asin(Math.sqrt(h));
      const distanceKm = Math.round(straightKm * 1.3 * 10) / 10;
      return {
        coordinates: [
          from,
          { latitude: (from.latitude + to.latitude) / 2, longitude: (from.longitude + to.longitude) / 2 },
          to,
        ],
        distanceKm,
        durationMinutes: Math.max(1, Math.round(distanceKm * 2.2)),
      };
    },
  };
  return { provider, calls };
}

const fake = makeFakeProvider();

let userId: string;
let otherId: string;
let token: string;
let otherToken: string;
let providerId: string;
let restaurantId: string;

beforeAll(async () => {
  mapsService.setProviderForTesting(fake.provider);

  const mkUser = async (tag: string, digits: string) =>
    prisma.user.create({
      data: {
        fullName: `Maps ${tag}`,
        email: `maps-${tag}-${stamp}@test.voryn.dev`,
        phone: `+1876${digits}${stamp.slice(0, 5)}`,
        passwordHash: await argon2.hash(PASSWORD),
        role: 'CUSTOMER',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        wallet: { create: {} },
      },
    });
  const user = await mkUser('rider', '33');
  const other = await mkUser('other', '44');
  userId = user.id;
  otherId = other.id;

  const login = async (email: string) =>
    (await request(app).post('/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body
      .accessToken as string;
  token = await login(user.email!);
  otherToken = await login(other.email!);

  const provider = await prisma.provider.create({
    data: {
      slug: `maps-test-${stamp}`,
      name: 'Maps Test Kitchen',
      categories: ['RESTAURANT'],
      status: 'ACTIVE',
      branches: {
        create: {
          name: 'Main',
          line1: '1 Test Way',
          latitude: PICKUP.lat,
          longitude: PICKUP.lng,
          isPrimary: true,
        },
      },
    },
  });
  providerId = provider.id;
  const restaurant = await prisma.restaurant.create({
    data: { providerId, name: 'Maps Test Kitchen', cuisineTags: ['Test'], deliveryFeeMinor: 25000 },
  });
  restaurantId = restaurant.id;
});

afterAll(async () => {
  await prisma.provider.deleteMany({ where: { id: providerId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await prisma.$disconnect();
});

const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

// ── Geofence rules ───────────────────────────────────────────

describe('geofence rules', () => {
  const target = { latitude: 17.9583, longitude: -76.8822 };

  it('passes when the fix is inside the radius', () => {
    const fix = { latitude: 17.9588, longitude: -76.8825, recordedAt: new Date() }; // ~65 m
    const check = checkGeofence(fix, target, GEOFENCE.arrivalRadiusM);
    expect(check.ok).toBe(true);
    expect(check.distanceM).toBeLessThan(150);
  });

  it('fails with a distance when the fix is far away', () => {
    const fix = { latitude: 17.99, longitude: -76.8822, recordedAt: new Date() }; // ~3.5 km
    const check = checkGeofence(fix, target, GEOFENCE.arrivalRadiusM);
    expect(check.ok).toBe(false);
    expect(check.distanceM).toBeGreaterThan(3000);
  });

  it('passes (unverifiable) when there is no fix or the fix is stale', () => {
    expect(checkGeofence(null, target, 150).ok).toBe(true);
    const stale = { latitude: 17.99, longitude: -76.8822, recordedAt: new Date(Date.now() - 10 * 60 * 1000) };
    expect(checkGeofence(stale, target, 150).ok).toBe(true);
    expect(checkGeofence(stale, target, 150).distanceM).toBeNull();
  });
});

describe('speed anomaly detection', () => {
  it('accepts a normal drive between fixes', () => {
    const prev = { latitude: 17.9583, longitude: -76.8822, recordedAt: new Date(Date.now() - 60_000) };
    const anomaly = detectSpeedAnomaly(prev, { latitude: 17.9643, longitude: -76.8822 }); // ~0.67 km in 1 min ≈ 40 km/h
    expect(anomaly.impossible).toBe(false);
  });

  it('flags a physically impossible teleport', () => {
    const prev = { latitude: 17.9583, longitude: -76.8822, recordedAt: new Date(Date.now() - 10_000) };
    const anomaly = detectSpeedAnomaly(prev, { latitude: 18.2, longitude: -77.5 }); // ~70 km in 10 s
    expect(anomaly.impossible).toBe(true);
    expect(anomaly.impliedKph).toBeGreaterThan(GEOFENCE.impossibleSpeedKph);
  });

  it('does not flag short GPS jitter even at high implied speed', () => {
    const prev = { latitude: 17.9583, longitude: -76.8822, recordedAt: new Date(Date.now() - 1000) };
    const anomaly = detectSpeedAnomaly(prev, { latitude: 17.9593, longitude: -76.8822 }); // ~110 m in 1 s
    expect(anomaly.impossible).toBe(false);
  });
});

// ── /v1/maps endpoints ───────────────────────────────────────

describe('/v1/maps', () => {
  it('requires authentication', async () => {
    await request(app).get('/v1/maps/suggestions?q=portmore').expect(401);
  });

  it('returns suggestions and serves repeats from cache', async () => {
    const q = `cachetest-${stamp}`;
    const first = await request(app).get(`/v1/maps/suggestions?q=${q}`).set(auth()).expect(200);
    expect(first.body.suggestions).toHaveLength(2);
    expect(first.body.suggestions[0].name).toContain('Mall');

    const callsAfterFirst = fake.calls.suggestions;
    await request(app).get(`/v1/maps/suggestions?q=${q}`).set(auth()).expect(200);
    expect(fake.calls.suggestions).toBe(callsAfterFirst); // cache hit, no provider call
  });

  it('rejects invalid and null-island coordinates', async () => {
    await request(app).post('/v1/maps/reverse-geocode').set(auth()).send({ latitude: 99, longitude: 0 }).expect(422);
    const res = await request(app)
      .post('/v1/maps/reverse-geocode')
      .set(auth())
      .send({ latitude: 0, longitude: 0 })
      .expect(400);
    expect(res.body.error?.code ?? res.body.code).toBe('INVALID_COORDINATES');
  });

  it('returns road routes through the provider', async () => {
    const res = await request(app)
      .post('/v1/maps/route')
      .set(auth())
      .send({ from: { latitude: PICKUP.lat, longitude: PICKUP.lng }, to: { latitude: DROPOFF.lat, longitude: DROPOFF.lng } })
      .expect(200);
    expect(res.body.route.distanceKm).toBe(6.4);
    expect(res.body.route.coordinates).toHaveLength(3);
  });
});

// ── Server-authoritative ride quotes ─────────────────────────

describe('ride quotes', () => {
  it('creates a quote with server-routed distance, fares and geometry', async () => {
    const res = await request(app)
      .post('/v1/rides/estimate')
      .set(auth())
      .send({ pickup: PICKUP, dropoff: DROPOFF })
      .expect(200);
    expect(res.body.quoteId).toBeTruthy();
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.body.distanceKm).toBe(6.4); // provider road distance, not straight-line
    expect(res.body.route.length).toBeGreaterThanOrEqual(3);
    const economy = res.body.categories.find((c: { category: string }) => c.category === 'ECONOMY');
    expect(economy.estimateMinor).toBe(89400); // 670 base + 35/km × 6.4 km (JMD minor)
  });

  it('books with the quoted fare and burns the quote', async () => {
    const quote = (
      await request(app).post('/v1/rides/estimate').set(auth()).send({ pickup: PICKUP, dropoff: DROPOFF }).expect(200)
    ).body;

    const booking = await request(app)
      .post('/v1/rides/request')
      .set(auth())
      .send({
        category: 'ECONOMY',
        pickup: { name: 'Test pickup', ...PICKUP },
        dropoff: { name: 'Test dropoff', ...DROPOFF },
        quoteId: quote.quoteId,
      })
      .expect(201);
    expect(booking.body.request.estimateMinor).toBe(89400);
    expect(booking.body.request.distanceKm).toBe(6.4);
    expect(booking.body.request.quoteId).toBe(quote.quoteId);

    // The same quote cannot buy a second ride.
    const reuse = await request(app)
      .post('/v1/rides/request')
      .set(auth())
      .send({
        category: 'ECONOMY',
        pickup: { name: 'Test pickup', ...PICKUP },
        dropoff: { name: 'Test dropoff', ...DROPOFF },
        quoteId: quote.quoteId,
      })
      .expect(409);
    expect(reuse.body.error?.code ?? reuse.body.code).toBe('QUOTE_USED');
  });

  it('rejects expired quotes', async () => {
    const expired = await prisma.rideQuote.create({
      data: {
        customerId: userId,
        pickupName: 'Old pickup',
        pickupLat: PICKUP.lat,
        pickupLng: PICKUP.lng,
        dropoffName: 'Old dropoff',
        dropoffLat: DROPOFF.lat,
        dropoffLng: DROPOFF.lng,
        distanceKm: 6.4,
        durationMinutes: 14,
        fares: { ECONOMY: 82400 },
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const res = await request(app)
      .post('/v1/rides/request')
      .set(auth())
      .send({
        category: 'ECONOMY',
        pickup: { name: 'x', ...PICKUP },
        dropoff: { name: 'y', ...DROPOFF },
        quoteId: expired.id,
      })
      .expect(400);
    expect(res.body.error?.code ?? res.body.code).toBe('QUOTE_EXPIRED');
  });

  it("rejects another customer's quote", async () => {
    const quote = (
      await request(app).post('/v1/rides/estimate').set(auth()).send({ pickup: PICKUP, dropoff: DROPOFF }).expect(200)
    ).body;
    await request(app)
      .post('/v1/rides/request')
      .set(auth(otherToken))
      .send({
        category: 'ECONOMY',
        pickup: { name: 'x', ...PICKUP },
        dropoff: { name: 'y', ...DROPOFF },
        quoteId: quote.quoteId,
      })
      .expect(404);
  });

  it('rejects invalid coordinates on the legacy no-quote path', async () => {
    await request(app)
      .post('/v1/rides/estimate')
      .set(auth())
      .send({ pickup: { lat: 0, lng: 0 }, dropoff: DROPOFF })
      .expect(400);
  });
});

// ── Delivery zones ───────────────────────────────────────────

describe('delivery zones', () => {
  it('quotes normally inside the delivery radius', async () => {
    const quote = await deliveryQuote(
      { restaurantId, storeId: null },
      { lat: PICKUP.lat + 0.02, lng: PICKUP.lng }, // ~2.2 km from the branch
    );
    expect(quote.outOfZone).toBe(false);
    expect(quote.distanceKm).toBeGreaterThan(0);
  });

  it('flags drop-offs beyond the platform radius as out of zone', async () => {
    const quote = await deliveryQuote(
      { restaurantId, storeId: null },
      { lat: PICKUP.lat + 0.5, lng: PICKUP.lng - 0.5 }, // ~75 km away
    );
    expect(quote.outOfZone).toBe(true);
    expect(quote.maxDeliveryKm).toBe(env.DELIVERY_EXTENDED_MAX_KM);
  });
});
