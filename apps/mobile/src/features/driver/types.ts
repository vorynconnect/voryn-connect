/** Driver dashboard API types (/v1/driver/*). */

export type DriverMe = {
  user: { id: string; fullName: string; avatarUrl: string | null };
  driver: {
    id: string;
    vehicleMake: string | null;
    vehicleModel: string | null;
    vehicleColor: string | null;
    plateNo: string | null;
    rideCategory: string;
    ratingAvg: number;
    ratingCount: number;
    tripsCount: number;
    isOnline: boolean;
  } | null;
  courier: {
    id: string;
    vehicleType: string;
    vehicleDesc: string | null;
    ratingAvg: number;
    ratingCount: number;
    isOnline: boolean;
  } | null;
  isOnline: boolean;
  walletBalanceMinor: number;
  memberSince: string;
};

export type DriverDashboard = {
  stats: {
    todayEarningsMinor: number;
    completedToday: number;
    acceptanceRate: number | null;
    ratingAvg: number;
    ratingCount: number;
    tripsCount: number;
  };
  pendingRequests: number;
  isOnline: boolean;
};

export type DriverRequest = {
  kind: 'ride' | 'delivery';
  id: string;
  customerName: string;
  customerAvatarUrl: string | null;
  pickupName: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffName: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  distanceKm: number | null;
  estimateMinor: number;
  category?: string;
  paymentMethodType?: string;
  itemsSummary?: string;
  createdAt: string;
};

export type DriverTrip = {
  kind: 'ride' | 'delivery';
  id: string;
  code: string;
  status: string;
  customerName: string;
  customerPhone: string | null;
  customerAvatarUrl: string | null;
  pickupName: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffName: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  distanceKm: number | null;
  estimateMinor: number;
  earningsMinor: number | null;
  paymentLabel: string;
  pickupCode?: string;
  itemsSummary?: string;
  when: string;
};

export type DriverEarnings = {
  summary: { todayMinor: number; weekMinor: number; monthMinor: number; weekDeltaPct: number | null };
  series: Array<{ label: string; valueMinor: number }>;
  breakdown: { rideMinor: number; deliveryMinor: number; tipsMinor: number; bonusesMinor: number };
  performance: { completedWeek: number; completedAll: number; ratingAvg: number };
  history: Array<{ kind: 'ride' | 'delivery'; code: string; earnedMinor: number; when: string }>;
};

/** Ride steps shown on the active-trip stepper (per mockup). */
export const RIDE_STEPS = [
  { key: 'DRIVER_ARRIVING', label: 'En route', icon: 'navigate' as const },
  { key: 'IN_PROGRESS', label: 'Picked up', icon: 'person' as const },
  { key: 'COMPLETED', label: 'Drop-off', icon: 'flag' as const },
];

export const DELIVERY_STEPS = [
  { key: 'PICKED_UP', label: 'Picked up', icon: 'bag-check' as const },
  { key: 'ON_THE_WAY', label: 'On the way', icon: 'navigate' as const },
  { key: 'DELIVERED', label: 'Delivered', icon: 'flag' as const },
];

/** Next-action CTA per current status. */
export const RIDE_CTA: Record<string, string> = {
  DRIVER_ASSIGNED: 'Start driving to pickup',
  DRIVER_ARRIVING: 'Arrived at pickup',
  ARRIVED: 'Start trip',
  IN_PROGRESS: 'Complete trip',
};

export const DELIVERY_CTA: Record<string, string> = {
  COURIER_ASSIGNED: 'Picked up order',
  PICKED_UP: 'Start delivery',
  ON_THE_WAY: 'Mark delivered',
};
