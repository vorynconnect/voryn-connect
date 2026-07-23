import type { TrackingSubjectType, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getIo } from '../../lib/realtime';

/**
 * Persists a status event and emits it to subscribed sockets. Important
 * order/trip state always lives in PostgreSQL — sockets are a projection.
 */
export async function recordTrackingEvent(input: {
  subjectType: TrackingSubjectType;
  subjectId: string;
  status: string;
  label: string;
  metadata?: Record<string, unknown>;
}) {
  const event = await prisma.trackingEvent.create({
    data: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: input.status,
      label: input.label,
      metadata: input.metadata as never,
    },
  });

  const io = getIo();
  if (io) {
    io.to(`track:${input.subjectType}:${input.subjectId}`).emit('track:event', {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: input.status,
      label: input.label,
      createdAt: event.createdAt,
    });
  }
  return event;
}

export async function recordLiveLocation(input: {
  subjectType: TrackingSubjectType;
  subjectId: string;
  actorUserId?: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speedKph?: number;
}) {
  const location = await prisma.liveLocation.create({ data: input });
  const io = getIo();
  if (io) {
    io.to(`track:${input.subjectType}:${input.subjectId}`).emit('track:location', {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      latitude: input.latitude,
      longitude: input.longitude,
      heading: input.heading,
      recordedAt: location.recordedAt,
    });
  }
  return location;
}

export async function listTrackingEvents(subjectType: TrackingSubjectType, subjectId: string) {
  return prisma.trackingEvent.findMany({
    where: { subjectType, subjectId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Authorization gate for realtime tracking subscriptions. Live GPS and status
 * events are broadcast to `track:{subjectType}:{subjectId}` rooms, so a socket
 * may only join a room for a trip/order/booking it is actually party to —
 * otherwise any authenticated user could follow a stranger's live location by
 * guessing an id. Ops staff (ADMIN/SUPER_ADMIN) may observe anything.
 */
export async function canAccessTracking(
  userId: string,
  role: UserRole,
  subjectType: TrackingSubjectType,
  subjectId: string,
): Promise<boolean> {
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return true;

  switch (subjectType) {
    case 'RIDE': {
      const trip = await prisma.rideTrip.findUnique({
        where: { id: subjectId },
        select: { request: { select: { customerId: true } }, driver: { select: { userId: true } } },
      });
      return !!trip && (trip.request.customerId === userId || trip.driver.userId === userId);
    }
    case 'ORDER': {
      const order = await prisma.order.findUnique({
        where: { id: subjectId },
        select: { customerId: true, courier: { select: { userId: true } } },
      });
      return !!order && (order.customerId === userId || order.courier?.userId === userId);
    }
    case 'BOOKING': {
      const booking = await prisma.serviceBooking.findUnique({
        where: { id: subjectId },
        select: { customerId: true, providerId: true },
      });
      if (!booking) return false;
      if (booking.customerId === userId) return true;
      return isProviderStaff(userId, booking.providerId);
    }
    case 'RENTAL': {
      const rental = await prisma.rentalReservation.findUnique({
        where: { id: subjectId },
        select: { customerId: true, providerId: true },
      });
      if (!rental) return false;
      if (rental.customerId === userId) return true;
      return isProviderStaff(userId, rental.providerId);
    }
    default:
      return false;
  }
}

async function isProviderStaff(userId: string, providerId: string): Promise<boolean> {
  const staff = await prisma.providerStaff.findFirst({
    where: { userId, providerId },
    select: { id: true },
  });
  return !!staff;
}
