import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { bearingBetween, haversineKm, type LatLng } from '@/features/map/geo';
import type { VehicleFix } from '@/features/map/useSmoothVehicle';
import type { DriverTrip } from './types';

const ONGOING = new Set([
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'ARRIVED',
  'IN_PROGRESS',
  'COURIER_ASSIGNED',
  'PICKED_UP',
  'ON_THE_WAY',
]);

const TICK_MS = 3500;
const SIM_SPEED_KMH = 40;
const PORTMORE: LatLng = { latitude: 17.9583, longitude: -76.8822 };

function legFor(trip: DriverTrip): { target: LatLng; hold: boolean } {
  const pickup: LatLng =
    trip.pickupLat != null && trip.pickupLng != null
      ? { latitude: trip.pickupLat, longitude: trip.pickupLng }
      : PORTMORE;
  const dropoff: LatLng =
    trip.dropoffLat != null && trip.dropoffLng != null
      ? { latitude: trip.dropoffLat, longitude: trip.dropoffLng }
      : PORTMORE;
  const toPickup =
    trip.kind === 'ride'
      ? trip.status === 'DRIVER_ASSIGNED' || trip.status === 'DRIVER_ARRIVING' || trip.status === 'ARRIVED'
      : trip.status === 'COURIER_ASSIGNED';
  // ARRIVED parks the vehicle at the pickup point until the trip starts.
  return { target: toPickup ? pickup : dropoff, hold: trip.status === 'ARRIVED' };
}

/**
 * Streams this driver's position to the API while a trip is ongoing so the
 * customer's map can follow the vehicle. Uses device GPS when available;
 * with no GPS (browser dev sessions, denied permission) it simulates driving
 * along the current leg so live tracking still demos end to end.
 *
 * Returns the latest published fix for rendering the driver's own marker.
 */
export function useDriverLocationPublisher(trip: DriverTrip | undefined | null): VehicleFix | null {
  const [fix, setFix] = useState<VehicleFix | null>(null);
  const simPosRef = useRef<LatLng | null>(null);

  const tripId = trip?.id;
  const kind = trip?.kind;
  const status = trip?.status;
  const active = trip != null && ONGOING.has(trip.status);

  useEffect(() => {
    if (!trip || !tripId || !kind || !active) return;
    let cancelled = false;
    let watcher: Location.LocationSubscription | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const publish = async (point: VehicleFix) => {
      if (cancelled) return;
      setFix(point);
      try {
        await api(`/v1/driver/trips/${tripId}/location`, {
          method: 'POST',
          body: {
            kind,
            latitude: point.latitude,
            longitude: point.longitude,
            ...(point.heading != null ? { heading: point.heading } : {}),
          },
        });
      } catch {
        // Best-effort ping — the next tick retries; the customer also polls.
      }
    };

    const startSimulator = () => {
      if (!simPosRef.current) {
        // Match the location the API seeds at accept time: a few blocks out.
        const { target } = legFor(trip);
        simPosRef.current = { latitude: target.latitude + 0.006, longitude: target.longitude + 0.004 };
      }
      const stepKm = (SIM_SPEED_KMH / 3600) * (TICK_MS / 1000);
      timer = setInterval(() => {
        const current = simPosRef.current!;
        const { target, hold } = legFor(trip);
        const remainingKm = haversineKm(current, target);
        if (hold || remainingKm * 1000 < 25) {
          void publish({ ...target, heading: null });
          simPosRef.current = target;
          return;
        }
        const t = Math.min(1, stepKm / remainingKm);
        const next: LatLng = {
          latitude: current.latitude + (target.latitude - current.latitude) * t,
          longitude: current.longitude + (target.longitude - current.longitude) * t,
        };
        simPosRef.current = next;
        void publish({ ...next, heading: bearingBetween(current, next) });
      }, TICK_MS);
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
        { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 15 },
        (position) =>
          void publish({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            heading:
              position.coords.heading != null && position.coords.heading >= 0 ? position.coords.heading : null,
          }),
      );
    };

    void start();
    return () => {
      cancelled = true;
      watcher?.remove();
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, kind, status, active]);

  return fix;
}
