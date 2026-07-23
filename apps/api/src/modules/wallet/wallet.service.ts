import { Prisma, WalletEntryStatus, WalletEntryType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';

/**
 * Wallet ledger. Rules:
 *  - Every balance change is an immutable WalletTransaction row (credits
 *    positive, debits negative). Rows are never edited after COMPLETED;
 *    corrections happen via REVERSAL entries.
 *  - Balance mutations run inside SERIALIZABLE transactions that re-read the
 *    wallet row, so concurrent spends cannot overdraw.
 *  - Idempotency keys make retried requests safe: the original result is
 *    returned instead of double-applying.
 */

type LedgerInput = {
  userId: string;
  type: WalletEntryType;
  amountMinor: number; // signed
  description: string;
  counterpartyName?: string;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey?: string;
};

/**
 * Serializable transactions abort with a write conflict (P2034) under
 * concurrent load. That is expected — the correct response is to retry the
 * whole transaction, not to surface a 500. Idempotency keys make retries safe.
 */
export async function withSerializableRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isWriteConflict =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
      if (!isWriteConflict || attempt >= attempts) throw err;
    }
  }
}

async function applyEntry(input: LedgerInput) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor === 0) {
    throw AppError.badRequest('Invalid amount.', 'INVALID_AMOUNT');
  }

  return withSerializableRetry(() => prisma.$transaction(
    async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: input.userId } });
      if (!wallet) throw AppError.notFound('Wallet not found');

      if (input.idempotencyKey) {
        const existing = await tx.walletTransaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          // Safe retry only when the key belongs to this user's own wallet.
          if (existing.walletId !== wallet.id) {
            throw AppError.conflict('This request could not be processed. Please try again.', 'IDEMPOTENCY_CONFLICT');
          }
          return existing;
        }
      }

      if (wallet.status !== 'ACTIVE') {
        throw AppError.forbidden('Your wallet is not active. Contact support.', 'WALLET_INACTIVE');
      }

      const newBalance = wallet.balanceMinor + input.amountMinor;
      if (newBalance < 0) {
        throw AppError.badRequest('Insufficient wallet balance.', 'INSUFFICIENT_FUNDS');
      }

      const entry = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: input.type,
          status: WalletEntryStatus.COMPLETED,
          amountMinor: input.amountMinor,
          balanceAfterMinor: newBalance,
          description: input.description,
          counterpartyName: input.counterpartyName,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          idempotencyKey: input.idempotencyKey,
          completedAt: new Date(),
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceMinor: newBalance },
      });

      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: input.amountMinor > 0 ? 'wallet.credit' : 'wallet.debit',
          entity: 'WalletTransaction',
          entityId: entry.id,
          metadata: {
            type: input.type,
            amountMinor: input.amountMinor,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
          },
        },
      });

      return entry;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  ));
}

export const walletService = {
  async getWallet(userId: string) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw AppError.notFound('Wallet not found');
    return wallet;
  },

  async listTransactions(userId: string, opts: { cursor?: string; limit?: number } = {}) {
    const wallet = await this.getWallet(userId);
    const limit = Math.min(opts.limit ?? 20, 100);
    const transactions = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = transactions.length > limit;
    return {
      transactions: transactions.slice(0, limit),
      nextCursor: hasMore ? transactions[limit - 1]?.id : undefined,
    };
  },

  /** Credit after a confirmed top-up payment. Never call before payment capture. */
  credit(input: Omit<LedgerInput, 'type'> & { type?: WalletEntryType }) {
    if (input.amountMinor <= 0) throw AppError.badRequest('Credit amount must be positive.');
    return applyEntry({ ...input, type: input.type ?? WalletEntryType.TOP_UP });
  },

  /** Debit for purchases/transfers/withdrawals. Amount is passed positive. */
  debit(input: Omit<LedgerInput, 'type' | 'amountMinor'> & { amountMinor: number; type?: WalletEntryType }) {
    if (input.amountMinor <= 0) throw AppError.badRequest('Debit amount must be positive.');
    return applyEntry({
      ...input,
      type: input.type ?? WalletEntryType.PURCHASE,
      amountMinor: -input.amountMinor,
    });
  },

  /** Reverse a completed entry (refund to wallet, failed fulfillment, etc.). */
  async reverse(userId: string, transactionId: string, reason: string, idempotencyKey?: string) {
    return withSerializableRetry(() => prisma.$transaction(
      async (tx) => {
        const original = await tx.walletTransaction.findUnique({ where: { id: transactionId } });
        if (!original) throw AppError.notFound('Transaction not found');
        const wallet = await tx.wallet.findUnique({ where: { id: original.walletId } });
        if (!wallet || wallet.userId !== userId) throw AppError.notFound('Transaction not found');
        if (original.status !== WalletEntryStatus.COMPLETED) {
          throw AppError.badRequest('Only completed transactions can be reversed.');
        }
        const alreadyReversed = await tx.walletTransaction.findUnique({
          where: { reversalOfId: original.id },
        });
        if (alreadyReversed) return alreadyReversed;

        const newBalance = wallet.balanceMinor - original.amountMinor;
        if (newBalance < 0) {
          throw AppError.badRequest('Reversal would overdraw the wallet.', 'REVERSAL_BLOCKED');
        }

        const entry = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: WalletEntryType.REVERSAL,
            status: WalletEntryStatus.COMPLETED,
            amountMinor: -original.amountMinor,
            balanceAfterMinor: newBalance,
            description: `Reversal: ${reason}`,
            reversalOfId: original.id,
            referenceType: original.referenceType,
            referenceId: original.referenceId,
            idempotencyKey,
            completedAt: new Date(),
          },
        });
        await tx.wallet.update({ where: { id: wallet.id }, data: { balanceMinor: newBalance } });
        await tx.walletTransaction.update({
          where: { id: original.id },
          data: { status: WalletEntryStatus.REVERSED },
        });
        return entry;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ));
  },

  /** Peer-to-peer / customer-to-provider transfer. Atomic across both wallets. */
  async transfer(input: {
    fromUserId: string;
    toUserId: string;
    amountMinor: number;
    note?: string;
    idempotencyKey?: string;
  }) {
    if (input.amountMinor <= 0) throw AppError.badRequest('Transfer amount must be positive.');
    if (input.fromUserId === input.toUserId) {
      throw AppError.badRequest('You cannot transfer to yourself.');
    }
    return withSerializableRetry(() => prisma.$transaction(
      async (tx) => {
        const [from, to] = await Promise.all([
          tx.wallet.findUnique({ where: { userId: input.fromUserId }, include: { user: true } }),
          tx.wallet.findUnique({ where: { userId: input.toUserId }, include: { user: true } }),
        ]);
        if (!from || from.status !== 'ACTIVE') throw AppError.notFound('Wallet not found');
        if (!to || to.status !== 'ACTIVE') throw AppError.notFound('Recipient wallet not found');
        if (input.idempotencyKey) {
          const existing = await tx.walletTransaction.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
          });
          if (existing) {
            // Safe retry only when the key belongs to the sender's own wallet.
            if (existing.walletId !== from.id) {
              throw AppError.conflict('This request could not be processed. Please try again.', 'IDEMPOTENCY_CONFLICT');
            }
            return { debit: existing };
          }
        }
        if (from.balanceMinor < input.amountMinor) {
          throw AppError.badRequest('Insufficient wallet balance.', 'INSUFFICIENT_FUNDS');
        }

        const fromBalance = from.balanceMinor - input.amountMinor;
        const toBalance = to.balanceMinor + input.amountMinor;

        const debit = await tx.walletTransaction.create({
          data: {
            walletId: from.id,
            type: WalletEntryType.TRANSFER_OUT,
            status: WalletEntryStatus.COMPLETED,
            amountMinor: -input.amountMinor,
            balanceAfterMinor: fromBalance,
            description: input.note ?? `Transfer to ${to.user.fullName}`,
            counterpartyName: to.user.fullName,
            idempotencyKey: input.idempotencyKey,
            completedAt: new Date(),
          },
        });
        await tx.walletTransaction.create({
          data: {
            walletId: to.id,
            type: WalletEntryType.TRANSFER_IN,
            status: WalletEntryStatus.COMPLETED,
            amountMinor: input.amountMinor,
            balanceAfterMinor: toBalance,
            description: input.note ?? `Transfer from ${from.user.fullName}`,
            counterpartyName: from.user.fullName,
            completedAt: new Date(),
          },
        });
        await tx.wallet.update({ where: { id: from.id }, data: { balanceMinor: fromBalance } });
        await tx.wallet.update({ where: { id: to.id }, data: { balanceMinor: toBalance } });
        return { debit };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ));
  },
};
