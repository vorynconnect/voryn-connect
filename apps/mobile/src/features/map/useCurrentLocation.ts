import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import type { LatLng } from './geo';
import { reverseLabel } from './geocode';

/** Portmore town centre — where the map opens before a real fix arrives. */
export const DEFAULT_PICKUP: LatLng = { latitude: 17.9583, longitude: -76.8822 };

type CurrentLocation = {
  /** Real device fix, or DEFAULT_PICKUP until one arrives (never null). */
  point: LatLng;
  /** True once `point` is a real GPS/browser fix rather than the fallback. */
  isReal: boolean;
  /** Street-level label for the fix, e.g. "Braeton Parkway, Portmore". */
  label: string;
  /** True while an on-demand locate request is in flight. */
  locating: boolean;
  /**
   * Fresh, high-accuracy fix on demand (the locate button). Resolves the new
   * point, or null when permission is denied / the fix fails — callers should
   * tell the user instead of leaving them on the fallback silently.
   */
  refresh: () => Promise<LatLng | null>;
};

/** One position fix. `fresh` = no cached fixes, highest accuracy available. */
async function getFix(fresh: boolean): Promise<LatLng | null> {
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: fresh ? 0 : 60000 },
      );
    });
  }
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: fresh ? Location.Accuracy.High : Location.Accuracy.Balanced,
    });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * The user's real location: browser geolocation on web, expo-location on
 * device, falling back to Portmore centre when permission is denied or the
 * fix times out. The label reverse-geocodes so pickup reads like a place,
 * not a coordinate. `refresh()` re-requests a fresh high-accuracy fix — the
 * locate buttons call it so a denied-then-granted permission recovers.
 */
export function useCurrentLocation(): CurrentLocation {
  const [state, setState] = useState<Omit<CurrentLocation, 'refresh'>>({
    point: DEFAULT_PICKUP,
    isReal: false,
    label: 'Current location',
    locating: false,
  });
  const cancelledRef = useRef(false);

  const apply = useCallback(async (point: LatLng) => {
    const label = (await reverseLabel(point)) ?? 'Current location';
    if (!cancelledRef.current) {
      setState((prev) => ({ ...prev, point, isReal: true, label }));
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void getFix(false).then((point) => {
      if (point) void apply(point);
    });
    return () => {
      cancelledRef.current = true;
    };
  }, [apply]);

  const refresh = useCallback(async (): Promise<LatLng | null> => {
    if (!cancelledRef.current) setState((prev) => ({ ...prev, locating: true }));
    try {
      const point = await getFix(true);
      if (point) await apply(point);
      return point;
    } finally {
      if (!cancelledRef.current) setState((prev) => ({ ...prev, locating: false }));
    }
  }, [apply]);

  return { ...state, refresh };
}
