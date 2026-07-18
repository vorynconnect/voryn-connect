/**
 * Partner verification lifecycle integration tests — run against the local dev
 * database (docker compose up -d). Covers: signup → application → documents →
 * submit → admin reject → resubmit → admin approve, plus the discovery gate
 * (a pending partner's catalog must never appear in the customer app).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma';
import { createApp } from '../../app';

const app = createApp();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPass1!';

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
);

let partnerToken: string;
let partnerUserId: string;
let providerId: string;
let adminToken: string;
let adminUserId: string;
let customerToken: string;
let customerId: string;
let vehicleId: string;

const partnerAuth = () => ({ Authorization: `Bearer ${partnerToken}` });
const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
const customerAuth = () => ({ Authorization: `Bearer ${customerToken}` });

beforeAll(async () => {
  const passwordHash = await argon2.hash(PASSWORD);

  // Team console admin (normally created by BOOTSTRAP_ADMIN_* / seed:admin).
  const admin = await prisma.user.create({
    data: {
      fullName: 'Verify Admin',
      email: `verify-admin-${stamp}@test.voryn.dev`,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  adminUserId = admin.id;

  // Customer used to probe the app-facing discovery endpoints.
  const customer = await prisma.user.create({
    data: {
      fullName: 'Verify Customer',
      email: `verify-customer-${stamp}@test.voryn.dev`,
      phone: `+1876001${stamp.slice(0, 4)}`,
      passwordHash,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      wallet: { create: {} },
    },
  });
  customerId = customer.id;
  const customerLogin = await request(app)
    .post('/v1/auth/login')
    .send({ identifier: customer.email, password: PASSWORD })
    .expect(200);
  customerToken = customerLogin.body.accessToken;

  // Partner signs up through the public website endpoint.
  const signup = await request(app)
    .post('/v1/partner/auth/signup')
    .send({
      businessName: `Verify Test Rentals ${stamp.slice(0, 6)}`,
      email: `verify-partner-${stamp}@test.voryn.dev`,
      password: PASSWORD,
      serviceType: 'Vehicle Rental',
    })
    .expect(201);
  partnerToken = signup.body.data.token;
  providerId = signup.body.data.partner.id;
  const staff = await prisma.providerStaff.findFirstOrThrow({ where: { providerId } });
  partnerUserId = staff.userId;

  // The pending partner already has a catalog item — it must stay invisible.
  const vehicle = await prisma.rentalVehicle.create({
    data: {
      providerId,
      make: `VerifyMake${stamp.slice(0, 6)}`,
      model: 'Hidden Until Approved',
      category: 'ECONOMY',
      dailyRateMinor: 500000,
      depositMinor: 100000,
      plateNo: `VRF ${stamp.slice(0, 4)}`,
      pickupBranchName: 'Test Branch',
    },
  });
  vehicleId = vehicle.id;
});

afterAll(async () => {
  await prisma.provider.delete({ where: { id: providerId } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { userId: partnerUserId } }).catch(() => {});
  for (const id of [partnerUserId, adminUserId, customerId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe('partner verification application', () => {
  it('starts incomplete: new signups are PENDING_VERIFICATION and cannot submit yet', async () => {
    const res = await request(app).get('/v1/partner/verification').set(partnerAuth()).expect(200);
    expect(res.body.data.status).toBe('incomplete');
    expect(res.body.data.providerStatus).toBe('PENDING_VERIFICATION');
    expect(res.body.data.canSubmit).toBe(false);
    expect(res.body.data.requirements.missingInfo).toContain('legalName');
    expect(res.body.data.requirements.missingDocuments).toEqual(
      expect.arrayContaining(['business_registration', 'owner_id']),
    );
  });

  it('rejects submission while the application is incomplete', async () => {
    const res = await request(app).post('/v1/partner/verification/submit').set(partnerAuth()).expect(400);
    expect(res.body.error.code).toBe('APPLICATION_INCOMPLETE');
  });

  it('hides the pending partner catalog from customer discovery', async () => {
    const res = await request(app)
      .get(`/v1/discovery/rental-vehicles?q=VerifyMake${stamp.slice(0, 6)}`)
      .set(customerAuth())
      .expect(200);
    expect(res.body.vehicles).toHaveLength(0);
  });

  it('saves business information', async () => {
    const res = await request(app)
      .put('/v1/partner/verification/business-info')
      .set(partnerAuth())
      .send({
        legalName: 'Verify Test Rentals Ltd.',
        businessRegNo: 'COJ-12345',
        trn: '123-456-789',
        ownerFullName: 'Testina Owner',
        ownerIdType: 'drivers_licence',
        ownerIdNumber: 'DL-998877',
        description: 'Vehicle rentals for integration tests.',
        phone: '+18765550123',
        address: { line1: '12 Test Plaza', city: 'Portmore', parish: 'St. Catherine' },
      })
      .expect(200);
    expect(res.body.data.business.legalName).toBe('Verify Test Rentals Ltd.');
    expect(res.body.data.requirements.missingInfo).toHaveLength(0);
    expect(res.body.data.canSubmit).toBe(false); // documents still missing
  });

  it('accepts required document uploads (PDF and image)', async () => {
    const first = await request(app)
      .post('/v1/partner/verification/documents')
      .set(partnerAuth())
      .field('type', 'business_registration')
      .attach('file', PNG_BYTES, { filename: 'registration.png', contentType: 'image/png' })
      .expect(201);
    expect(first.body.data.documents).toHaveLength(1);

    const second = await request(app)
      .post('/v1/partner/verification/documents')
      .set(partnerAuth())
      .field('type', 'owner_id')
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'id.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(second.body.data.documents).toHaveLength(2);
    expect(second.body.data.canSubmit).toBe(true);
  });

  it('rejects disallowed file types', async () => {
    const res = await request(app)
      .post('/v1/partner/verification/documents')
      .set(partnerAuth())
      .field('type', 'other')
      .attach('file', Buffer.from('MZ fake exe'), { filename: 'evil.exe', contentType: 'application/x-msdownload' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
  });

  it('submits for review, and blocks duplicate submission', async () => {
    const res = await request(app).post('/v1/partner/verification/submit').set(partnerAuth()).expect(201);
    expect(res.body.data.status).toBe('in_review');

    const dup = await request(app).post('/v1/partner/verification/submit').set(partnerAuth()).expect(409);
    expect(dup.body.error.code).toBe('ALREADY_SUBMITTED');
  });
});

describe('team review console', () => {
  it('rejects non-admin logins and partner tokens on admin routes', async () => {
    const res = await request(app)
      .post('/v1/admin/auth/login')
      .send({ email: `verify-partner-${stamp}@test.voryn.dev`, password: PASSWORD })
      .expect(403);
    expect(res.body.error.code).toBe('NOT_AN_ADMIN');

    await request(app).get('/v1/admin/verifications').set(partnerAuth()).expect(403);
  });

  it('logs in an admin and lists the application in the review queue', async () => {
    const login = await request(app)
      .post('/v1/admin/auth/login')
      .send({ email: `verify-admin-${stamp}@test.voryn.dev`, password: PASSWORD })
      .expect(200);
    adminToken = login.body.data.token;

    const queue = await request(app)
      .get('/v1/admin/verifications?status=in_review')
      .set(adminAuth())
      .expect(200);
    const item = queue.body.data.items.find((i: { providerId: string }) => i.providerId === providerId);
    expect(item).toBeTruthy();
    expect(item.documentsCount).toBe(2);
  });

  it('returns full application detail including documents and owner', async () => {
    const res = await request(app)
      .get(`/v1/admin/verifications/${providerId}`)
      .set(adminAuth())
      .expect(200);
    expect(res.body.data.business.trn).toBe('123-456-789');
    expect(res.body.data.documents).toHaveLength(2);
    expect(res.body.data.owner.email).toBe(`verify-partner-${stamp}@test.voryn.dev`);
  });

  it('rejects with notes: partner sees feedback, store stays hidden', async () => {
    await request(app)
      .post(`/v1/admin/verifications/${providerId}/reject`)
      .set(adminAuth())
      .send({ notes: 'Business registration document is blurry — upload a clearer copy.' })
      .expect(200);

    const partnerSide = await request(app).get('/v1/partner/verification').set(partnerAuth()).expect(200);
    expect(partnerSide.body.data.status).toBe('rejected');
    expect(partnerSide.body.data.review.notes).toContain('blurry');
    expect(partnerSide.body.data.canSubmit).toBe(true);

    const search = await request(app)
      .get(`/v1/discovery/rental-vehicles?q=VerifyMake${stamp.slice(0, 6)}`)
      .set(customerAuth())
      .expect(200);
    expect(search.body.vehicles).toHaveLength(0);
  });

  it('resubmission after rejection returns to review', async () => {
    const res = await request(app).post('/v1/partner/verification/submit').set(partnerAuth()).expect(201);
    expect(res.body.data.status).toBe('in_review');
  });

  it('approves: provider goes ACTIVE, documents approved, catalog now discoverable', async () => {
    await request(app)
      .post(`/v1/admin/verifications/${providerId}/approve`)
      .set(adminAuth())
      .send({})
      .expect(200);

    const provider = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
    expect(provider.status).toBe('ACTIVE');
    expect(provider.isVerified).toBe(true);

    const partnerSide = await request(app).get('/v1/partner/verification').set(partnerAuth()).expect(200);
    expect(partnerSide.body.data.status).toBe('approved');
    expect(partnerSide.body.data.documents.every((d: { status: string }) => d.status === 'APPROVED')).toBe(true);

    const search = await request(app)
      .get(`/v1/discovery/rental-vehicles?q=VerifyMake${stamp.slice(0, 6)}`)
      .set(customerAuth())
      .expect(200);
    expect(search.body.vehicles.map((v: { id: string }) => v.id)).toContain(vehicleId);

    // Partner staff got the approval notification.
    const note = await prisma.notification.findFirst({
      where: { userId: partnerUserId, type: 'SYSTEM' },
      orderBy: { createdAt: 'desc' },
    });
    expect(note?.title).toContain('verified');
  });

  it('blocks re-approving an already-active partner', async () => {
    const res = await request(app)
      .post(`/v1/admin/verifications/${providerId}/approve`)
      .set(adminAuth())
      .send({})
      .expect(409);
    expect(res.body.error.code).toBe('ALREADY_VERIFIED');
  });
});
