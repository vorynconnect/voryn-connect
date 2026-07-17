import { useEffect, useRef, useState } from 'react';
import { bearingBetween, haversineKm, type LatLng } from './geo';

export type VehicleFix = LatLng & { heading?: number | null };

type Rendered = { position: LatLng; bearing: number };

/**
 * Glides the vehicle between location fixes (Uber-style) instead of
 * teleporting it. Returns an interpolated position plus a bearing in
 * degrees (0 = north) derived from the fix heading or direction of travel.
 */
export function useSmoothVehicle(fix: VehicleFix | null | undefined): Rendered | null {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const currentRef = useRef<Rendered | null>(null);
  const frameRef = useRef<number | null>(null);

  const lat = fix?.latitude;
  const lng = fix?.longitude;
  const heading = fix?.heading ?? null;

  useEffect(() => {
    if (lat == null || lng == null) return;
    const to = { latitude: lat, longitude: lng };
    const from = currentRef.current?.position ?? to;
    const distanceM = haversineKm(from, to) * 1000;

    const fromBearing = currentRef.current?.bearing ?? heading ?? 0;
    const toBearing = heading ?? (distanceM > 3 ? bearingBetween(from, to) : fromBearing);
    const arc = ((toBearing - fromBearing + 540) % 360) - 180; // shortest rotation

    // First fix, or a jump after backgrounding: snap rather than glide across town.
    const duration = distanceM > 800 ? 0 : Math.min(2600, Math.max(600, distanceM * 12));
    const startedAt = Date.now();

    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    const step = () => {
      const t = duration === 0 ? 1 : Math.min(1, (Date.now() - startedAt) / duration);
      const next: Rendered = {
        position: {
          latitude: from.latitude + (to.latitude - from.latitude) * t,
          longitude: from.longitude + (to.longitude - from.longitude) * t,
        },
        bearing: (fromBearing + arc * t + 360) % 360,
      };
      currentRef.current = next;
      setRendered(next);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [lat, lng, heading]);

  return rendered;
}
