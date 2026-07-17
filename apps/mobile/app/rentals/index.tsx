import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmdCompact } from '@/lib/format';
import type { RentalVehicle } from '@/lib/types';

const CATEGORY_FILTERS = [
  { key: null, label: 'All', icon: 'apps-outline' },
  { key: 'ECONOMY', label: 'Economy', icon: 'car-outline' },
  { key: 'SUV', label: 'SUV', icon: 'car-sport-outline' },
  { key: 'LUXURY', label: 'Luxury', icon: 'diamond-outline' },
  { key: 'VAN', label: 'Van', icon: 'bus-outline' },
] as const;

/** Rent a Vehicle landing + nearby vehicle grid + search results. */
export default function RentalsLandingScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const vehiclesQuery = useQuery({
    queryKey: ['rental-vehicles', submitted, category],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: '30' });
      if (submitted) qs.set('q', submitted);
      if (category) qs.set('category', category);
      return api<{ vehicles: RentalVehicle[] }>(`/v1/discovery/rental-vehicles?${qs}`);
    },
  });

  const vehicles = vehiclesQuery.data?.vehicles ?? [];
  const isSearch = submitted.length > 0;

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={vehiclesQuery.isRefetching} onRefresh={() => vehiclesQuery.refetch()} tintColor={colors.blue} />
        }
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{isSearch ? `${submitted.toUpperCase()} vehicles nearby` : 'Rent a Vehicle'}</Text>
            <Text style={styles.subtitle}>
              {isSearch
                ? `Available from third-party rental providers in Portmore`
                : 'Find trusted vehicles near you from verified providers.'}
            </Text>
          </View>
          <View style={styles.locationChip}>
            <Ionicons name="location" size={14} color={colors.blue} />
            <Text style={styles.locationText}>Portmore, Jamaica</Text>
            <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
          </View>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search vehicle name (e.g. Toyota Axio, Honda CR-V)"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => setSubmitted(search.trim())}
            returnKeyType="search"
          />
          {search ? (
            <Pressable
              onPress={() => {
                setSearch('');
                setSubmitted('');
              }}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </Pressable>
          ) : (
            <Ionicons name="options-outline" size={20} color={colors.blue} />
          )}
        </View>

        {!isSearch ? (
          <>
            {/* Pickup / return summary */}
            <Card style={styles.pickupCard}>
              <View style={styles.pickupRow}>
                <Ionicons name="location" size={20} color={colors.blue} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickupLabel}>Pickup location</Text>
                  <Text style={styles.pickupValue}>Portmore Mall</Text>
                </View>
                <Ionicons name="chevron-up" size={18} color={colors.textSecondary} />
              </View>
              <View style={styles.pickupDivider} />
              <View style={styles.pickupRow}>
                <Ionicons name="calendar-outline" size={20} color={colors.blue} />
                <Text style={styles.pickupValue}>Today, 10:00 AM</Text>
                <Ionicons name="arrow-forward" size={16} color={colors.textSecondary} />
                <Text style={styles.pickupValue}>Return • Tomorrow, 10:00 AM</Text>
              </View>
            </Card>

            {/* Nearby banner */}
            <View style={styles.nearbyBanner}>
              <Ionicons name="location" size={20} color={colors.textOnBrand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.nearbyTitle}>Vehicles nearby</Text>
                <Text style={styles.nearbyBody}>Available now in Portmore</Text>
              </View>
              <Pressable style={styles.mapButton}>
                <Ionicons name="map-outline" size={15} color={colors.blue} />
                <Text style={styles.mapButtonText}>View on map</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {/* Category filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {CATEGORY_FILTERS.map((f) => {
            const active = category === f.key;
            return (
              <Pressable
                key={f.label}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setCategory(f.key)}
              >
                <Ionicons name={f.icon} size={16} color={active ? colors.textOnBrand : colors.textPrimary} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {isSearch && vehiclesQuery.isSuccess ? (
          <View style={styles.resultsBadgeRow}>
            <View style={styles.resultsBadge}>
              <Text style={styles.resultsBadgeText}>{vehicles.length} results</Text>
            </View>
          </View>
        ) : null}

        {vehiclesQuery.isLoading ? <LoadingState label="Finding vehicles…" /> : null}
        {vehiclesQuery.isError ? <ErrorState onRetry={() => vehiclesQuery.refetch()} /> : null}
        {vehiclesQuery.isSuccess && vehicles.length === 0 ? (
          <EmptyState icon="car-outline" title="No vehicles available" body="Try another search or category." />
        ) : null}

        {/* Vehicle grid */}
        <View style={styles.grid}>
          {vehicles.map((vehicle, i) => (
            <Pressable
              key={vehicle.id}
              style={styles.vehicleCard}
              onPress={() => router.push({ pathname: '/rentals/vehicle/[id]', params: { id: vehicle.id } })}
            >
              <View>
                <Image source={{ uri: vehicle.imageUrl ?? undefined }} style={styles.vehicleImage} contentFit="cover" />
                <View style={styles.distanceBadge}>
                  <Text style={styles.distanceBadgeText}>{(0.6 + i * 0.3).toFixed(1)} km away</Text>
                </View>
              </View>
              <View style={styles.vehicleBody}>
                <View style={styles.providerRow}>
                  <Image source={{ uri: vehicle.provider.logoUrl ?? undefined }} style={styles.providerLogo} contentFit="cover" />
                  <Text style={styles.providerName} numberOfLines={1}>
                    {vehicle.provider.name}
                  </Text>
                  <Ionicons name="star" size={11} color={colors.star} />
                  <Text style={styles.providerRating}>{vehicle.provider.ratingAvg.toFixed(1)}</Text>
                </View>
                <View style={styles.vehicleNameRow}>
                  <Text style={styles.vehicleName} numberOfLines={1}>
                    {vehicle.make} {vehicle.model}
                  </Text>
                  <Text style={styles.vehiclePrice}>
                    {formatJmdCompact(vehicle.dailyRateMinor)}
                    <Text style={styles.perDay}> / day</Text>
                  </Text>
                </View>
                <View style={styles.specsRow}>
                  <View style={styles.spec}>
                    <Ionicons name="person-outline" size={12} color={colors.textSecondary} />
                    <Text style={styles.specText}>{vehicle.seats}</Text>
                  </View>
                  <View style={styles.spec}>
                    <Ionicons name="briefcase-outline" size={12} color={colors.textSecondary} />
                    <Text style={styles.specText}>{vehicle.bags}</Text>
                  </View>
                  <View style={styles.spec}>
                    <Ionicons name="cog-outline" size={12} color={colors.textSecondary} />
                    <Text style={styles.specText}>{vehicle.transmission}</Text>
                  </View>
                  <View style={styles.spec}>
                    <Ionicons name="flame-outline" size={12} color={colors.textSecondary} />
                    <Text style={styles.specText}>{vehicle.fuelType}</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Trust strip */}
        <Card style={styles.trustCard} padded={false}>
          <View style={styles.trustItem}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.trustTitle}>Third-party rental providers</Text>
              <Text style={styles.trustBody}>Trusted partners you can rely on</Text>
            </View>
          </View>
          <View style={styles.trustDivider} />
          <View style={styles.trustItem}>
            <Ionicons name="umbrella-outline" size={20} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.trustTitle}>Insurance options available</Text>
              <Text style={styles.trustBody}>Add extra protection with ease</Text>
            </View>
          </View>
        </Card>

        {!isSearch ? (
          <GradientButton
            title="Choose rental dates"
            icon="calendar-outline"
            onPress={() => setSubmitted(search.trim() || '')}
            style={{ marginTop: spacing.base }}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.base },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadow.card,
  },
  locationText: { color: colors.textPrimary, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: 4,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: fontSize.base, paddingVertical: spacing.md },
  pickupCard: { marginBottom: spacing.md },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pickupLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  pickupValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  pickupDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  nearbyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.blue,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.md,
    ...shadow.cta,
  },
  nearbyTitle: { color: colors.textOnBrand, fontSize: fontSize.md, fontWeight: fontWeight.heavy },
  nearbyBody: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.sm },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  mapButtonText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  chipsRow: { gap: spacing.sm, paddingBottom: spacing.base },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  chipActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipText: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.textOnBrand, fontWeight: fontWeight.bold },
  resultsBadgeRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.sm },
  resultsBadge: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  resultsBadgeText: { color: colors.blue, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  vehicleCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.card,
  },
  vehicleImage: { height: 110, backgroundColor: colors.skyTint },
  distanceBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  distanceBadgeText: { color: colors.textOnBrand, fontSize: 10, fontWeight: fontWeight.bold },
  vehicleBody: { padding: spacing.md },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  providerLogo: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.skyTint },
  providerName: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary },
  providerRating: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textPrimary },
  vehicleNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, gap: 4 },
  vehicleName: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  vehiclePrice: { fontSize: fontSize.sm, fontWeight: fontWeight.heavy, color: colors.blue },
  perDay: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.regular },
  specsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  spec: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  specText: { fontSize: fontSize.xs, color: colors.textSecondary },
  trustCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.base, marginTop: spacing.base },
  trustItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  trustDivider: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: colors.border, marginHorizontal: spacing.md },
  trustTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textPrimary },
  trustBody: { fontSize: 10, color: colors.textSecondary },
});
