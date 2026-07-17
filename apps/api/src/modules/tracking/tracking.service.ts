import type { TrackingSubjectType } from '@prisma/client';
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
