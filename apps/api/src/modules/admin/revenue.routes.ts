import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { POINT_VALUE_MINOR } from '../../lib/loyalty';
import { rewardsFund } from '../rewards/rewards.service';

/**
 * Revenue and loyalty reporting for the Voryn team.
 *
 * Revenue is reported per commission category plus withdrawal fees, and the
 * points programme is reported as its own set of accounts, because a single
 * blended wallet number hides whether the rewards programme is paying for
 * itself. The outstanding points figure is the liability an accountant needs
 * for IFRS 15 treatment.
 */
export const revenueRouter = Router();

revenueRouter.get(
  '/revenue',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) }),
  async (req, res, next) => {
    try {
      const since = new Date(Date.now() - Number(req.query.days) * 86_400_000);

      const [byCategory, withdrawalFees, pointsLedger, outstanding, pendingPoints, fundBalance] =
        await Promise.all([
          prisma.providerEarning.groupBy({
            by: ['category'],
            where: { createdAt: { gte: since }, status: { not: 'REVERSED' } },
            _sum: { grossMinor: true, commissionMinor: true, netMinor: true },
            _count: true,
          }),
          prisma.settlementRecord.aggregate({
            where: { entryType: 'WITHDRAWAL_FEE', createdAt: { gte: since } },
            _sum: { amountMinor: true },
          }),
          prisma.loyaltyTransaction.groupBy({
            by: ['type'],
            where: { createdAt: { gte: since } },
            _sum: { points: true },
          }),
          prisma.loyaltyAccount.aggregate({ _sum: { pointsBalance: true } }),
          prisma.loyaltyAccount.aggregate({ _sum: { pendingPoints: true } }),
          rewardsFund.balanceMinor(),
        ]);

      const commissionMinor = byCategory.reduce((s, r) => s + (r._sum.commissionMinor ?? 0), 0);
      const feeMinor = withdrawalFees._sum.amountMinor ?? 0;
      const pointsOf = (type: string) =>
        Math.abs(pointsLedger.find((p) => p.type === type)?._sum.points ?? 0);
      const redeemedPoints = pointsOf('REDEEM');
      const outstandingPoints = outstanding._sum.pointsBalance ?? 0;

      res.json({
        periodDays: Number(req.query.days),
        revenue: {
          byCategory: byCategory.map((r) => ({
            category: r.category ?? 'UNCATEGORISED',
            transactions: r._count,
            grossMinor: r._sum.grossMinor ?? 0,
            commissionMinor: r._sum.commissionMinor ?? 0,
            providerNetMinor: r._sum.netMinor ?? 0,
          })),
          commissionMinor,
          withdrawalFeeMinor: feeMinor,
          totalMinor: commissionMinor + feeMinor,
        },
        points: {
          issuedPoints: pointsOf('EARN'),
          pendingPoints: pendingPoints._sum.pendingPoints ?? 0,
          redeemedPoints,
          expiredPoints: pointsOf('EXPIRE'),
          // What redemptions actually cost Voryn over the period.
          redeemedCostMinor: redeemedPoints * POINT_VALUE_MINOR,
          // The liability: every unspent point, valued at its redemption rate.
          outstandingPoints,
          outstandingLiabilityMinor: outstandingPoints * POINT_VALUE_MINOR,
        },
        rewardsFundMinor: fundBalance,
        // The headline health check: rewards should stay a small fraction of
        // the commission they are funded from.
        rewardCostRatio:
          commissionMinor > 0 ? (redeemedPoints * POINT_VALUE_MINOR) / commissionMinor : 0,
      });
    } catch (err) {
      next(err);
    }
  },
);
