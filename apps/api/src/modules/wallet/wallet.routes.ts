import { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { PaymentProvider, PaymentStatus, Prisma, WalletEntryType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { walletService, withSerializableRetry } from './wallet.service';
import { assertCardPaymentsAvailable } from '../payments/payment.service';

/** Loyalty conversion approved in the wallet mockup: 500 pts = JMD 250 off. */
const MINOR_PER_POINT = 50; // 1 pt = JMD 0.50

export const walletRouter = Router();
walletRouter.use(requireAuth);

walletRouter.get('/', async (req, res, next) => {
  try {
    const wallet = await walletService.getWallet(req.auth!.sub);
    const loyalty = await prisma.loyaltyAccount.findUnique({ where: { userId: req.auth!.sub } });
    res.json({
      wallet: {
        id: wallet.id,
        balanceMinor: wallet.balanceMinor,
        currency: wallet.currency,
        status: wallet.status,
        hasPin: Boolean(wallet.pinHash),
      },
      loyalty: { pointsBalance: loyalty?.pointsBalance ?? 0 },
    });
  } catch (err) {
    next(err);
  }
});

walletRouter.get(
  '/transactions',
  validate({ query: z.object({ cursor: z.string().optional(), limit: z.coerce.number().optional() }) }),
  async (req, res, next) => {
    try {
      const { cursor, limit } = req.query as { cursor?: string; limit?: number };
      res.json(await walletService.listTransactions(req.auth!.sub, { cursor, limit }));
    } catch (err) {
      next(err);
    }
  },
);

walletRouter.get('/transactions/:id', async (req, res, next) => {
  try {
    const wallet = await walletService.getWallet(req.auth!.sub);
    const transaction = await prisma.walletTransaction.findUnique({ where: { id: req.params.id } });
    if (!transaction || transaction.walletId !== wallet.id) {
      throw AppError.notFound('Transaction not found');
    }
    res.json({ transaction });
  } catch (err) {
    next(err);
  }
});

/**
 * Top-up: creates a payment intent, "captures" it via the sandbox card
 * gateway, and only credits the wallet after capture succeeds.
 */
walletRouter.post(
  '/top-up',
  validate({
    body: z.object({
      amountMinor: z.number().int().positive().max(100_000_000),
      paymentMethodId: z.string().optional(),
      idempotencyKey: z.string().min(8).max(128),
    }),
  }),
  async (req, res, next) => {
    try {
      const { amountMinor, paymentMethodId, idempotencyKey } = req.body;
      // Top-ups are card-funded; the sandbox gateway would mint free wallet
      // balance in production, so they stay off until a real gateway exists.
      assertCardPaymentsAvailable();

      const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
      if (existing) {
        // Safe retry: return prior outcome without re-charging.
        res.json({ payment: existing, retried: true });
        return;
      }

      const method = paymentMethodId
        ? await prisma.paymentMethod.findFirst({
            where: { id: paymentMethodId, userId: req.auth!.sub },
          })
        : null;
      if (paymentMethodId && !method) throw AppError.notFound('Payment method not found');

      // Sandbox card gateway: capture always succeeds in dev.
      const payment = await prisma.payment.create({
        data: {
          userId: req.auth!.sub,
          methodType: 'CARD',
          methodId: method?.id,
          provider: PaymentProvider.CARD_SANDBOX,
          status: PaymentStatus.CAPTURED,
          amountMinor,
          referenceType: 'topup',
          idempotencyKey,
          capturedAt: new Date(),
        },
      });

      // Credit only after the payment is captured.
      const entry = await walletService.credit({
        userId: req.auth!.sub,
        amountMinor,
        description: method ? `Top up from ${method.brand ?? 'card'}` : 'Top up',
        referenceType: 'topup',
        referenceId: payment.id,
        idempotencyKey: `topup:${payment.id}`,
      });

      res.status(201).json({ payment, transaction: entry });
    } catch (err) {
      next(err);
    }
  },
);

walletRouter.post(
  '/transfer',
  validate({
    body: z.object({
      recipientPhone: z.string().min(7),
      amountMinor: z.number().int().positive(),
      note: z.string().max(200).optional(),
      idempotencyKey: z.string().min(8).max(128),
    }),
  }),
  async (req, res, next) => {
    try {
      const recipient = await prisma.user.findFirst({
        where: { phone: req.body.recipientPhone, deletedAt: null },
      });
      if (!recipient) throw AppError.notFound('No Voryn Connect account with that phone number.');
      const result = await walletService.transfer({
        fromUserId: req.auth!.sub,
        toUserId: recipient.id,
        amountMinor: req.body.amountMinor,
        note: req.body.note,
        idempotencyKey: req.body.idempotencyKey,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

walletRouter.post(
  '/withdraw',
  validate({
    body: z.object({
      amountMinor: z.number().int().positive(),
      idempotencyKey: z.string().min(8).max(128),
    }),
  }),
  async (req, res, next) => {
    try {
      const entry = await walletService.debit({
        userId: req.auth!.sub,
        amountMinor: req.body.amountMinor,
        type: WalletEntryType.WITHDRAWAL,
        description: 'Withdrawal to bank',
        idempotencyKey: req.body.idempotencyKey,
      });
      res.status(201).json({ transaction: entry });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Redeem loyalty points as wallet credit. Points are debited and the wallet
 * credited inside one transaction; the loyalty ledger row is created first so
 * a retried request (same idempotency key) can be detected via the wallet
 * entry's idempotency key.
 */
walletRouter.post(
  '/redeem-points',
  validate({
    body: z.object({
      points: z.number().int().min(100).max(1_000_000),
      idempotencyKey: z.string().min(8).max(128),
    }),
  }),
  async (req, res, next) => {
    try {
      const { points, idempotencyKey } = req.body;
      const amountMinor = points * MINOR_PER_POINT;

      const result = await withSerializableRetry(() => prisma.$transaction(
        async (tx) => {
          const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey } });
          if (existing) return { transaction: existing, retried: true };

          const account = await tx.loyaltyAccount.findUnique({ where: { userId: req.auth!.sub } });
          if (!account) throw AppError.notFound('Loyalty account not found');
          if (account.pointsBalance < points) {
            throw AppError.badRequest('Not enough points to redeem.', 'INSUFFICIENT_POINTS');
          }

          const newPoints = account.pointsBalance - points;
          await tx.loyaltyAccount.update({
            where: { id: account.id },
            data: { pointsBalance: newPoints },
          });
          await tx.loyaltyTransaction.create({
            data: {
              accountId: account.id,
              type: 'REDEEM',
              points: -points,
              description: `Redeemed ${points} pts for wallet credit`,
            },
          });

          const wallet = await tx.wallet.findUnique({ where: { userId: req.auth!.sub } });
          if (!wallet || wallet.status !== 'ACTIVE') throw AppError.notFound('Wallet not found');
          const newBalance = wallet.balanceMinor + amountMinor;
          const entry = await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: WalletEntryType.PROMO_CREDIT,
              status: 'COMPLETED',
              amountMinor,
              balanceAfterMinor: newBalance,
              description: `Redeemed ${points} points`,
              idempotencyKey,
              completedAt: new Date(),
            },
          });
          await tx.wallet.update({ where: { id: wallet.id }, data: { balanceMinor: newBalance } });
          return { transaction: entry, pointsBalance: newPoints };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ));
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── Wallet PIN ──────────────────────────────────────────────

walletRouter.post(
  '/pin',
  validate({
    body: z.object({
      currentPin: z.string().regex(/^\d{4}$/).optional(),
      newPin: z.string().regex(/^\d{4}$/),
    }),
  }),
  async (req, res, next) => {
    try {
      const wallet = await walletService.getWallet(req.auth!.sub);
      if (wallet.pinHash) {
        if (!req.body.currentPin) {
          throw AppError.badRequest('Enter your current PIN to change it.', 'PIN_REQUIRED');
        }
        const ok = await argon2.verify(wallet.pinHash, req.body.currentPin);
        if (!ok) throw AppError.unauthorized('Incorrect current PIN.', 'PIN_INCORRECT');
      }
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: { pinHash: await argon2.hash(req.body.newPin) },
      });
      res.json({ message: 'Wallet PIN saved.', hasPin: true });
    } catch (err) {
      next(err);
    }
  },
);

walletRouter.post(
  '/pin/verify',
  validate({ body: z.object({ pin: z.string().regex(/^\d{4}$/) }) }),
  async (req, res, next) => {
    try {
      const wallet = await walletService.getWallet(req.auth!.sub);
      if (!wallet.pinHash) throw AppError.badRequest('No wallet PIN is set.', 'PIN_NOT_SET');
      const ok = await argon2.verify(wallet.pinHash, req.body.pin);
      if (!ok) throw AppError.unauthorized('Incorrect PIN.', 'PIN_INCORRECT');
      res.json({ verified: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── Payment methods ─────────────────────────────────────────

walletRouter.get('/payment-methods', async (req, res, next) => {
  try {
    const methods = await prisma.paymentMethod.findMany({
      where: { userId: req.auth!.sub },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ methods });
  } catch (err) {
    next(err);
  }
});

walletRouter.post(
  '/payment-methods',
  validate({
    body: z.object({
      // Tokenized reference from the card gateway SDK — raw PANs never touch this API.
      providerRef: z.string().min(4),
      brand: z.string().min(2).max(20),
      last4: z.string().length(4),
      expMonth: z.number().int().min(1).max(12),
      expYear: z.number().int().min(2024).max(2050),
      isDefault: z.boolean().default(false),
    }),
  }),
  async (req, res, next) => {
    try {
      const method = await prisma.$transaction(async (tx) => {
        if (req.body.isDefault) {
          await tx.paymentMethod.updateMany({
            where: { userId: req.auth!.sub },
            data: { isDefault: false },
          });
        }
        return tx.paymentMethod.create({
          data: { ...req.body, type: 'CARD', userId: req.auth!.sub },
        });
      });
      res.status(201).json({ method });
    } catch (err) {
      next(err);
    }
  },
);

walletRouter.delete('/payment-methods/:id', async (req, res, next) => {
  try {
    const method = await prisma.paymentMethod.findFirst({
      where: { id: req.params.id, userId: req.auth!.sub },
    });
    if (!method) throw AppError.notFound('Payment method not found');
    await prisma.paymentMethod.delete({ where: { id: method.id } });
    res.json({ message: 'Payment method removed.' });
  } catch (err) {
    next(err);
  }
});
