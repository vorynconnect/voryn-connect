import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmdCompact } from '@/lib/format';
import type { RentalVehicle } from '@/lib/types';

const FEATURE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'Air conditioning': 'snow-outline',
  Bluetooth: 'bluetooth-outline',
  'Backup camera': 'camera-outline',
  'Unlimited support': 'headset-outline',
};

/** Vehicle Details — review the car before booking. */
export default function VehicleDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const vehicleQuery = useQuery({
    queryKey: ['rental-vehicle', id],
    queryFn: async () => {
      const res = await api<{ vehicles: RentalVehicle[] }>('/v1/discovery/rental-vehicles?limit=50');
      const vehicle = res.vehicles.find((v) => v.id === id);
      if (!vehicle) throw new Error('Vehicle not found');
      return vehicle;
    },
  });

  if (vehicleQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading vehicle…" />
      </View>
    );
  }
  const vehicle = vehicleQuery.data;
  if (vehicleQuery.isError || !vehicle) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => vehicleQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Vehicle Details</Text>
        <Text style={styles.subtitle}>Review the car before booking</Text>

        <Card padded={false} style={styles.imageCard}>
          <Image source={{ uri: vehicle.imageUrl ?? undefined }} style={styles.image} contentFit="cover" />
        </Card>

        {/* Name + rate */}
        <Card style={styles.nameCard}>
          <View style={styles.nameRow}>
            <Image source={{ uri: vehicle.provider.logoUrl ?? undefined }} style={styles.providerLogo} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.vehicleName}>
                {vehicle.make} {vehicle.model}
              </Text>
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={13} color={colors.star} />
                <Text style={styles.ratingText}>{vehicle.ratingAvg.toFixed(1)}</Text>
                <Text style={styles.providerName}>• {vehicle.provider.name}</Text>
              </View>
            </View>
            <View style={styles.priceBlock}>
              <Text style={styles.price}>{formatJmdCompact(vehicle.dailyRateMinor)}</Text>
              <Text style={styles.perDay}>/ day</Text>
            </View>
          </View>
          <View style={styles.specsRow}>
            <View style={styles.spec}>
              <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.specText}>{vehicle.seats} seats</Text>
            </View>
            <View style={styles.spec}>
              <Ionicons name="briefcase-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.specText}>{vehicle.bags} bags</Text>
            </View>
            <View style={styles.spec}>
              <Ionicons name="cog-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.specText}>{vehicle.transmission}</Text>
            </View>
            <View style={styles.spec}>
              <Ionicons name="flame-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.specText}>{vehicle.fuelType}</Text>
            </View>
          </View>
        </Card>

        {/* Features */}
        <Card style={styles.featuresCard}>
          <View style={styles.featuresRow}>
            {vehicle.features.map((feature) => (
              <View key={feature} style={styles.feature}>
                <Ionicons name={FEATURE_ICONS[feature] ?? 'checkmark-circle-outline'} size={22} color={colors.blue} />
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Booking details */}
        <Text style={styles.sectionTitle}>Booking details</Text>
        <Card style={styles.bookingCard}>
          <View style={styles.bookingRow}>
            <View style={styles.bookingItem}>
              <Ionicons name="location" size={18} color={colors.blue} />
              <View>
                <Text style={styles.bookingLabel}>Pickup</Text>
                <Text style={styles.bookingValue}>{vehicle.pickupBranchName ?? 'Provider location'}</Text>
              </View>
            </View>
            <View style={styles.bookingDivider} />
            <View style={styles.bookingItem}>
              <Ionicons name="calendar-outline" size={18} color={colors.blue} />
              <View>
                <Text style={styles.bookingLabel}>Pickup time</Text>
                <Text style={styles.bookingValue}>Today, 10:00 AM</Text>
              </View>
            </View>
            <View style={styles.bookingDivider} />
            <View style={styles.bookingItem}>
              <Ionicons name="arrow-forward" size={18} color={colors.blue} />
              <View>
                <Text style={styles.bookingLabel}>Return</Text>
                <Text style={styles.bookingValue}>Tomorrow, 10:00 AM</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Protection */}
        <Text style={styles.sectionTitle}>Protection</Text>
        <Card style={styles.protectionCard}>
          <View style={styles.protectionIcon}>
            <Ionicons name="shield-checkmark" size={24} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.protectionTitle}>
              Basic Protection <Text style={styles.protectionIncluded}>(Included)</Text>
            </Text>
            <Text style={styles.protectionBody}>Covers collision damage and theft.</Text>
            <Text style={styles.protectionLink}>View details</Text>
          </View>
          <View style={styles.includedBadge}>
            <Ionicons name="checkmark-circle" size={13} color={colors.success} />
            <Text style={styles.includedText}>Included</Text>
          </View>
        </Card>

        {/* Rental terms */}
        <Text style={styles.sectionTitle}>Rental terms</Text>
        <Card padded={false} style={styles.termsCard}>
          {(
            [
              { icon: 'card-outline', title: "Valid driver's license is required", body: 'License must be valid in Jamaica.' },
              { icon: 'cash-outline', title: 'Refundable security deposit', body: 'A refundable deposit is required at pickup.' },
              { icon: 'close-circle-outline', title: 'Free cancellation before pickup', body: 'Cancel up to 2 hours before your pickup time.' },
            ] as const
          ).map((term, i, arr) => (
            <View key={term.title} style={[styles.termRow, i < arr.length - 1 && styles.termBorder]}>
              <View style={styles.termIcon}>
                <Ionicons name={term.icon} size={19} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.termTitle}>{term.title}</Text>
                <Text style={styles.termBody}>{term.body}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </View>
          ))}
        </Card>

        <GradientButton
          title="Reserve vehicle"
          onPress={() => router.push({ pathname: '/rentals/reserve/[id]', params: { id: vehicle.id } })}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  imageCard: { overflow: 'hidden', marginBottom: spacing.md },
  image: { height: 220, backgroundColor: colors.skyTint },
  nameCard: { marginBottom: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  providerLogo: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.skyTint },
  vehicleName: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  ratingText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  providerName: { fontSize: fontSize.sm, color: colors.textSecondary },
  priceBlock: { alignItems: 'flex-end' },
  price: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.blue },
  perDay: { fontSize: fontSize.sm, color: colors.textSecondary },
  specsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  spec: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  specText: { fontSize: fontSize.sm, color: colors.textPrimary },
  featuresCard: { marginBottom: spacing.base },
  featuresRow: { flexDirection: 'row', justifyContent: 'space-between' },
  feature: { flex: 1, alignItems: 'center', gap: 5 },
  featureText: { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center' },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  bookingCard: { marginBottom: spacing.base },
  bookingRow: { flexDirection: 'row', alignItems: 'center' },
  bookingItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bookingDivider: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: colors.border, marginHorizontal: spacing.sm },
  bookingLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  bookingValue: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 1 },
  protectionCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.base },
  protectionIcon: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  protectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  protectionIncluded: { color: colors.textSecondary, fontWeight: fontWeight.regular },
  protectionBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  protectionLink: { fontSize: fontSize.sm, color: colors.blue, fontWeight: fontWeight.semibold, marginTop: 4 },
  includedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.successTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  includedText: { color: colors.success, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  termsCard: { marginBottom: spacing.base },
  termRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  termBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  termIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  termTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  termBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
});
