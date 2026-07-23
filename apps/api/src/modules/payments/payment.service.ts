import { PaymentMethodType, PaymentProvider, PaymentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { env } from '../../config/env';
import { walletService } from '../wallet/wallet.service';

/**
 * Card payments run through an auto-approving sandbox. In production that
 * would hand out goods/services (and wallet credit) with no real charge, so
 * they stay disabled until a real gateway integration replaces the sandbox.
 */
export function assertCardPaymentsAvailable(): void {
  if (env.NODE_ENV === 'production') {
    throw AppError.serviceUnavailable(
      'Card payments are coming soon. Please use your Voryn Wallet or cash.',
      'CARD_PAYMENTS_UNAVAILABLE',
    );
  }
}

/**
 * Unified payment entry point for orders, rides, bookings, and rentals.
 *  - VORYN_WALLET: debits the ledger atomically (fails on insufficient funds).
 *  - CARD: captures through the sandbox gateway (dev always approves).
 *  - CASH: recorded as PENDING and settled on fulfillment.
 * Callers must never mark their domain object paid/successful before this
 * returns a CAPTURED (or CASH-pending) payment.
 */
export async function takePayment(input: {
  userId: string;
  methodType: PaymentMethodType;
  amountMinor: number;
  referenceType: 'order' | 'ride' | 'booking' | 'rental';
  referenceId: string;
  description: string;
  counterpartyName?: string;
  idempotencyKey: string;
}) {
  if (input.amountMinor <= 0) throw AppError.badRequest('Invalid payment amount.');

  const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  if (input.methodType === PaymentMethodType.VORYN_WALLET) {
    // Debit first — throws INSUFFICIENT_FUNDS before any payment row exists.
    await walletService.debit({
      userId: input.userId,
      amountMinor: input.amountMinor,
      description: input.description,
      counterpartyName: input.counterpartyName,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: `pay:${input.idempotencyKey}`,
    });
    return prisma.payment.create({
      data: {
        userId: input.userId,
        methodType: input.methodType,
        provider: PaymentProvider.VORYN_WALLET,
        status: PaymentStatus.CAPTURED,
        amountMinor: input.amountMinor,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        capturedAt: new Date(),
      },
    });
  }

  if (input.methodType === PaymentMethodType.CARD) {
    // The sandbox gateway auto-approves, which is only safe in dev/test.
    // Until a real card gateway client is integrated, production must never
    // accept card payments — it would grant goods without charging anyone.
    assertCardPaymentsAvailable();
    return prisma.payment.create({
      data: {
        userId: input.userId,
        methodType: input.methodType,
        provider: PaymentProvider.CARD_SANDBOX,
        status: PaymentStatus.CAPTURED,
        amountMinor: input.amountMinor,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        capturedAt: new Date(),
      },
    });
  }

  // Cash on delivery / cash at shop — settled at fulfillment.
  return prisma.payment.create({
    data: {
      userId: input.userId,
      methodType: PaymentMethodType.CASH,
      provider: PaymentProvider.CASH,
      status: PaymentStatus.PENDING,
      amountMinor: input.amountMinor,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
    },
  });
}

/** Refund a captured payment; wallet payments are refunded to the wallet. */
export async function refundPayment(paymentId: string, reason: string, amountMinor?: number) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw AppError.notFound('Payment not found');
  if (payment.status !== PaymentStatus.CAPTURED) {
    throw AppError.badRequest('Only captured payments can be refunded.');
  }

  // Full refund by default; a smaller amount leaves a retained charge (e.g. a
  // cancellation fee) on the captured payment, which stays PARTIALLY_REFUNDED.
  const refundMinor = Math.min(payment.amountMinor, Math.max(0, amountMinor ?? payment.amountMinor));
  const isPartial = refundMinor < payment.amountMinor;

  if (refundMinor > 0 && payment.methodType === PaymentMethodType.VORYN_WALLET) {
    await walletService.credit({
      userId: payment.userId,
      amountMinor: refundMinor,
      type: 'REFUND',
      description: `Refund: ${reason}`,
      referenceType: payment.referenceType,
      referenceId: payment.referenceId ?? undefined,
      idempotencyKey: `refund:${payment.id}`,
    });
  }

  const [refund] = await prisma.$transaction([
    prisma.refund.create({
      data: { paymentId: payment.id, amountMinor: refundMinor, reason, status: 'PROCESSED', processedAt: new Date() },
    }),
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: isPartial ? PaymentStatus.PARTIALLY_REFUNDED : PaymentStatus.REFUNDED },
    }),
  ]);
  return refund;
}
