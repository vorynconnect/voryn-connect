/**
 * Dispatch + live-ETA tests: driver eligibility filtering, the expanding
 * search radius, honest pickup ETAs, anonymized nearby markers, atomic
 * accept, and backend route-based ETAs. Runs against the local dev database
 * with isolated fixtures; the map provider is faked (no network).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma';
import { createApp } from '../../app';
import { env } from '../../config/env';
import { mapsService } from '../maps/maps.service';
import type { MapProvider } from '../maps/maps.provider';
import {
  currentSearchStage,
  eligibleDrivers,
  maxSearchRadiusKm,
  nearbyDriverMarkers,
  pickupEtaByCategory,
  rideSearchStatus,
} from './dispatch.service';
import { clearEtaSnapshotsForTesting, liveEta } from './eta.service';

const app = createApp();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPass1!';
const PICKUP = { lat: 17.9583, lng: -76.8822 };
const DROPOFF = { lat: 17.99, lng: -76.85 };

const fakeProvider: MapProvider = {
  name: 'fake',
  async getPlaceSuggestions() {
    return [];
  },
  async reverseGeocode() {
    return null;
  },
  async calculateRoute(from, to) {
    return { coordinates: [from, to], distanceKm: 6.4, durationMinutes: 14 };
  },
};

const userIds: string[] = [];
let customerToken = '';
let customerId = '';
let nearTok = '';
let farTok = '';
let nearDriverId = '';

async function mkUser(tag: string, digits: string) {
  const user = await prisma.user.create({
    data: {
      fullName: `Dispatch ${tag}`,
      email: `dispatch-${tag}-${stamp}@test.voryn.dev`,
      phone: `+1876${digits}${stamp.slice(0, 4)}`,
      passwordHash: await argon2.hash(PASSWORD),
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      wallet: { create: {} },
    },
  });
  userIds.push(user.id);
  return user;
}

async function mkDriver(
  tag: string,
  digits: string,
  profile: {
    isOnline: boolean;
    category?: 'ECONOMY' | 'XL' | 'MOTO' | 'COMFORT';
    lat?: number;
    lng?: number;
    locationAgeSeconds?: number;
  },
) {
  const user = await mkUser(tag, digits);
  const driver = await prisma.driverProfile.create({
    data: {
      userId: user.id,
      isOnline: profile.isOnline,
      rideCategory: profile.category ?? 'ECONOMY',
      lastLat: profile.lat ?? null,
      lastLng: profile.lng ?? null,
      lastLocationAt:
        profile.lat != null ? new Date(Date.now() - (profile.locationAgeSeconds ?? 2) * 1000) : null,
    },
  });
  return { user, driver };
}

const login = async (email: string) =>
  (await request(app).post('/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body
    .accessToken as string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  mapsService.setProviderForTesting(fakeProvider);

  const customer = await mkUser('rider', '50');
  customerId = customer.id;
  customerToken = await login(customer.email!);

  // Fixture fleet around the pickup point:
  const near = await mkDriver('near', '51', { isOnline: true, lat: PICKUP.lat + 0.009, lng: PICKUP.lng }); // ~1 km
  nearDriverId = near.driver.id;
  nearTok = await login(near.user.email!);
  const far = await mkDriver('far', '52', { isOnline: true, lat: PICKUP.lat + 0.04, lng: PICKUP.lng }); // ~4.4 km
  farTok = await login(far.user.email!);
  await mkDriver('offline', '53', { isOnline: false, lat: PICKUP.lat + 0.005, lng: PICKUP.lng });
  await mkDriver('stale', '54', {
    isOnline: true,
    lat: PICKUP.lat + 0.005,
    lng: PICKUP.lng,
    locationAgeSeconds: 300,
  });
  await mkDriver('xl', '55', { isOnline: true, category: 'XL', lat: PICKUP.lat + 0.01, lng: PICKUP.lng });
  await mkDriver('nowhere', '56', { isOnline: true, lat: PICKUP.lat + 0.5, lng: PICKUP.lng }); // ~55 km

  // Busy: online + fresh, but already on an assigned trip.
  const busy = await mkDriver('busy', '57', { isOnline: true, lat: PICKUP.lat + 0.004, lng: PICKUP.lng });
  const busyRider = await mkUser('busyrider', '58');
  const busyRequest = await prisma.rideRequest.create({
    data: {
      customerId: busyRider.id,
      category: 'ECONOMY',
      status: 'DRIVER_ASSIGNED',
      pickupName: 'x',
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      dropoffName: 'y',
      dropoffLat: DROPOFF.lat,
      dropoffLng: DROPOFF.lng,
      estimateMinor: 10000,
    },
  });
  await prisma.rideTrip.create({
    data: {
      code: `VC-T${stamp.slice(0, 6)}`,
      requestId: busyRequest.id,
      driverId: busy.driver.id,
      status: 'DRIVER_ASSIGNED',
      pickupCode: '0000',
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

// ── Eligibility ──────────────────────────────────────────────

describe('eligibleDrivers', () => {
  it('includes only online, fresh, in-radius, category-matched, free drivers', async () => {
    const drivers = await eligibleDrivers({ ...{ lat: PICKUP.lat, lng: PICKUP.lng }, radiusKm: 5, category: 'ECONOMY' });
    const ids = drivers.map((d) => d.driverId);
    expect(ids).toContain(nearDriverId);
    // Offline, stale, wrong-category, out-of-radius and busy drivers are out.
    expect(drivers.every((d) => d.category === 'ECONOMY')).toBe(true);
    expect(drivers.every((d) => d.distanceKm <= 5)).toBe(true);
    const tags = await prisma.driverProfile.findMany({
      where: { id: { in: ids } },
      select: { user: { select: { fullName: true } } },
    });
    const names = tags.map((t) => t.user.fullName);
    expect(names).not.toContain('Dispatch offline');
    expect(names).not.toContain('Dispatch stale');
    expect(names).not.toContain('Dispatch xl');
    expect(names).not.toContain('Dispatch nowhere');
    expect(names).not.toContain('Dispatch busy');
  });

  it('sorts nearest first', async () => {
    const drivers = await eligibleDrivers({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 10, category: 'ECONOMY' });
    const distances = drivers.map((d) => d.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('excludes everyone when the radius is tiny', async () => {
    const drivers = await eligibleDrivers({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 0.1, category: 'ECONOMY' });
    expect(drivers).toHaveLength(0);
  });
});

// ── Search staging ───────────────────────────────────────────

describe('search radius staging', () => {
  const radii = env.RIDE_SEARCH_RADII_KM;

  it('starts at the first configured radius', () => {
    const stage = currentSearchStage(new Date());
    expect(stage.stage).toBe(0);
    expect(stage.radiusKm).toBe(radii[0]);
    expect(stage.expired).toBe(false);
  });

  it('expands stage by stage over time and caps at the widest radius', () => {
    const oneStageAgo = new Date(Date.now() - (env.RIDE_SEARCH_STAGE_SECONDS + 1) * 1000);
    expect(currentSearchStage(oneStageAgo).stage).toBe(1);
    expect(currentSearchStage(oneStageAgo).radiusKm).toBe(radii[1]);

    const ages = new Date(Date.now() - env.RIDE_SEARCH_STAGE_SECONDS * 50 * 1000);
    expect(currentSearchStage(ages).radiusKm).toBe(radii[radii.length - 1]);
    expect(maxSearchRadiusKm()).toBe(radii[radii.length - 1]);
  });

  it('marks the session expired after the maximum search window', () => {
    const old = new Date(Date.now() - (env.RIDE_SEARCH_MAX_SECONDS + 5) * 1000);
    expect(currentSearchStage(old).expired).toBe(true);
  });

  it('lazily flips an expired SEARCHING request to an honest no-driver result', async () => {
    const expired = await prisma.rideRequest.create({
      data: {
        customerId,
        category: 'ECONOMY',
        status: 'SEARCHING',
        pickupName: 'x',
        pickupLat: PICKUP.lat,
        pickupLng: PICKUP.lng,
        dropoffName: 'y',
        dropoffLat: DROPOFF.lat,
        dropoffLng: DROPOFF.lng,
        estimateMinor: 10000,
        createdAt: new Date(Date.now() - (env.RIDE_SEARCH_MAX_SECONDS + 30) * 1000),
      },
    });
    const status = await rideSearchStatus(expired);
    expect(status.status).toBe('NO_DRIVER_FOUND');
    const row = await prisma.rideRequest.findUniqueOrThrow({ where: { id: expired.id } });
    expect(row.status).toBe('NO_DRIVER_AVAILABLE');
  });

  it('never clobbers an assigned ride even when the window has passed', async () => {
    const assigned = await prisma.rideRequest.create({
      data: {
        customerId,
        category: 'ECONOMY',
        status: 'DRIVER_ASSIGNED',
        pickupName: 'x',
        pickupLat: PICKUP.lat,
        pickupLng: PICKUP.lng,
        dropoffName: 'y',
        dropoffLat: DROPOFF.lat,
        dropoffLng: DROPOFF.lng,
        estimateMinor: 10000,
        createdAt: new Date(Date.now() - (env.RIDE_SEARCH_MAX_SECONDS + 30) * 1000),
      },
    });
    const status = await rideSearchStatus(assigned);
    expect(status.status).toBe('DRIVER_ASSIGNED');
    const row = await prisma.rideRequest.findUniqueOrThrow({ where: { id: assigned.id } });
    expect(row.status).toBe('DRIVER_ASSIGNED');
  });
});

// ── Honest supply data ───────────────────────────────────────

describe('pickup ETAs and nearby markers', () => {
  it('returns a real ETA where drivers exist and null where none do', async () => {
    const etas = await pickupEtaByCategory(PICKUP);
    expect(etas.ECONOMY).toBeGreaterThanOrEqual(1); // near driver ~1 km away
    expect(etas.MOTO).toBeNull(); // no moto drivers in the fixture fleet
  });

  it('anonymizes markers: no ids, bounded deterministic offset', async () => {
    const first = await nearbyDriverMarkers({ lat: PICKUP.lat, lng: PICKUP.lng, category: 'ECONOMY' });
    expect(first.length).toBeGreaterThan(0);
    for (const marker of first) {
      expect(marker.key).not.toBe(nearDriverId);
      expect(marker).not.toHaveProperty('driverId');
      expect(marker).not.toHaveProperty('userId');
    }
    const second = await nearbyDriverMarkers({ lat: PICKUP.lat, lng: PICKUP.lng, category: 'ECONOMY' });
    expect(second).toEqual(first); // stable between polls — markers must not teleport

    const near = await prisma.driverProfile.findUniqueOrThrow({ where: { id: nearDriverId } });
    const marker = first.find((m) => Math.abs(m.latitude - near.lastLat!) < 0.002);
    expect(marker).toBeTruthy();
    expect(Math.abs(marker!.latitude - near.lastLat!)).toBeLessThan(0.001); // ≤ ~110 m
    expect(Math.abs(marker!.longitude - near.lastLng!)).toBeLessThan(0.001);
  });

  it('serves nearby drivers over HTTP with auth', async () => {
    await request(app).get(`/v1/rides/nearby-drivers?lat=${PICKUP.lat}&lng=${PICKUP.lng}`).expect(401);
    const res = await request(app)
      .get(`/v1/rides/nearby-drivers?lat=${PICKUP.lat}&lng=${PICKUP.lng}&category=ECONOMY`)
      .set(auth(customerToken))
      .expect(200);
    expect(res.body.count).toBe(res.body.drivers.length);
    expect(res.body.count).toBeGreaterThan(0);
  });
});

// ── Search session over HTTP + dispatch-scoped driver feed ───

describe('ride search flow', () => {
  let requestId = '';

  it('exposes the live search session on the request payload', async () => {
    const quote = (
      await request(app)
        .post('/v1/rides/estimate')
        .set(auth(customerToken))
        .send({ pickup: PICKUP, dropoff: DROPOFF })
        .expect(200)
    ).body;
    const created = await request(app)
      .post('/v1/rides/request')
      .set(auth(customerToken))
      .send({
        category: 'ECONOMY',
        pickup: { name: 'Braeton', ...PICKUP },
        dropoff: { name: 'Mall', ...DROPOFF },
        quoteId: quote.quoteId,
      })
      .expect(201);
    requestId = created.body.request.id;

    const res = await request(app).get(`/v1/rides/requests/${requestId}`).set(auth(customerToken)).expect(200);
    expect(res.body.search.status).toBe('SEARCHING');
    expect(res.body.search.currentRadiusKm).toBe(env.RIDE_SEARCH_RADII_KM[0]);
    expect(res.body.search.stageCount).toBe(env.RIDE_SEARCH_RADII_KM.length);
    expect(res.body.search.eligibleDriverCount).toBeGreaterThan(0);
  });

  it('shows the ride only to drivers inside the current radius', async () => {
    const nearFeed = await request(app).get('/v1/driver/requests').set(auth(nearTok)).expect(200);
    expect(nearFeed.body.requests.some((r: { id: string }) => r.id === requestId)).toBe(true);
    // The far driver (~4.4 km) is outside stage-0 radius (1.5 km).
    const farFeed = await request(app).get('/v1/driver/requests').set(auth(farTok)).expect(200);
    expect(farFeed.body.requests.some((r: { id: string }) => r.id === requestId)).toBe(false);
  });

  it('atomically assigns one driver; a second accept gets a conflict', async () => {
    await request(app)
      .post(`/v1/driver/requests/${requestId}/accept`)
      .set(auth(nearTok))
      .send({ kind: 'ride' })
      .expect(201);
    const second = await request(app)
      .post(`/v1/driver/requests/${requestId}/accept`)
      .set(auth(farTok))
      .send({ kind: 'ride' })
      .expect(409);
    expect(second.body.error?.code ?? second.body.code).toBe('ALREADY_TAKEN');
  });
});

// ── Backend live ETA ─────────────────────────────────────────

describe('liveEta', () => {
  it('computes the ETA from the route provider using the latest fix', async () => {
    clearEtaSnapshotsForTesting();
    const trip = await prisma.rideTrip.findFirstOrThrow({
      where: { request: { customerId } },
      include: { request: true },
    });
    await prisma.liveLocation.create({
      data: { subjectType: 'RIDE', subjectId: trip.id, latitude: PICKUP.lat + 0.01, longitude: PICKUP.lng },
    });
    const eta = await liveEta('RIDE', trip.id, { latitude: PICKUP.lat, longitude: PICKUP.lng });
    expect(eta).toBeTruthy();
    expect(eta!.source).toBe('route');
    expect(eta!.etaSeconds).toBe(14 * 60); // fake provider: 14-minute route
    expect(eta!.etaMinutes).toBe(14);
    expect(eta!.distanceMeters).toBe(6400);
    expect(eta!.stale).toBe(false);
  });

  it('marks the ETA stale when the vehicle fix is old', async () => {
    clearEtaSnapshotsForTesting();
    const trip = await prisma.rideTrip.findFirstOrThrow({ where: { request: { customerId } } });
    await prisma.liveLocation.deleteMany({ where: { subjectType: 'RIDE', subjectId: trip.id } });
    await prisma.liveLocation.create({
      data: {
        subjectType: 'RIDE',
        subjectId: trip.id,
        latitude: PICKUP.lat,
        longitude: PICKUP.lng,
        recordedAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    });
    const eta = await liveEta('RIDE', trip.id, { latitude: DROPOFF.lat, longitude: DROPOFF.lng });
    expect(eta!.stale).toBe(true);
  });

  it('falls back to a labelled approximation when the router is down', async () => {
    clearEtaSnapshotsForTesting();
    mapsService.setProviderForTesting({
      name: 'down',
      async getPlaceSuggestions() {
        return [];
      },
      async reverseGeocode() {
        return null;
      },
      async calculateRoute() {
        return null;
      },
    });
    try {
      const trip = await prisma.rideTrip.findFirstOrThrow({ where: { request: { customerId } } });
      const eta = await liveEta('RIDE', trip.id, { latitude: DROPOFF.lat, longitude: DROPOFF.lng });
      expect(eta!.source).toBe('approximate');
      expect(eta!.etaSeconds).toBeGreaterThan(0);
    } finally {
      mapsService.setProviderForTesting(fakeProvider);
    }
  });

  it('returns null when there is no fix at all', async () => {
    const eta = await liveEta('RIDE', 'no-such-trip', { latitude: PICKUP.lat, longitude: PICKUP.lng });
    expect(eta).toBeNull();
  });
});
