import { EarningStatus, PayoutStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';

/**
 * Provider payouts to a bank account.
 *
 * The provider names the amount they want to RECEIVE; the flat withdrawal fee
 * is added on top. Both leave the available balance the moment the request is
 * made — held as RESERVED earnings — so the same money can never be committed
 * to two payouts. A failed payout returns the amount and the fee together.
 *
 * Nothing here moves real money: it produces the instruction and the ledger
 * state. Actual bank transfers go through an authorised payment provider.
 */

export type WalletBalances = {
  pendingMinor: number;
  availableMinor: number;
  reservedMinor: number;
  onHoldMinor: number;
  withdrawnMinor: number;
  feeMinor: number;
  minimumMinor: number;
};

/** Earnings whose clearance date has passed become spendable. */
async function releaseClearedEarnings(providerId: string) {
  await prisma.providerEarning.updateMany({
    where: { providerId, status: EarningStatus.PENDING, availableAt: { lte: new Date() } },
    data: { status: EarningStatus.AVAILABLE },
  });
}

export async function walletBalances(providerId: string): Promise<WalletBalances> {
  await releaseClearedEarnings(providerId);
  const grouped = await prisma.providerEarning.groupBy({
    by: ['status'],
    where: { providerId },
    _sum: { netMinor: true },
  });
  const sum = (status: EarningStatus) =>
    grouped.find((g) => g.status === status)?._sum.netMinor ?? 0;

  return {
    pendingMinor: sum(EarningStatus.PENDING),
    availableMinor: sum(EarningStatus.AVAILABLE),
    reservedMinor: sum(EarningStatus.RESERVED),
    onHoldMinor: sum(EarningStatus.ON_HOLD),
    withdrawnMinor: sum(EarningStatus.PAID),
    feeMinor: env.PAYOUT_FLAT_FEE_MINOR,
    minimumMinor: env.PAYOUT_MINIMUM_MINOR,
  };
}

/**
 * Quote a withdrawal before the provider commits to it, so the confirmation
 * screen can show exactly what leaves the wallet.
 */
export async function quoteWithdrawal(providerId: string, amountMinor: number) {
  const balances = await walletBalances(providerId);
  const feeMinor = env.PAYOUT_FLAT_FEE_MINOR;
  const totalMinor = amountMinor + feeMinor;
  return {
    amountMinor,
    feeMinor,
    totalMinor,
    availableMinor: balances.availableMinor,
    minimumMinor: env.PAYOUT_MINIMUM_MINOR,
    sufficient: totalMinor <= balances.availableMinor && amountMinor >= env.PAYOUT_MINIMUM_MINOR,
  };
}

/**
 * Reserve funds and record the request. Earnings are moved to RESERVED oldest
 * first until they cover amount + fee; the provider cannot spend or re-withdraw
 * them while the payout is in flight.
 */
export async function requestWithdrawal(input: {
  providerId: string;
  amountMinor: number;
  destination?: string;
  idempotencyKey?: string;
}) {
  const feeMinor = env.PAYOUT_FLAT_FEE_MINOR;
  const totalMinor = input.amountMinor + feeMinor;

  if (input.amountMinor < env.PAYOUT_MINIMUM_MINOR) {
    throw AppError.badRequest(
      `The smallest withdrawal is JMD ${(env.PAYOUT_MINIMUM_MINOR / 100).toLocaleString('en-JM')}.`,
      'BELOW_MINIMUM_WITHDRAWAL',
    );
  }

  if (input.idempotencyKey) {
    const existing = await prisma.providerPayout.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.providerEarning.updateMany({
        where: {
          providerId: input.providerId,
          status: EarningStatus.PENDING,
          availableAt: { lte: new Date() },
        },
        data: { status: EarningStatus.AVAILABLE },
      });

      const available = await tx.providerEarning.findMany({
        where: { providerId: input.providerId, status: EarningStatus.AVAILABLE },
        orderBy: { availableAt: 'asc' },
      });
      const availableMinor = available.reduce((s, e) => s + e.netMinor, 0);
      if (availableMinor < totalMinor) {
        throw AppError.badRequest(
          `Not enough available earnings. This withdrawal needs JMD ${(totalMinor / 100).toLocaleString('en-JM')} including the fee.`,
          'INSUFFICIENT_AVAILABLE_EARNINGS',
        );
      }

      const payout = await tx.providerPayout.create({
        data: {
          providerId: input.providerId,
          status: PayoutStatus.REQUESTED,
          amountMinor: input.amountMinor,
          feeMinor,
          reservedMinor: totalMinor,
          destination: input.destination,
          idempotencyKey: input.idempotencyKey,
        },
      });

      // Reserve whole earnings rows, oldest first, until the total is covered.
      let covered = 0;
      const reservedIds: string[] = [];
      for (const earning of available) {
        if (covered >= totalMinor) break;
        reservedIds.push(earning.id);
        covered += earning.netMinor;
      }
      await tx.providerEarning.updateMany({
        where: { id: { in: reservedIds } },
        data: { status: EarningStatus.RESERVED, payoutId: payout.id },
      });

      return payout;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Mark a payout settled. The reserved earnings become PAID and the withdrawal
 * fee is recorded as Voryn revenue. Any reserved amount beyond the payout
 * (whole rows rarely divide evenly) returns to available.
 */
export async function markPaid(payoutId: string) {
  return prisma.$transaction(async (tx) => {
    const payout = await tx.providerPayout.findUniqueOrThrow({ where: { id: payoutId } });
    if (payout.status === PayoutStatus.PAID) return payout;

    const reserved = await tx.providerEarning.findMany({ where: { payoutId: payout.id } });
    const reservedMinor = reserved.reduce((s, e) => s + e.netMinor, 0);
    const surplusMinor = reservedMinor - payout.reservedMinor;

    await tx.providerEarning.updateMany({
      where: { payoutId: payout.id },
      data: { status: EarningStatus.PAID, paidAt: new Date() },
    });

    // Rows are reserved whole, so the last one usually over-covers. Give the
    // difference back as a fresh available earning rather than absorbing it.
    if (surplusMinor > 0) {
      await tx.providerEarning.create({
        data: {
          providerId: payout.providerId,
          referenceType: 'payout-change',
          referenceId: `${payout.id}-change`,
          code: `CHANGE-${payout.id.slice(-6)}`,
          grossMinor: surplusMinor,
          commissionBps: 0,
          commissionMinor: 0,
          netMinor: surplusMinor,
          status: EarningStatus.AVAILABLE,
          availableAt: new Date(),
        },
      });
    }

    await tx.settlementRecord.createMany({
      data: [
        {
          referenceType: 'payout',
          referenceId: payout.id,
          entryType: 'WITHDRAWAL_FEE',
          amountMinor: payout.feeMinor,
          memo: `Bank withdrawal fee on payout ${payout.id.slice(-6)}`,
        },
      ],
      skipDuplicates: true,
    });

    return tx.providerPayout.update({
      where: { id: payout.id },
      data: { status: PayoutStatus.PAID, paidAt: new Date() },
    });
  });
}

/**
 * Return everything on a failed payout: the reserved earnings go back to
 * available, and the fee is never charged for a transfer that did not happen.
 */
export async function markFailed(payoutId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const payout = await tx.providerPayout.findUniqueOrThrow({ where: { id: payoutId } });
    if (payout.status === PayoutStatus.PAID) {
      throw AppError.badRequest('This payout has already been paid.', 'ALREADY_PAID');
    }
    await tx.providerEarning.updateMany({
      where: { payoutId: payout.id },
      data: { status: EarningStatus.AVAILABLE, payoutId: null },
    });
    return tx.providerPayout.update({
      where: { id: payout.id },
      data: { status: PayoutStatus.FAILED, failureReason: reason },
    });
  });
}

export const payoutsService = {
  walletBalances,
  quoteWithdrawal,
  requestWithdrawal,
  markPaid,
  markFailed,
};
