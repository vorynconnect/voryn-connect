import { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { PaymentProvider, PaymentStatus, WalletEntryType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { walletService } from './wallet.service';
import { assertCardPaymentsAvailable } from '../payments/payment.service';
import { MAX_REDEEM_PERCENT, POINT_VALUE_MINOR } from '../../lib/loyalty';

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
      loyalty: {
        pointsBalance: loyalty?.pointsBalance ?? 0,
        // 1 pt = JMD 1, redeemable at checkout for up to 20% of the eligible
        // amount. Points are loyalty rewards, never cash.
        pointValueMinor: POINT_VALUE_MINOR,
        maxRedeemPercent: MAX_REDEEM_PERCENT,
        cashConvertible: false,
      },
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
 * Points-to-cash conversion is not offered: freely convertible points would
 * make the programme behave like stored monetary value (a regulated payment
 * activity under BOJ rules). Points are redeemed at checkout as discounts.
 * Old app builds that still call this get a clear explanation.
 */
walletRouter.post('/redeem-points', (_req, _res, next) => {
  next(
    AppError.badRequest(
      'Voryn Points are redeemed at checkout for discounts (up to 20% of an eligible order). They cannot be converted to wallet cash.',
      'POINTS_NOT_CONVERTIBLE',
    ),
  );
});

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
