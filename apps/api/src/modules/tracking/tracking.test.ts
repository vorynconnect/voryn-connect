import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma';
import { canAccessTracking } from './tracking.service';

/**
 * Regression test for the realtime-tracking access control. Live GPS and status
 * events are broadcast to per-subject socket rooms, so canAccessTracking must
 * only admit a user who is party to the trip/order (or an ops admin). Without
 * this gate, any authenticated user could follow a stranger's live location.
 */

const stamp = Date.now().toString(36);
let customerId = '';
let driverUserId = '';
let courierUserId = '';
let strangerId = '';
let providerId = '';
let tripId = '';
let orderId = '';

beforeAll(async () => {
  const passwordHash = await argon2.hash('Tracking1!');
  const mkUser = (tag: string, digits: string) =>
    prisma.user.create({
      data: {
        fullName: `Track ${tag}`,
        email: `track-${tag}-${stamp}@test.voryn.dev`,
        phone: `+1876${digits}${stamp.slice(0, 4)}`,
        passwordHash,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });

  const [customer, stranger, driverUser, courierUser] = await Promise.all([
    mkUser('cust', '70'),
    mkUser('strg', '71'),
    mkUser('drv', '72'),
    mkUser('cor', '73'),
  ]);
  customerId = customer.id;
  strangerId = stranger.id;
  driverUserId = driverUser.id;
  courierUserId = courierUser.id;

  const driver = await prisma.driverProfile.create({
    data: { userId: driverUserId, rideCategory: 'ECONOMY' },
  });
  const courier = await prisma.courierProfile.create({
    data: { userId: courierUserId, vehicleType: 'moto' },
  });

  const request = await prisma.rideRequest.create({
    data: {
      customerId,
      category: 'ECONOMY',
      status: 'DRIVER_ASSIGNED',
      pickupName: 'a',
      pickupLat: 17.9,
      pickupLng: -76.8,
      dropoffName: 'b',
      dropoffLat: 17.99,
      dropoffLng: -76.85,
      estimateMinor: 10000,
    },
  });
  const trip = await prisma.rideTrip.create({
    data: {
      code: `VC-K${stamp.slice(0, 6)}`,
      requestId: request.id,
      driverId: driver.id,
      status: 'DRIVER_ASSIGNED',
      pickupCode: '0000',
    },
  });
  tripId = trip.id;

  const provider = await prisma.provider.create({
    data: { name: `Track Merchant ${stamp}`, slug: `track-merchant-${stamp}`, categories: ['RESTAURANT'] },
  });
  providerId = provider.id;
  const order = await prisma.order.create({
    data: { code: `VC-O${stamp.slice(0, 6)}`, customerId, providerId, courierId: courier.id },
  });
  orderId = order.id;
});

afterAll(async () => {
  // Provider delete cascades the order; user deletes cascade profiles + ride.
  await prisma.provider.delete({ where: { id: providerId } }).catch(() => {});
  await prisma.user.deleteMany({
    where: { id: { in: [customerId, strangerId, driverUserId, courierUserId] } },
  }).catch(() => {});
  await prisma.$disconnect();
});

describe('tracking authorization (canAccessTracking)', () => {
  it('lets the ride customer and the assigned driver follow the trip', async () => {
    expect(await canAccessTracking(customerId, 'CUSTOMER', 'RIDE', tripId)).toBe(true);
    expect(await canAccessTracking(driverUserId, 'CUSTOMER', 'RIDE', tripId)).toBe(true);
  });

  it('blocks a stranger from following a ride they are not party to', async () => {
    expect(await canAccessTracking(strangerId, 'CUSTOMER', 'RIDE', tripId)).toBe(false);
  });

  it('lets the order customer and the assigned courier follow the delivery', async () => {
    expect(await canAccessTracking(customerId, 'CUSTOMER', 'ORDER', orderId)).toBe(true);
    expect(await canAccessTracking(courierUserId, 'CUSTOMER', 'ORDER', orderId)).toBe(true);
  });

  it('blocks a stranger from following a delivery', async () => {
    expect(await canAccessTracking(strangerId, 'CUSTOMER', 'ORDER', orderId)).toBe(false);
  });

  it('lets ops staff (ADMIN) observe any subject', async () => {
    expect(await canAccessTracking(strangerId, 'ADMIN', 'RIDE', tripId)).toBe(true);
    expect(await canAccessTracking(strangerId, 'SUPER_ADMIN', 'ORDER', orderId)).toBe(true);
  });

  it('denies a subject that does not exist', async () => {
    expect(await canAccessTracking(customerId, 'CUSTOMER', 'RIDE', 'no-such-trip')).toBe(false);
    expect(await canAccessTracking(customerId, 'CUSTOMER', 'ORDER', 'no-such-order')).toBe(false);
  });
});
