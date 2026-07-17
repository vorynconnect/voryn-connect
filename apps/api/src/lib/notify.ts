import type { NotificationType } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Notify every dashboard user (ProviderStaff) of a provider. Used when a
 * customer places an order/booking so the partner dashboard's bell and
 * notifications page reflect new work in near-real-time.
 */
export async function notifyProviderStaff(
  providerId: string,
  type: NotificationType,
  title: string,
  body: string,
): Promise<void> {
  const staff = await prisma.providerStaff.findMany({ where: { providerId }, select: { userId: true } });
  if (staff.length === 0) return;
  await prisma.notification.createMany({
    data: staff.map((s) => ({ userId: s.userId, type, title, body })),
  });
}
