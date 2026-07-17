import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { tokenStore } from './api';
import { WS_URL } from './config';

export type TrackEventPayload = {
  subjectType: string;
  subjectId: string;
  status: string;
  label: string;
  createdAt: string;
};

export type TrackLocationPayload = {
  subjectType: string;
  subjectId: string;
  latitude: number;
  longitude: number;
  heading?: number;
  recordedAt: string;
};

/**
 * Subscribes to real-time tracking for one subject (ride/order/booking/rental).
 * Falls back gracefully — callers should still poll their detail endpoint.
 */
export function useTracking(
  subjectType: 'RIDE' | 'ORDER' | 'BOOKING' | 'RENTAL',
  subjectId: string | undefined,
  handlers: {
    onEvent?: (event: TrackEventPayload) => void;
    onLocation?: (location: TrackLocationPayload) => void;
  },
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!subjectId) return;
    let socket: Socket | null = null;
    let cancelled = false;

    void (async () => {
      const token = await tokenStore.getAccess();
      if (!token || cancelled) return;
      socket = io(WS_URL, { auth: { token }, transports: ['websocket'] });
      socket.on('connect', () => {
        socket?.emit('track:subscribe', { subjectType, subjectId });
      });
      socket.on('track:event', (event: TrackEventPayload) => {
        if (event.subjectId === subjectId) handlersRef.current.onEvent?.(event);
      });
      socket.on('track:location', (location: TrackLocationPayload) => {
        if (location.subjectId === subjectId) handlersRef.current.onLocation?.(location);
      });
    })();

    return () => {
      cancelled = true;
      socket?.emit('track:unsubscribe', { subjectType, subjectId });
      socket?.disconnect();
    };
  }, [subjectType, subjectId]);
}
