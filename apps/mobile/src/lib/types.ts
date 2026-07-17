/** Shared API response types used across screens. */

export type ProviderSummary = {
  id: string;
  name: string;
  slug: string;
  categories: string[];
  logoUrl: string | null;
  coverUrl: string | null;
  ratingAvg: number;
  ratingCount: number;
  isVerified: boolean;
};

export type Promotion = {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  type: 'PERCENT_OFF' | 'AMOUNT_OFF' | 'FREE_DELIVERY';
  value: number;
};

export type HomeFeed = {
  promotions: Promotion[];
  popular: ProviderSummary[];
  orderAgain: Array<{
    id: string;
    code: string;
    totalMinor: number;
    createdAt: string;
    provider: { id: string; name: string; categories: string[]; logoUrl: string | null };
  }>;
};

export type WalletSnapshot = {
  wallet: { id: string; balanceMinor: number; currency: string; status: string; hasPin: boolean };
  loyalty: { pointsBalance: number };
};

export type WalletTransaction = {
  id: string;
  type: string;
  status: string;
  amountMinor: number;
  balanceAfterMinor: number;
  description: string;
  counterpartyName: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
};

export type PaymentMethod = {
  id: string;
  type: 'VORYN_WALLET' | 'CARD' | 'CASH';
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
};

export type OrderFeedItem = {
  kind: 'order' | 'booking' | 'ride' | 'rental';
  id: string;
  code: string;
  title: string;
  subtitle: string;
  status: string;
  bucket: 'active' | 'completed' | 'scheduled' | 'cancelled';
  totalMinor: number;
  logoUrl: string | null;
  createdAt: string;
  etaLabel?: string;
};

export type OrdersFeed = {
  items: OrderFeedItem[];
  counts: { active: number; completed: number; scheduled: number; cancelled: number };
};

export type Restaurant = {
  id: string;
  name: string;
  cuisineTags: string[];
  description: string | null;
  imageUrl: string | null;
  deliveryFeeMinor: number;
  minDeliveryMinutes: number;
  maxDeliveryMinutes: number;
  isPromoted: boolean;
  providerId: string;
  provider: { id: string; name: string; logoUrl: string | null; ratingAvg: number; ratingCount: number; isVerified: boolean };
};

export type MenuItemOption = { id: string; groupName: string; name: string; priceDeltaMinor: number; isDefault: boolean };

export type ServicePackage = {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  includedItems: string[];
  isPopular: boolean;
};

export type ServiceListing = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  tags: string[];
  durationMinutes: number;
  supportsMobile: boolean;
  supportsAtShop: boolean;
  mobileFeeMinor: number;
  isEmergency: boolean;
  category: { id: string; vertical: string; name: string; slug: string };
  provider: {
    id: string;
    name: string;
    logoUrl: string | null;
    coverUrl?: string | null;
    ratingAvg: number;
    ratingCount: number;
    isVerified: boolean;
    branches?: Array<{ latitude: number; longitude: number; line1: string }>;
  };
  packages: ServicePackage[];
};

export type RentalVehicle = {
  id: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  plateNo: string | null;
  category: string;
  seats: number;
  bags: number;
  transmission: string;
  fuelType: string;
  features: string[];
  dailyRateMinor: number;
  depositMinor: number;
  imageUrl: string | null;
  pickupBranchName: string | null;
  ratingAvg: number;
  ratingCount: number;
  provider: { id: string; name: string; logoUrl: string | null; ratingAvg: number; isVerified?: boolean };
};

export type RentalAddOn = { key: string; name: string; priceMinorPerDay: number };

/** Full reservation payload from GET /v1/rentals/:id. */
export type RentalReservation = {
  id: string;
  code: string;
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'ACTIVE' | 'EXTENDED' | 'RETURN_PENDING' | 'COMPLETED' | 'CANCELLED';
  pickupAt: string;
  returnAt: string;
  pickupLocation: string;
  returnLocation: string;
  pickupCode: string;
  addOns: RentalAddOn[];
  driverName: string;
  licenseVerified: boolean;
  rentalFeeMinor: number;
  protectionMinor: number;
  serviceFeeMinor: number;
  totalMinor: number;
  depositMinor: number;
  depositStatus: 'pending' | 'held' | 'released';
  vehicle: {
    id: string;
    make: string;
    model: string;
    color: string | null;
    plateNo: string | null;
    transmission: string;
    fuelType: string;
    fuelPercent: number | null;
    odometerKm: number | null;
    dailyRateMinor: number;
    imageUrl: string | null;
    pickupBranchName: string | null;
  };
  provider: { id: string; name: string; logoUrl: string | null; isVerified: boolean; phone?: string | null };
  payment: { id: string; methodType: string; status: string } | null;
};

export type RentalReservationDetail = { reservation: RentalReservation; events: TrackingEvent[] };

export type TrackingEvent = {
  id: string;
  status: string;
  label: string;
  createdAt: string;
};

export type SessionProfileResponse = {
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    fullName: string;
    role: string;
    status: string;
  };
  profile: {
    username: string | null;
    avatarUrl: string | null;
    memberTier: string;
  } | null;
  wallet: { balanceMinor: number; currency: string } | null;
  loyalty: { pointsBalance: number } | null;
};
