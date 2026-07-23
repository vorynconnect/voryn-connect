/**
 * Provider payout tests: the flat withdrawal fee, the reservation that stops
 * the same earnings being withdrawn twice, and what happens when a bank
 * transfer fails. Runs against the local dev database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { payoutsService } from './payouts.service';

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let providerId: string;

/** Add cleared, withdrawable earnings for the provider. */
async function seedEarnings(amounts: number[]) {
  await prisma.providerEarning.deleteMany({ where: { providerId } });
  await prisma.providerPayout.deleteMany({ where: { providerId } });
  for (const [i, netMinor] of amounts.entries()) {
    await prisma.providerEarning.create({
      data: {
        providerId,
        referenceType: 'test',
        referenceId: `earn-${stamp}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        code: `T-${i}`,
        grossMinor: netMinor,
        commissionBps: 0,
        commissionMinor: 0,
        netMinor,
        status: 'AVAILABLE',
        availableAt: new Date(Date.now() - 86_400_000),
      },
    });
  }
}

beforeAll(async () => {
  const provider = await prisma.provider.create({
    data: {
      slug: `payout-test-${stamp}`,
      name: 'Payout Test Co',
      categories: ['RESTAURANT'],
      status: 'ACTIVE',
      isSeedData: true,
    },
  });
  providerId = provider.id;
});

afterAll(async () => {
  await prisma.provider.delete({ where: { id: providerId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('wallet balances', () => {
  beforeEach(async () => {
    await seedEarnings([500_000, 300_000]);
  });

  it('reports the balances separately', async () => {
    const balances = await payoutsService.walletBalances(providerId);
    expect(balances.availableMinor).toBe(800_000);
    expect(balances.reservedMinor).toBe(0);
    expect(balances.onHoldMinor).toBe(0);
    expect(balances.withdrawnMinor).toBe(0);
    expect(balances.feeMinor).toBe(env.PAYOUT_FLAT_FEE_MINOR);
  });

  it('keeps earnings pending until their clearance date', async () => {
    await prisma.providerEarning.create({
      data: {
        providerId,
        referenceType: 'test',
        referenceId: `future-${stamp}`,
        code: 'FUTURE',
        grossMinor: 100_000,
        commissionBps: 0,
        commissionMinor: 0,
        netMinor: 100_000,
        status: 'PENDING',
        availableAt: new Date(Date.now() + 86_400_000),
      },
    });
    const balances = await payoutsService.walletBalances(providerId);
    expect(balances.pendingMinor).toBe(100_000);
    expect(balances.availableMinor).toBe(800_000); // unchanged
  });
});

describe('withdrawal requests', () => {
  beforeEach(async () => {
    await seedEarnings([500_000, 300_000]); // JMD 8,000 available
  });

  it('adds the flat fee on top of the amount the provider receives', async () => {
    const quote = await payoutsService.quoteWithdrawal(providerId, 200_000); // JMD 2,000
    expect(quote.amountMinor).toBe(200_000);
    expect(quote.feeMinor).toBe(15_000); // JMD 150
    expect(quote.totalMinor).toBe(215_000);
    expect(quote.sufficient).toBe(true);
  });

  it('refuses withdrawals below the minimum', async () => {
    await expect(
      payoutsService.requestWithdrawal({ providerId, amountMinor: 100_000 }),
    ).rejects.toThrow(AppError);
  });

  it('moves the amount and the fee out of available immediately', async () => {
    await payoutsService.requestWithdrawal({ providerId, amountMinor: 300_000 });
    const balances = await payoutsService.walletBalances(providerId);
    // Earnings are reserved whole, so the JMD 5,000 row covers the JMD 3,150
    // needed and the rest stays available.
    expect(balances.reservedMinor).toBe(500_000);
    expect(balances.availableMinor).toBe(300_000);
  });

  it('will not let the same earnings fund two payouts', async () => {
    await payoutsService.requestWithdrawal({ providerId, amountMinor: 700_000 }); // reserves everything
    await expect(
      payoutsService.requestWithdrawal({ providerId, amountMinor: 700_000 }),
    ).rejects.toThrow(AppError);
  });

  it('returns the same payout for a repeated idempotency key', async () => {
    const key = `payout-${stamp}`;
    const first = await payoutsService.requestWithdrawal({ providerId, amountMinor: 200_000, idempotencyKey: key });
    const second = await payoutsService.requestWithdrawal({ providerId, amountMinor: 200_000, idempotencyKey: key });
    expect(second.id).toBe(first.id);
    const all = await prisma.providerPayout.findMany({ where: { providerId } });
    expect(all).toHaveLength(1);
  });
});

describe('payout settlement', () => {
  beforeEach(async () => {
    await seedEarnings([500_000, 300_000]);
  });

  it('records the fee as revenue and returns the change on success', async () => {
    const payout = await payoutsService.requestWithdrawal({ providerId, amountMinor: 300_000 });
    await payoutsService.markPaid(payout.id);

    const balances = await payoutsService.walletBalances(providerId);
    expect(balances.reservedMinor).toBe(0);
    expect(balances.withdrawnMinor).toBe(500_000); // the reserved row is now paid
    // JMD 5,000 was reserved for a JMD 3,150 payout, so JMD 1,850 comes back.
    expect(balances.availableMinor).toBe(300_000 + 185_000);

    const fee = await prisma.settlementRecord.findFirstOrThrow({
      where: { referenceType: 'payout', referenceId: payout.id, entryType: 'WITHDRAWAL_FEE' },
    });
    expect(fee.amountMinor).toBe(15_000);
  });

  it('returns both the amount and the fee when the transfer fails', async () => {
    const before = await payoutsService.walletBalances(providerId);
    const payout = await payoutsService.requestWithdrawal({ providerId, amountMinor: 300_000 });
    await payoutsService.markFailed(payout.id, 'Bank rejected the account number');

    const after = await payoutsService.walletBalances(providerId);
    expect(after.availableMinor).toBe(before.availableMinor); // nothing lost
    expect(after.reservedMinor).toBe(0);

    const row = await prisma.providerPayout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(row.status).toBe('FAILED');
    expect(row.failureReason).toContain('Bank rejected');

    // No fee is charged for a transfer that never happened.
    const fees = await prisma.settlementRecord.findMany({
      where: { referenceType: 'payout', referenceId: payout.id },
    });
    expect(fees).toHaveLength(0);
  });

  it('refuses to fail a payout that already paid out', async () => {
    const payout = await payoutsService.requestWithdrawal({ providerId, amountMinor: 300_000 });
    await payoutsService.markPaid(payout.id);
    await expect(payoutsService.markFailed(payout.id, 'too late')).rejects.toThrow(AppError);
  });
});
