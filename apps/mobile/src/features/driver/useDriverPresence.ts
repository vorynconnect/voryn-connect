import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DriverMe } from './types';

const PRESENCE_INTERVAL_MS = 10_000;
const PORTMORE = { latitude: 17.9583, longitude: -76.8822 };

/**
 * Publishes this driver's real position to the backend while they are
 * online — this is what powers dispatch eligibility, honest pickup ETAs and
 * the customer's nearby-driver map. Native uses device GPS; web dev sessions
 * (no useful GPS at a desk) drift a simulated position around Portmore so the
 * two-browser test setup still exercises the real pipeline.
 */
export function useDriverPresence() {
  const meQuery = useQuery({
    queryKey: ['driver-me'],
    queryFn: () => api<DriverMe>('/v1/driver/me'),
    retry: false,
  });
  const isOnline = meQuery.data?.isOnline ?? false;
  // Couriers ping too — their presence scopes the delivery feed to reachable pickups.
  const hasProfile = meQuery.data?.driver != null || meQuery.data?.courier != null;
  const simPosRef = useRef<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (!isOnline || !hasProfile) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let watcher: Location.LocationSubscription | null = null;

    const publish = async (latitude: number, longitude: number, heading?: number | null) => {
      if (cancelled) return;
      try {
        await api('/v1/driver/location', {
          method: 'POST',
          body: { latitude, longitude, ...(heading != null && heading >= 0 ? { heading } : {}) },
        });
      } catch {
        // Best-effort ping; the next interval retries.
      }
    };

    const startSimulator = () => {
      if (!simPosRef.current) {
        simPosRef.current = {
          latitude: PORTMORE.latitude + (Math.random() - 0.5) * 0.02,
          longitude: PORTMORE.longitude + (Math.random() - 0.5) * 0.02,
        };
      }
      void publish(simPosRef.current.latitude, simPosRef.current.longitude);
      timer = setInterval(() => {
        const pos = simPosRef.current!;
        // Gentle drift so freshness and movement both stay realistic in dev.
        pos.latitude += (Math.random() - 0.5) * 0.0012;
        pos.longitude += (Math.random() - 0.5) * 0.0012;
        void publish(pos.latitude, pos.longitude);
      }, PRESENCE_INTERVAL_MS);
    };

    const start = async () => {
      if (Platform.OS === 'web') {
        startSimulator();
        return;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (permission.status !== 'granted') {
        startSimulator();
        return;
      }
      watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: PRESENCE_INTERVAL_MS, distanceInterval: 25 },
        (position) =>
          void publish(position.coords.latitude, position.coords.longitude, position.coords.heading),
      );
    };

    void start();
    return () => {
      cancelled = true;
      watcher?.remove();
      if (timer) clearInterval(timer);
    };
  }, [isOnline, hasProfile]);
}
