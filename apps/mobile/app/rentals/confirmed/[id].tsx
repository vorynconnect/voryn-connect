import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

type ReservationDetail = {
  reservation: {
    id: string;
    code: string;
    status: string;
    pickupCode: string;
    pickupAt: string;
    returnAt: string;
    pickupLocation: string;
    vehicle: { make: string; model: string; color: string | null; dailyRateMinor: number; imageUrl: string | null };
    provider: { id: string; name: string; logoUrl: string | null; isVerified: boolean };
  };
};

/** Reservation confirmed — pickup code + instructions. */
export default function ReservationConfirmedScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const detailQuery = useQuery({
    queryKey: ['rental', id],
    queryFn: () => api<ReservationDetail>(`/v1/rentals/${id}`),
  });

  if (detailQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading reservation…" />
      </View>
    );
  }
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => detailQuery.refetch()} />
      </View>
    );
  }

  const { reservation } = detailQuery.data;
  const fmt = (iso: string) => {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return `${today ? 'Today' : d.toLocaleDateString('en-JM', { weekday: 'short' })}, ${d.toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' })}`;
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.heroWrap}>
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={54} color={colors.textOnBrand} />
          </View>
          <Text style={styles.title}>Reservation confirmed</Text>
          <Text style={styles.subtitle}>Your vehicle will be ready for pickup.</Text>
          <View style={styles.codeBadge}>
            <Text style={styles.codeBadgeText}>#{reservation.code}</Text>
          </View>
        </View>

        {/* Pickup code + vehicle */}
        <Card style={styles.pickupCard}>
          <View style={styles.pickupRow}>
            <View style={styles.pickupCodeBox}>
              <Text style={styles.pickupCodeLabel}>Pickup code</Text>
              <Text style={styles.pickupCode}>{reservation.pickupCode}</Text>
              <Text style={styles.pickupCodeHint}>Show this code to{'\n'}your provider</Text>
            </View>
            <Image source={{ uri: reservation.vehicle.imageUrl ?? undefined }} style={styles.vehicleImage} contentFit="cover" />
          </View>
        </Card>

        {/* Details grid */}
        <Card style={styles.detailsCard}>
          <View style={styles.detailsGrid}>
            <View style={styles.detailItem}>
              <Image source={{ uri: reservation.provider.logoUrl ?? undefined }} style={styles.providerLogo} contentFit="cover" />
              <View>
                <Text style={styles.detailValue}>{reservation.provider.name}</Text>
                <Text style={styles.detailLabel}>Trusted provider</Text>
              </View>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="location" size={19} color={colors.blue} />
              <View>
                <Text style={styles.detailLabel}>Pickup location</Text>
                <Text style={styles.detailValue}>{reservation.pickupLocation}</Text>
              </View>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="car-outline" size={19} color={colors.blue} />
              <View>
                <Text style={styles.detailValue}>
                  {reservation.vehicle.make} {reservation.vehicle.model}
                </Text>
                <Text style={styles.detailLabel}>{reservation.vehicle.color ?? 'Sedan'}</Text>
              </View>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="calendar-outline" size={19} color={colors.blue} />
              <View>
                <Text style={styles.detailValue}>{fmt(reservation.pickupAt)}</Text>
                <Text style={styles.detailLabel}>Return {fmt(reservation.returnAt)}</Text>
              </View>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="pricetag-outline" size={19} color={colors.blue} />
              <View>
                <Text style={[styles.detailValue, { color: colors.blue }]}>
                  {formatJmdCompact(reservation.vehicle.dailyRateMinor)} / day
                </Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Assurance chips */}
        <View style={styles.chipsRow}>
          {(
            [
              { icon: 'shield-checkmark', color: colors.success, tint: colors.successTint, label: "Driver's license verified" },
              { icon: 'card-outline', color: colors.blue, tint: colors.skyTint, label: 'Deposit pre-authorized' },
              { icon: 'headset-outline', color: colors.success, tint: colors.successTint, label: 'Support available 24/7' },
            ] as const
          ).map((chip) => (
            <Card key={chip.label} style={styles.assuranceChip}>
              <View style={[styles.assuranceIcon, { backgroundColor: chip.tint }]}>
                <Ionicons name={chip.icon} size={17} color={chip.color} />
              </View>
              <Text style={styles.assuranceText}>{chip.label}</Text>
            </Card>
          ))}
        </View>

        {/* Pickup instructions */}
        <Card style={styles.instructionsCard}>
          <Text style={styles.instructionsTitle}>Pickup instructions</Text>
          {[
            `Arrive at ${reservation.pickupLocation}.`,
            'Show your pickup code and driver’s license to the provider.',
            'Inspect the vehicle and confirm everything looks good before unlocking.',
          ].map((step, i) => (
            <View key={step} style={styles.stepRow}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </Card>

        <View style={styles.actionsRow}>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => Linking.openURL('https://maps.apple.com/?q=Portmore+Mall')}
          >
            <Ionicons name="location-outline" size={17} color={colors.blue} />
            <Text style={styles.secondaryButtonText}>Open in maps</Text>
          </Pressable>
          <GradientButton
            title="View rental"
            icon="car-outline"
            style={{ flex: 1 }}
            onPress={() => router.replace({ pathname: '/rentals/active/[id]', params: { id: reservation.id } })}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  heroWrap: { alignItems: 'center', marginBottom: spacing.lg },
  checkCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
  },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: fontSize.md, color: colors.textSecondary, marginTop: 4, textAlign: 'center' },
  codeBadge: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: 5,
    marginTop: spacing.md,
  },
  codeBadgeText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  pickupCard: { marginBottom: spacing.md },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pickupCodeBox: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.blue,
    borderRadius: radius.lg,
    padding: spacing.base,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  pickupCodeLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  pickupCode: { fontSize: 40, fontWeight: fontWeight.heavy, color: colors.blue, marginVertical: 2 },
  pickupCodeHint: { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center' },
  vehicleImage: { flex: 1, height: 130, borderRadius: radius.md, backgroundColor: colors.skyTint },
  detailsCard: { marginBottom: spacing.md },
  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.base },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, width: '46%', flexGrow: 1 },
  providerLogo: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.skyTint },
  detailLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  detailValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  chipsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  assuranceChip: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: spacing.md },
  assuranceIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  assuranceText: { fontSize: fontSize.xs, color: colors.textPrimary, textAlign: 'center', fontWeight: fontWeight.medium },
  instructionsCard: { marginBottom: spacing.base },
  instructionsTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { color: colors.textOnBrand, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  stepText: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 22 },
  actionsRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderColor: colors.blue,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.base },
});
