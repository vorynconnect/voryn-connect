import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { RateProviderCard } from '@/features/reviews/RateProviderCard';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import type { RentalReservationDetail } from '@/lib/types';

function durationLabel(pickupAt: string, returnAt: string): string {
  const hours = Math.round((new Date(returnAt).getTime() - new Date(pickupAt).getTime()) / 3_600_000);
  if (hours < 24) return `${hours} hours`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${hours} hours` : `${days} day${days > 1 ? 's' : ''} ${rest}h`;
}

/** Rental complete — receipt, deposit release, and provider rating. */
export default function RentalCompleteScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuth((s) => s.user);

  const detailQuery = useQuery({
    queryKey: ['rental', id],
    queryFn: () => api<RentalReservationDetail>(`/v1/rentals/${id}`),
  });

  if (detailQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader />
        <LoadingState label="Loading receipt…" />
      </View>
    );
  }
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <View style={styles.flex}>
        <ScreenHeader />
        <ErrorState onRetry={() => detailQuery.refetch()} />
      </View>
    );
  }

  const { reservation } = detailQuery.data;
  const days = Math.max(1, Math.ceil((new Date(reservation.returnAt).getTime() - new Date(reservation.pickupAt).getTime()) / 86_400_000));
  const paymentLabel =
    reservation.payment?.methodType === 'VORYN_WALLET' ? 'Voryn Wallet' : reservation.payment?.methodType === 'CARD' ? 'Card' : 'Cash';
  const depositLabel = reservation.depositStatus === 'released' ? 'released' : 'pending';

  const summaryRows = [
    { icon: 'location' as const, label: 'Pickup location', value: reservation.pickupLocation },
    { icon: 'refresh' as const, label: 'Return location', value: reservation.returnLocation },
    { icon: 'calendar-outline' as const, label: 'Rental duration', value: durationLabel(reservation.pickupAt, reservation.returnAt) },
    {
      icon: 'car-outline' as const,
      label: 'Vehicle',
      value: `${reservation.vehicle.make} ${reservation.vehicle.model}${reservation.vehicle.color ? ` • ${reservation.vehicle.color}` : ''}`,
      badge: reservation.vehicle.plateNo,
    },
    { icon: 'person' as const, label: 'Driver / Customer', value: reservation.driverName || user?.fullName || '—' },
    { icon: 'wallet-outline' as const, label: 'Payment method', value: paymentLabel },
  ];

  const shareReceipt = () =>
    Share.share({
      title: `Voryn Connect receipt ${reservation.code}`,
      message: [
        `Voryn Connect — Rental receipt #${reservation.code}`,
        `${reservation.vehicle.make} ${reservation.vehicle.model} • ${reservation.provider.name} (third-party provider)`,
        `Rental fee (${days} day${days > 1 ? 's' : ''}): ${formatJmd(reservation.rentalFeeMinor)}`,
        `Protection: ${formatJmd(reservation.protectionMinor)}`,
        `Service fee: ${formatJmd(reservation.serviceFeeMinor)}`,
        `Total: ${formatJmd(reservation.totalMinor)}`,
        `Refundable deposit ${depositLabel}: ${formatJmd(reservation.depositMinor)}`,
      ].join('\n'),
    });

  return (
    <View style={styles.flex}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.container}>
        {/* Hero */}
        <View style={styles.heroWrap}>
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={50} color={colors.textOnBrand} />
          </View>
          <Text style={styles.title}>Rental complete</Text>
          <Text style={styles.subtitle}>Thanks for choosing Voryn Connect.</Text>
        </View>

        {/* Summary rows */}
        <Card padded={false} style={styles.summaryCard}>
          {summaryRows.map((row, i) => (
            <View key={row.label} style={[styles.summaryRow, i < summaryRows.length - 1 && styles.summaryBorder]}>
              <View style={styles.summaryIcon}>
                <Ionicons name={row.icon} size={19} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>{row.label}</Text>
                <Text style={styles.summaryValue}>{row.value}</Text>
              </View>
              {'badge' in row && row.badge ? (
                <View style={styles.plateBadge}>
                  <Text style={styles.plateText}>{row.badge}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </Card>

        {/* Fare breakdown */}
        <Card style={styles.fareCard}>
          <Text style={styles.sectionTitle}>Fare breakdown</Text>
          {(
            [
              { label: `Rental fee (${days} day${days > 1 ? 's' : ''})`, value: reservation.rentalFeeMinor },
              { label: 'Protection', value: reservation.protectionMinor },
              { label: 'Service fee', value: reservation.serviceFeeMinor },
            ] as const
          ).map((row) => (
            <View key={row.label} style={styles.fareRow}>
              <Text style={styles.fareLabel}>{row.label}</Text>
              <Text style={styles.fareValue}>{formatJmd(row.value)}</Text>
            </View>
          ))}
          <View style={styles.fareDivider} />
          <View style={styles.fareRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatJmd(reservation.totalMinor)}</Text>
          </View>
          <View style={styles.depositRow}>
            <View style={styles.depositIcon}>
              <Ionicons name="shield-checkmark" size={16} color={colors.blue} />
            </View>
            <Text style={styles.depositLabel}>Refundable deposit release</Text>
            <Text style={styles.depositValue}>
              {formatJmd(reservation.depositMinor)} {depositLabel}
            </Text>
          </View>
        </Card>

        {/* Vehicle condition */}
        <Card style={styles.conditionCard}>
          <View style={styles.conditionRow}>
            <View style={styles.conditionIcon}>
              <Ionicons name="car" size={22} color={colors.blue} />
              <View style={styles.conditionCheck}>
                <Ionicons name="checkmark" size={10} color={colors.textOnBrand} />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryLabel}>Vehicle condition</Text>
              <Text style={styles.conditionValue}>Returned successfully</Text>
            </View>
          </View>
        </Card>

        {/* Rating */}
        <RateProviderCard
          providerId={reservation.provider.id}
          subjectType="RENTAL_RESERVATION"
          subjectId={reservation.id}
          title="How was your rental?"
          subtitle="Rate your experience and help us improve."
        />

        {/* Actions */}
        <View style={styles.actionsRow}>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.replace({ pathname: '/rentals/vehicle/[id]', params: { id: reservation.vehicle.id } })}
          >
            <Ionicons name="refresh" size={17} color={colors.blue} />
            <Text style={styles.secondaryButtonText}>Book again</Text>
          </Pressable>
          <GradientButton title="Download receipt" icon="download-outline" style={{ flex: 1 }} onPress={shareReceipt} />
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
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
  },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: fontSize.md, color: colors.textSecondary, marginTop: 4, textAlign: 'center' },
  summaryCard: { marginBottom: spacing.md },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  summaryBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  summaryValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 1 },
  plateBadge: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  plateText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm, letterSpacing: 1 },
  fareCard: { marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  fareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  fareLabel: { fontSize: fontSize.base, color: colors.textSecondary },
  fareValue: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: fontWeight.semibold },
  fareDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  totalLabel: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  totalValue: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.blue },
  depositRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderStyle: 'dashed',
    paddingTop: spacing.md,
  },
  depositIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  depositLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: fontWeight.medium },
  depositValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.success },
  conditionCard: { marginBottom: spacing.md },
  conditionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  conditionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conditionCheck: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  conditionValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.success, marginTop: 1 },
  actionsRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginTop: spacing.md },
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
