import { useEffect, useState } from 'react';
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
};

/**
 * The user's real location: browser geolocation on web, expo-location on
 * device, falling back to Portmore centre when permission is denied or the
 * fix times out. The label reverse-geocodes so pickup reads like a place,
 * not a coordinate.
 */
export function useCurrentLocation(): CurrentLocation {
  const [state, setState] = useState<CurrentLocation>({
    point: DEFAULT_PICKUP,
    isReal: false,
    label: 'Current location',
  });

  useEffect(() => {
    let cancelled = false;

    const apply = async (point: LatLng) => {
      const label = (await reverseLabel(point)) ?? 'Current location';
      if (!cancelled) setState({ point, isReal: true, label });
    };

    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => void apply({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          () => {}, // denied/unavailable — keep the Portmore fallback
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
        );
      }
    } else {
      void (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') return;
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          await apply({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        } catch {
          // keep the fallback
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
