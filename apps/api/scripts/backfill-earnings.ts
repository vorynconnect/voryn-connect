/**
 * Backfills ProviderEarning rows for transactions completed BEFORE the
 * commission ledger existed, so partner dashboards stay populated. Legacy rows
 * get earning records only (current commission rates, availableAt in the past
 * so they read as AVAILABLE) — no points, payouts, or settlement records,
 * because those already happened under the old rules. Idempotent. DEV ONLY.
 */
import { ProviderCategory } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { commissionBpsForProvider, commissionOfMinor } from '../src/lib/commission';

type LegacyRow = {
  providerId: string;
  referenceType: string;
  referenceId: string;
  code: string;
  basisMinor: number;
  completedAt: Date;
  provider: { commissionBps: number | null; categories: ProviderCategory[] };
};

async function backfill(rows: LegacyRow[]): Promise<number> {
  let created = 0;
  for (const row of rows) {
    const existing = await prisma.providerEarning.findUnique({
      where: {
        referenceType_referenceId: {
          referenceType: row.referenceType,
          referenceId: row.referenceId,
        },
      },
    });
    if (existing) continue;
    const bps = commissionBpsForProvider(row.provider);
    const commissionMinor = commissionOfMinor(row.basisMinor, bps);
    await prisma.providerEarning.create({
      data: {
        providerId: row.providerId,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        code: row.code,
        grossMinor: row.basisMinor,
        commissionBps: bps,
        commissionMinor,
        netMinor: row.basisMinor - commissionMinor,
        status: 'AVAILABLE',
        availableAt: row.completedAt,
        createdAt: row.completedAt,
      },
    });
    created += 1;
  }
  return created;
}

async function main() {
  const providerSelect = { select: { commissionBps: true, categories: true } } as const;

  const [orders, bookings, rentals] = await Promise.all([
    prisma.order.findMany({
      where: { status: { in: ['DELIVERED', 'COMPLETED'] } },
      select: {
        id: true, code: true, providerId: true, subtotalMinor: true,
        deliveredAt: true, updatedAt: true, provider: providerSelect,
      },
    }),
    prisma.serviceBooking.findMany({
      where: { status: 'COMPLETED' },
      select: {
        id: true, code: true, providerId: true, serviceFeeMinor: true, mobileFeeMinor: true,
        updatedAt: true, provider: providerSelect,
      },
    }),
    prisma.rentalReservation.findMany({
      where: { status: 'COMPLETED' },
      select: {
        id: true, code: true, providerId: true, rentalFeeMinor: true, protectionMinor: true,
        updatedAt: true, provider: providerSelect,
      },
    }),
  ]);

  const createdOrders = await backfill(orders.map((o) => ({
    providerId: o.providerId, referenceType: 'order', referenceId: o.id, code: o.code,
    basisMinor: o.subtotalMinor, completedAt: o.deliveredAt ?? o.updatedAt, provider: o.provider,
  })));
  const createdBookings = await backfill(bookings.map((b) => ({
    providerId: b.providerId, referenceType: 'booking', referenceId: b.id, code: b.code,
    basisMinor: b.serviceFeeMinor + b.mobileFeeMinor, completedAt: b.updatedAt, provider: b.provider,
  })));
  const createdRentals = await backfill(rentals.map((r) => ({
    providerId: r.providerId, referenceType: 'rental', referenceId: r.id, code: r.code,
    basisMinor: r.rentalFeeMinor + r.protectionMinor, completedAt: r.updatedAt, provider: r.provider,
  })));

  console.log(`Backfilled earnings — orders: ${createdOrders}/${orders.length}, bookings: ${createdBookings}/${bookings.length}, rentals: ${createdRentals}/${rentals.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
