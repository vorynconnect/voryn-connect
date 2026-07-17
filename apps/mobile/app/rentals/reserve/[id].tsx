import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmd, formatJmdCompact } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import type { RentalVehicle, WalletSnapshot } from '@/lib/types';

type AddOn = { key: string; name: string; priceMinorPerDay: number };
type Quote = {
  days: number;
  rentalFeeMinor: number;
  protectionMinor: number;
  serviceFeeMinor: number;
  totalMinor: number;
  depositMinor: number;
};

const ADD_ON_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  basic_protection: 'shield-checkmark-outline',
  full_protection: 'add-circle-outline',
  child_seat: 'accessibility-outline',
  extra_driver: 'person-add-outline',
};

/** Reserve Vehicle — confirm rental details, add-ons, payment. */
export default function ReserveVehicleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuth((s) => s.user);

  const [addOnKeys, setAddOnKeys] = useState<string[]>(['basic_protection']);
  const [payment, setPayment] = useState<'VORYN_WALLET' | 'CARD'>('VORYN_WALLET');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => `rental-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);

  // Pickup today 10:00, return tomorrow 10:00 (per landing card).
  const { pickupAt, returnAt } = useMemo(() => {
    const pickup = new Date();
    pickup.setHours(10, 0, 0, 0);
    if (pickup < new Date()) pickup.setDate(pickup.getDate() + 1);
    const ret = new Date(pickup.getTime() + 24 * 3600 * 1000);
    return { pickupAt: pickup, returnAt: ret };
  }, []);

  const vehicleQuery = useQuery({
    queryKey: ['rental-vehicle', id],
    queryFn: async () => {
      const res = await api<{ vehicles: RentalVehicle[] }>('/v1/discovery/rental-vehicles?limit=50');
      const vehicle = res.vehicles.find((v) => v.id === id);
      if (!vehicle) throw new Error('Vehicle not found');
      return vehicle;
    },
  });
  const addOnsQuery = useQuery({
    queryKey: ['rental-add-ons'],
    queryFn: () => api<{ addOns: AddOn[] }>('/v1/rentals/add-ons'),
  });
  const quoteQuery = useQuery({
    queryKey: ['rental-quote', id, addOnKeys],
    queryFn: () =>
      api<Quote>('/v1/rentals/quote', {
        method: 'POST',
        body: { vehicleId: id, pickupAt: pickupAt.toISOString(), returnAt: returnAt.toISOString(), addOnKeys },
      }),
    enabled: Boolean(id),
  });
  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSnapshot>('/v1/wallet') });

  const vehicle = vehicleQuery.data;
  const quote = quoteQuery.data;

  if (vehicleQuery.isLoading || addOnsQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Preparing your reservation…" />
      </View>
    );
  }
  if (!vehicle || vehicleQuery.isError) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => vehicleQuery.refetch()} />
      </View>
    );
  }

  const toggleAddOn = (key: string) => {
    setAddOnKeys((prev) => {
      let next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      // Protection tiers are mutually exclusive.
      if (key === 'full_protection' && next.includes('full_protection')) next = next.filter((k) => k !== 'basic_protection');
      if (key === 'basic_protection' && next.includes('basic_protection')) next = next.filter((k) => k !== 'full_protection');
      return next;
    });
  };

  const walletBalance = walletQuery.data?.wallet.balanceMinor ?? 0;
  const insufficient = payment === 'VORYN_WALLET' && quote != null && walletBalance < quote.totalMinor;

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await api<{ reservation: { id: string } }>('/v1/rentals/reserve', {
        method: 'POST',
        body: {
          vehicleId: id,
          pickupAt: pickupAt.toISOString(),
          returnAt: returnAt.toISOString(),
          addOnKeys,
          driverName: user?.fullName ?? 'Driver',
          paymentMethodType: payment,
          idempotencyKey,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders-feed'] }),
        queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      ]);
      router.replace({ pathname: '/rentals/confirmed/[id]', params: { id: result.reservation.id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete your reservation.');
    } finally {
      setSubmitting(false);
    }
  };

  const fmtDay = (d: Date) =>
    `${d.toDateString() === new Date().toDateString() ? 'Today' : 'Tomorrow'}, ${d.toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Reserve Vehicle</Text>
        <Text style={styles.subtitle}>Confirm your rental details</Text>

        {/* Vehicle summary */}
        <Card style={styles.vehicleCard}>
          <View style={styles.vehicleRow}>
            <Image source={{ uri: vehicle.imageUrl ?? undefined }} style={styles.vehicleImage} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.vehicleName}>
                {vehicle.make} {vehicle.model}
              </Text>
              <View style={styles.providerRow}>
                <Image source={{ uri: vehicle.provider.logoUrl ?? undefined }} style={styles.providerLogo} contentFit="cover" />
                <Text style={styles.providerName}>{vehicle.provider.name}</Text>
                <Ionicons name="star" size={12} color={colors.star} />
                <Text style={styles.providerRating}>{vehicle.provider.ratingAvg.toFixed(1)}</Text>
              </View>
              <View style={styles.specsRow}>
                <Text style={styles.specText}>{vehicle.seats} seats</Text>
                <Text style={styles.specText}>{vehicle.bags} bags</Text>
                <Text style={styles.specText}>{vehicle.transmission}</Text>
                <Text style={styles.specText}>{vehicle.fuelType}</Text>
              </View>
            </View>
            <View style={styles.priceBlock}>
              <Text style={styles.price}>{formatJmdCompact(vehicle.dailyRateMinor)}</Text>
              <Text style={styles.perDay}>/ day</Text>
            </View>
          </View>
        </Card>

        {/* Pickup / dates */}
        <Card style={styles.datesCard}>
          <View style={styles.dateRow}>
            <Ionicons name="location" size={19} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dateLabel}>Pickup location</Text>
              <Text style={styles.dateValue}>{vehicle.pickupBranchName ?? 'Provider location'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
          </View>
          <View style={styles.dateDivider} />
          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={19} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dateLabel}>Pickup</Text>
              <Text style={styles.dateValue}>{fmtDay(pickupAt)}</Text>
            </View>
            <Ionicons name="arrow-forward" size={15} color={colors.textSecondary} />
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={styles.dateLabel}>Return</Text>
              <Text style={styles.dateValue}>{fmtDay(returnAt)}</Text>
            </View>
          </View>
        </Card>

        {/* Driver */}
        <Card style={styles.driverCard}>
          <View style={styles.driverIcon}>
            <Ionicons name="card-outline" size={20} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateLabel}>Driver details (required)</Text>
            <Text style={styles.dateValue}>Driver: {user?.fullName ?? '—'}</Text>
          </View>
          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={13} color={colors.success} />
            <Text style={styles.verifiedText}>License verified</Text>
          </View>
        </Card>

        {/* Add-ons */}
        <Text style={styles.sectionTitle}>Add-ons</Text>
        <View style={styles.addOnGrid}>
          {(addOnsQuery.data?.addOns ?? []).map((addOn) => {
            const active = addOnKeys.includes(addOn.key);
            return (
              <View key={addOn.key} style={[styles.addOnCard, active && styles.addOnActive]}>
                <View style={styles.addOnIcon}>
                  <Ionicons name={ADD_ON_ICONS[addOn.key] ?? 'add-circle-outline'} size={20} color={colors.blue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addOnName}>{addOn.name}</Text>
                  <Text style={styles.addOnPrice}>{formatJmd(addOn.priceMinorPerDay)} / day</Text>
                </View>
                <Switch
                  value={active}
                  onValueChange={() => toggleAddOn(addOn.key)}
                  trackColor={{ true: colors.blue, false: colors.border }}
                />
              </View>
            );
          })}
        </View>

        {/* Payment */}
        <View style={styles.paymentHeader}>
          <Text style={styles.sectionTitle}>Payment method</Text>
          <View style={styles.secureChip}>
            <Text style={styles.secureChipText}>Secure payments</Text>
            <Ionicons name="shield-checkmark" size={15} color={colors.blue} />
          </View>
        </View>
        <View style={styles.paymentRow}>
          <Pressable
            style={[styles.paymentOption, payment === 'VORYN_WALLET' && styles.addOnActive]}
            onPress={() => setPayment('VORYN_WALLET')}
          >
            <Ionicons name="wallet-outline" size={19} color={colors.blue} />
            <Text style={styles.paymentText}>Voryn Wallet</Text>
            <Ionicons name="chevron-down" size={15} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            style={[styles.paymentOption, payment === 'CARD' && styles.addOnActive]}
            onPress={() => setPayment('CARD')}
          >
            <Ionicons name="pricetag-outline" size={19} color={colors.blue} />
            <Text style={styles.paymentText}>Card</Text>
            <Ionicons name="chevron-down" size={15} color={colors.textSecondary} />
          </Pressable>
        </View>
        {insufficient ? (
          <View style={styles.warnRow}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.warnText}>Insufficient wallet balance. Top up or pay by card.</Text>
          </View>
        ) : null}

        {/* Fare breakdown */}
        {quote ? (
          <Card style={styles.fareCard}>
            <Text style={styles.fareTitle}>Fare breakdown</Text>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>
                Rental fee ({quote.days} day{quote.days > 1 ? 's' : ''})
              </Text>
              <Text style={styles.fareValue}>{formatJmd(quote.rentalFeeMinor)}</Text>
            </View>
            {quote.protectionMinor > 0 ? (
              <View style={styles.fareRow}>
                <Text style={styles.fareLabel}>Protection & add-ons</Text>
                <Text style={styles.fareValue}>{formatJmd(quote.protectionMinor)}</Text>
              </View>
            ) : null}
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Service fee</Text>
              <Text style={styles.fareValue}>{formatJmd(quote.serviceFeeMinor)}</Text>
            </View>
            <View style={styles.fareTotalRow}>
              <Text style={styles.fareTotalLabel}>Subtotal (due now)</Text>
              <Text style={styles.fareTotal}>{formatJmd(quote.totalMinor)}</Text>
            </View>
            <View style={styles.depositRow}>
              <Ionicons name="information-circle-outline" size={16} color={colors.blue} />
              <Text style={styles.depositText}>
                <Text style={styles.depositStrong}>Refundable deposit</Text> (not charged now) — held and refunded after
                the vehicle is returned.
              </Text>
              <Text style={styles.depositValue}>{formatJmd(quote.depositMinor)}</Text>
            </View>
          </Card>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GradientButton title="Confirm reservation" onPress={confirm} loading={submitting} disabled={insufficient || !quote} />
        <View style={styles.footerRow}>
          <Ionicons name="lock-closed-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.footerText}>Secure, encrypted and trusted</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  vehicleCard: { marginBottom: spacing.md },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleImage: { width: 96, height: 66, borderRadius: radius.sm, backgroundColor: colors.skyTint },
  vehicleName: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  providerLogo: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.skyTint },
  providerName: { fontSize: fontSize.xs, color: colors.textSecondary },
  providerRating: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textPrimary },
  specsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  specText: { fontSize: fontSize.xs, color: colors.textSecondary },
  priceBlock: { alignItems: 'flex-end' },
  price: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.blue },
  perDay: { fontSize: fontSize.xs, color: colors.textSecondary },
  datesCard: { marginBottom: spacing.md },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dateLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  dateValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 1 },
  dateDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  driverCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.base, backgroundColor: colors.skyTint },
  driverIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.successTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  verifiedText: { color: colors.success, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  addOnGrid: { gap: spacing.sm, marginBottom: spacing.base },
  addOnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  addOnActive: { borderColor: colors.blue, backgroundColor: '#F4F9FF' },
  addOnIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addOnName: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  addOnPrice: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  paymentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  secureChip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.md },
  secureChipText: { fontSize: fontSize.sm, color: colors.textSecondary },
  paymentRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  paymentOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.base,
  },
  paymentText: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.dangerTint,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  warnText: { flex: 1, color: colors.danger, fontSize: fontSize.sm },
  fareCard: { marginBottom: spacing.base },
  fareTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  fareLabel: { fontSize: fontSize.base, color: colors.textSecondary },
  fareValue: { fontSize: fontSize.base, color: colors.textPrimary },
  fareTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
  },
  fareTotalLabel: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  fareTotal: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.blue },
  depositRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.skyTint,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  depositText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 16 },
  depositStrong: { fontWeight: fontWeight.bold, color: colors.textPrimary },
  depositValue: { fontSize: fontSize.sm, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  error: { color: colors.danger, textAlign: 'center', marginBottom: spacing.md },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: spacing.md },
  footerText: { fontSize: fontSize.sm, color: colors.textSecondary },
});
