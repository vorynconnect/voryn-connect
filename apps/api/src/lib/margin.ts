import { PaymentMethodType } from '@prisma/client';
import { env } from '../config/env';

/**
 * Contribution-margin guard for a single transaction.
 *
 * Commission is not profit: card fees, refund exposure and payout costs come
 * out of it first. The rewards engine uses the amount left over — after those
 * costs and after Voryn's minimum profit per order — as a hard ceiling on how
 * much a points discount may absorb. Without it, a thin-margin order could be
 * discounted down to a loss even while staying inside the percentage caps.
 */

export type DirectCosts = {
  processingMinor: number;
  refundProvisionMinor: number;
  totalMinor: number;
};

/**
 * Variable costs Voryn carries on one transaction. Card payments carry gateway
 * fees; wallet and cash do not. Every order carries a refund/chargeback
 * provision, because some fraction of them come back.
 */
export function directTransactionCosts(input: {
  customerPaidMinor: number;
  orderValueMinor: number;
  paymentMethod: PaymentMethodType;
}): DirectCosts {
  const isCard = input.paymentMethod === PaymentMethodType.CARD;
  const processingMinor = isCard
    ? Math.round((input.customerPaidMinor * env.PAYMENT_PROCESSING_BPS) / 10_000) +
      env.PAYMENT_PROCESSING_FIXED_MINOR
    : 0;
  const refundProvisionMinor = Math.round(
    (input.orderValueMinor * env.REFUND_PROVISION_BPS) / 10_000,
  );
  return {
    processingMinor,
    refundProvisionMinor,
    totalMinor: processingMinor + refundProvisionMinor,
  };
}

/**
 * What a points discount may consume without pushing the order below Voryn's
 * minimum profit. Can be zero or negative on thin orders, in which case no
 * redemption is allowed at all.
 */
export function safeMarginMinor(input: {
  commissionMinor: number;
  customerPaidMinor: number;
  orderValueMinor: number;
  paymentMethod: PaymentMethodType;
}): number {
  const costs = directTransactionCosts(input);
  return input.commissionMinor - costs.totalMinor - env.MIN_PROFIT_PER_ORDER_MINOR;
}
