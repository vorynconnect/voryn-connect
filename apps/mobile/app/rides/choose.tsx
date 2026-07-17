import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { LiveTripMap } from '@/features/map/LiveTripMap';
import { DEFAULT_PICKUP } from '@/features/map/useCurrentLocation';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmdCompact } from '@/lib/format';

/** Server-authoritative fare quote — booked by id so the price can't drift. */
type Estimate = {
  quoteId: string;
  expiresAt: string;
  distanceKm: number;
  tripMinutes: number;
  categories: Array<{ category: 'ECONOMY' | 'COMFORT' | 'XL' | 'MOTO'; estimateMinor: number; etaMinutes: number | null }>;
};

const CATEGORY_META = {
  ECONOMY: { label: 'Economy', seats: 4, bags: 2, icon: 'car-sport' },
  COMFORT: { label: 'Comfort', seats: 4, bags: 2, icon: 'car' },
  XL: { label: 'XL', seats: 6, bags: 4, icon: 'bus' },
  MOTO: { label: 'Moto Quick', seats: 1, bags: 0, icon: 'bicycle' },
} as const;

/** "Choose your ride" — route preview, category prices, confirm. */
export default function ChooseRideScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    category?: string;
    destName: string;
    destLat: string;
    destLng: string;
    pickupName?: string;
    pickupLat?: string;
    pickupLng?: string;
  }>();
  const dropoff = { latitude: Number(params.destLat), longitude: Number(params.destLng) };
  const pickup =
    params.pickupLat && params.pickupLng
      ? { latitude: Number(params.pickupLat), longitude: Number(params.pickupLng) }
      : DEFAULT_PICKUP;
  const pickupName = params.pickupName ?? 'Current location';

  const [selected, setSelected] = useState<keyof typeof CATEGORY_META>(
    (params.category as keyof typeof CATEGORY_META) ?? 'ECONOMY',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The backend resolves the road route and prices it, returning a quote id
  // that confirmRide sends back — fares are entirely server-authoritative.
  const estimateQuery = useQuery({
    queryKey: ['ride-estimate', params.destLat, params.destLng, params.pickupLat, params.pickupLng],
    queryFn: () =>
      api<Estimate>('/v1/rides/estimate', {
        method: 'POST',
        body: {
          pickup: { name: pickupName, lat: pickup.latitude, lng: pickup.longitude },
          dropoff: { name: params.destName, lat: dropoff.latitude, lng: dropoff.longitude },
        },
      }),
  });

  const estimate = estimateQuery.data;
  const selectedEstimate = estimate?.categories.find((c) => c.category === selected);

  const confirmRide = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await api<{ request: { id: string } }>('/v1/rides/request', {
        method: 'POST',
        body: {
          category: selected,
          pickup: { name: pickupName, lat: pickup.latitude, lng: pickup.longitude },
          dropoff: { name: params.destName, lat: dropoff.latitude, lng: dropoff.longitude },
          paymentMethodType: 'VORYN_WALLET',
          quoteId: estimate?.quoteId,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['orders-feed'] });
      router.replace({ pathname: '/rides/searching/[requestId]', params: { requestId: result.request.id } });
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'QUOTE_EXPIRED' || err.code === 'QUOTE_USED')) {
        // Prices may have moved — pull a fresh quote and let the rider re-confirm.
        setError('Your fare quote expired, so we refreshed the price. Please confirm again.');
        await estimateQuery.refetch();
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not request your ride.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (estimateQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Calculating fares…" />
      </View>
    );
  }
  if (estimateQuery.isError || !estimate) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => estimateQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Choose your ride</Text>
        <Text style={styles.subtitle}>Select the ride that works best for you</Text>

        {/* Route summary */}
        <Card style={styles.routeCard}>
          <View style={styles.routeRow}>
            <View style={styles.routeIcons}>
              <View style={styles.pickupRing} />
              <View style={styles.routeDots} />
              <Ionicons name="location" size={18} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>Pickup</Text>
              <Text style={styles.routeValue} numberOfLines={1}>
                {pickupName}
              </Text>
              <View style={styles.routeDivider} />
              <Text style={styles.routeLabel}>Drop-off</Text>
              <Text style={styles.routeValue} numberOfLines={1}>
                {params.destName}
              </Text>
            </View>
          </View>
        </Card>

        {/* Map preview — real road route from pickup to destination */}
        <Card padded={false} style={styles.mapCard}>
          <LiveTripMap
            style={styles.map}
            pickup={pickup}
            dropoff={dropoff}
            pickupLabel={pickupName}
            dropoffLabel={params.destName}
            phase="toPickup"
            interactive={false}
          />
        </Card>

        {/* Categories */}
        <Card padded={false} style={styles.optionsCard}>
          {estimate.categories.map((option, i) => {
            const meta = CATEGORY_META[option.category];
            const active = selected === option.category;
            return (
              <Pressable
                key={option.category}
                style={[
                  styles.optionRow,
                  i < estimate.categories.length - 1 && styles.optionBorder,
                  active && styles.optionActive,
                ]}
                onPress={() => setSelected(option.category)}
              >
                <View style={styles.optionIcon}>
                  <Ionicons name={meta.icon} size={30} color={active ? colors.blue : colors.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>{meta.label}</Text>
                  <View style={styles.optionMetaRow}>
                    <Ionicons name="person-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.optionMeta}>{meta.seats}</Text>
                    <Ionicons name="briefcase-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.optionMeta}>{meta.bags}</Text>
                  </View>
                  <View style={styles.optionMetaRow}>
                    <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.optionMeta}>
                      {option.etaMinutes != null ? `Pickup in ~${option.etaMinutes} min` : 'No drivers nearby'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.optionPrice}>{formatJmdCompact(option.estimateMinor)}</Text>
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
              </Pressable>
            );
          })}
        </Card>

        {/* Payment + promo */}
        <View style={styles.payRow}>
          <Pressable style={styles.payCard} onPress={() => router.push('/(tabs)/wallet')}>
            <Ionicons name="wallet-outline" size={20} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.payLabel}>Pay with</Text>
              <Text style={styles.payValue}>Voryn Wallet</Text>
            </View>
            <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
          </Pressable>
          <Pressable style={styles.payCard}>
            <Ionicons name="pricetag-outline" size={20} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.payLabel}>Promo code</Text>
              <Text style={styles.payValue}>Add code</Text>
            </View>
            <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Arrival + distance */}
        <Card style={styles.statsCard}>
          <View style={styles.statItem}>
            <Ionicons name="time-outline" size={18} color={colors.blue} />
            <View>
              <Text style={styles.statLabel}>Trip duration</Text>
              <Text style={styles.statValue}>~{estimate.tripMinutes} min</Text>
            </View>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="git-branch-outline" size={18} color={colors.blue} />
            <View>
              <Text style={styles.statLabel}>Distance</Text>
              <Text style={styles.statValue}>{estimate.distanceKm} km</Text>
            </View>
          </View>
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GradientButton title="Confirm Ride" onPress={confirmRide} loading={submitting} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  routeCard: { marginBottom: spacing.md },
  routeRow: { flexDirection: 'row', gap: spacing.md },
  routeIcons: { alignItems: 'center', paddingTop: 4 },
  pickupRing: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: colors.blue },
  routeDots: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 4 },
  routeLabel: { fontSize: fontSize.xs, color: colors.blue, fontWeight: fontWeight.semibold },
  routeValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 1 },
  routeDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  mapCard: { overflow: 'hidden', marginBottom: spacing.md },
  map: { height: 190 },
  optionsCard: { marginBottom: spacing.md },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  optionBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  optionActive: { backgroundColor: '#F4F9FF' },
  optionIcon: { width: 56, alignItems: 'center' },
  optionLabel: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  optionMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  optionMeta: { fontSize: fontSize.sm, color: colors.textSecondary, marginRight: 6 },
  optionPrice: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.blue },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.blue },
  payRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  payCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  payLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  payValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 1 },
  statsCard: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.base },
  statItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statDivider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: colors.border, marginHorizontal: spacing.md },
  statLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  statValue: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  error: { color: colors.danger, textAlign: 'center', marginBottom: spacing.md },
});
