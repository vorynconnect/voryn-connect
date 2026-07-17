import { create } from 'zustand';

/**
 * Hand-off channel for the "choose on map" screen. The caller navigates to
 * /location/pick with a `token`, the picker publishes the confirmed location
 * under that token and goes back, and the caller consumes it exactly once.
 * (expo-router has no return-value channel between screens.)
 */
export type PickedLocation = {
  token: string;
  name: string;
  latitude: number;
  longitude: number;
};

type LocationPickState = {
  picked: PickedLocation | null;
  publish: (picked: PickedLocation) => void;
  consume: (token: string) => PickedLocation | null;
};

export const useLocationPick = create<LocationPickState>((set, get) => ({
  picked: null,
  publish: (picked) => set({ picked }),
  consume: (token) => {
    const current = get().picked;
    if (!current || current.token !== token) return null;
    set({ picked: null });
    return current;
  },
}));
