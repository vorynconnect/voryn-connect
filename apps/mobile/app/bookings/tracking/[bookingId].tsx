import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import { useTracking } from '@/lib/socket';
import { VERTICALS, type Vertical } from '@/features/services/config';
import { RateProviderCard } from '@/features/reviews/RateProviderCard';

type BookingDetail = {
  booking: {
    id: string;
    code: string;
    status: string;
    vertical: Vertical;
    packageName: string;
    locationType: string;
    addressName: string | null;
    latitude: number | null;
    longitude: number | null;
    totalMinor: number;
    deviceDescription: string | null;
    provider: { id: string; name: string; logoUrl: string | null; ratingAvg: number; phone: string | null };
    technician: { user: { fullName: string } } | null;
    appointment: { scheduledAt: string } | null;
    payment: { methodType: string } | null;
  };
  events: Array<{ id: string; status: string; label: string; createdAt: string }>;
  providerLocation: { latitude: number; longitude: number } | null;
};

const STEPS = [
  { key: 'BOOKED', label: 'Booked', icon: 'checkmark' },
  { key: 'ACCEPTED', label: 'Provider accepted', icon: 'checkmark' },
  { key: 'ON_THE_WAY', label: 'On the way', icon: 'car' },
  { key: 'IN_SERVICE', label: 'In service', icon: 'build' },
  { key: 'COMPLETED', label: 'Completed', icon: 'checkmark-done' },
] as const;

const PORTMORE = { latitude: 17.9583, longitude: -76.8822 };

export default function BookingTrackingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [liveLocation, setLiveLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const detailQuery = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => api<BookingDetail>(`/v1/bookings/${bookingId}`),
    refetchInterval: 10_000,
  });

  useTracking('BOOKING', bookingId, {
    onEvent: () => void detailQuery.refetch(),
    onLocation: (loc) => setLiveLocation({ latitude: loc.latitude, longitude: loc.longitude }),
  });

  if (detailQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading booking…" />
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

  const { booking, providerLocation } = detailQuery.data;
  const config = VERTICALS[booking.vertical];
  const cancelled = booking.status.startsWith('CANCELLED') || booking.status === 'NO_SHOW';
  const completed = booking.status === 'COMPLETED';
  const currentIndex = Math.max(
    0,
    STEPS.findIndex((s) => s.key === booking.status),
  );

  const providerPoint = liveLocation ?? providerLocation ?? { latitude: PORTMORE.latitude + 0.02, longitude: PORTMORE.longitude - 0.05 };
  const customerPoint =
    booking.latitude != null && booking.longitude != null
      ? { latitude: booking.latitude, longitude: booking.longitude }
      : PORTMORE;

  const subtitleByStatus: Record<string, string> = {
    BOOKED: `Waiting for ${booking.provider.name} to accept.`,
    ACCEPTED: `${booking.provider.name} accepted your booking.`,
    ON_THE_WAY: `Your ${config.trackingNoun} is on the way.`,
    IN_SERVICE: 'Service in progress.',
    COMPLETED: 'Service completed.',
  };

  const cancelBooking = async () => {
    await api(`/v1/bookings/${booking.id}/cancel`, { method: 'POST', body: {} });
    await queryClient.invalidateQueries({ queryKey: ['orders-feed'] });
    void detailQuery.refetch();
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Service tracking</Text>
        <Text style={styles.subtitle}>
          {cancelled ? 'This booking was cancelled.' : subtitleByStatus[booking.status] ?? 'Tracking your booking.'}
        </Text>

        {/* Map */}
        {!cancelled && !completed ? (
          <Card padded={false} style={styles.mapCard}>
            <MapView
              style={styles.map}
              initialRegion={{ ...customerPoint, latitudeDelta: 0.09, longitudeDelta: 0.09 }}
            >
              <Marker coordinate={providerPoint} title={booking.provider.name}>
                <View style={styles.providerMarker}>
                  <Ionicons name="car" size={16} color={colors.textOnBrand} />
                </View>
              </Marker>
              <Marker coordinate={customerPoint} title="Your location">
                <View style={styles.homeMarker}>
                  <Ionicons name="home" size={14} color={colors.textOnBrand} />
                </View>
              </Marker>
              <Polyline coordinates={[providerPoint, customerPoint]} strokeColor={colors.blue} strokeWidth={4} />
            </MapView>
            <View style={styles.mapFooter}>
              <View style={styles.mapStat}>
                <Text style={styles.mapStatLabel}>Live status</Text>
                <View style={styles.liveRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>
                    {STEPS.find((s) => s.key === booking.status)?.label ?? booking.status}
                  </Text>
                </View>
              </View>
              <View style={styles.mapDivider} />
              <View style={styles.mapStat}>
                <Text style={styles.mapStatLabel}>Current stage</Text>
                <Text style={styles.mapStatValue}>
                  {booking.status === 'ON_THE_WAY' ? 'Heading to your location' : subtitleByStatus[booking.status] ?? '—'}
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        {/* Progress steps */}
        <Card style={styles.stepsCard}>
          <View style={styles.stepsRow}>
            {STEPS.map((step, i) => {
              const done = i < currentIndex || completed;
              const current = i === currentIndex && !completed && !cancelled;
              return (
                <View key={step.key} style={styles.stepWrap}>
                  {i > 0 ? <View style={[styles.stepLine, (done || current) && styles.stepLineDone]} /> : null}
                  <View
                    style={[styles.stepDot, done && styles.stepDone, current && styles.stepCurrent, cancelled && i > 0 && styles.stepMuted]}
                  >
                    <Ionicons
                      name={done ? 'checkmark' : (step.icon as never)}
                      size={14}
                      color={done || current ? colors.textOnBrand : colors.textMuted}
                    />
                  </View>
                  <Text style={[styles.stepLabel, (done || current) && styles.stepLabelActive]} numberOfLines={2}>
                    {step.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card>

        {/* Provider / technician card */}
        <Card style={styles.personCard}>
          <View style={styles.personRow}>
            <Image source={{ uri: booking.provider.logoUrl ?? undefined }} style={styles.personAvatar} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <View style={styles.personNameRow}>
                <Text style={styles.personName}>{booking.technician?.user.fullName ?? booking.provider.name}</Text>
                <View style={styles.ratingBadge}>
                  <Ionicons name="star" size={11} color={colors.blue} />
                  <Text style={styles.ratingBadgeText}>{booking.provider.ratingAvg.toFixed(1)}</Text>
                </View>
              </View>
              <Text style={styles.personRole}>Certified {config.trackingNoun}</Text>
              <View style={styles.personVerifiedRow}>
                <Ionicons name="shield-checkmark-outline" size={13} color={colors.blue} />
                <Text style={styles.personVerified}>Verified provider</Text>
              </View>
            </View>
          </View>
          <View style={styles.personActions}>
            <Pressable
              style={styles.personAction}
              onPress={() => (booking.provider.phone ? Linking.openURL(`tel:${booking.provider.phone}`) : undefined)}
            >
              <Ionicons name="call-outline" size={17} color={colors.blue} />
              <Text style={styles.personActionText}>Call</Text>
            </Pressable>
            <Pressable style={styles.personAction} onPress={() => router.push('/profile-pages/support')}>
              <Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.blue} />
              <Text style={styles.personActionText}>Chat</Text>
            </Pressable>
          </View>
        </Card>

        {/* Order summary */}
        <Card style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle}>Order summary</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </View>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Provider</Text>
              <Text style={styles.summaryValue}>{booking.provider.name}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Order number</Text>
              <Text style={styles.summaryValue}>#{booking.code}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Service</Text>
              <Text style={styles.summaryValue}>{booking.packageName}</Text>
            </View>
            {booking.deviceDescription ? (
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Device</Text>
                <Text style={styles.summaryValue}>{booking.deviceDescription}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.summaryFooter}>
            <Text style={styles.summaryLabel}>
              Payment method{'  '}
              <Text style={styles.summaryValue}>{booking.payment?.methodType === 'VORYN_WALLET' ? 'Voryn Wallet' : booking.payment?.methodType ?? '—'}</Text>
            </Text>
            <Text style={styles.summaryTotal}>
              Total <Text style={styles.summaryTotalValue}>{formatJmd(booking.totalMinor)}</Text>
            </Text>
          </View>
        </Card>

        {/* Help & safety */}
        <View style={styles.helpRow}>
          <Pressable style={styles.helpCard} onPress={() => router.push('/profile-pages/support')}>
            <Ionicons name="help-buoy-outline" size={20} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.helpTitle}>Need help?</Text>
              <Text style={styles.helpBody}>Chat with support</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>
          <Pressable style={styles.helpCard} onPress={() => router.push('/profile-pages/support')}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.helpTitle}>Safety first</Text>
              <Text style={styles.helpBody}>Your safety is our priority</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>

        {completed ? (
          <RateProviderCard
            providerId={booking.provider.id}
            subjectType="SERVICE_BOOKING"
            subjectId={booking.id}
            title="How was your service?"
          />
        ) : null}

        {!cancelled && !completed && ['BOOKED', 'ACCEPTED'].includes(booking.status) ? (
          <Pressable style={styles.cancelButton} onPress={cancelBooking}>
            <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
            <Text style={styles.cancelText}>Cancel booking</Text>
          </Pressable>
        ) : null}

        <GradientButton
          title="View booking details"
          icon="document-text-outline"
          onPress={() => router.push('/(tabs)/orders')}
          style={{ marginTop: spacing.md }}
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
  mapCard: { overflow: 'hidden', marginBottom: spacing.base },
  map: { height: 230 },
  providerMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  homeMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  mapFooter: { flexDirection: 'row', alignItems: 'center', padding: spacing.base },
  mapStat: { flex: 1 },
  mapStatLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  mapStatValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 2 },
  mapDivider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: colors.border, marginHorizontal: spacing.md },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  liveText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.success },
  stepsCard: { marginBottom: spacing.base },
  stepsRow: { flexDirection: 'row' },
  stepWrap: { flex: 1, alignItems: 'center' },
  stepLine: {
    position: 'absolute',
    top: 14,
    left: '-50%',
    right: '50%',
    height: 3,
    backgroundColor: colors.border,
  },
  stepLineDone: { backgroundColor: colors.blue },
  stepDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  stepDone: { backgroundColor: colors.blue, borderColor: colors.blue },
  stepCurrent: { backgroundColor: colors.blue, borderColor: colors.skyTint },
  stepMuted: { opacity: 0.4 },
  stepLabel: { fontSize: 10, color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
  stepLabelActive: { color: colors.textPrimary, fontWeight: fontWeight.semibold },
  personCard: { marginBottom: spacing.base },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  personAvatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.skyTint },
  personNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  personName: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  ratingBadgeText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  personRole: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  personVerifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  personVerified: { fontSize: fontSize.xs, color: colors.blue },
  personActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  personAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  personActionText: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  summaryCard: { marginBottom: spacing.base },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  summaryTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  summaryItem: { width: '46%', flexGrow: 1 },
  summaryLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  summaryValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 2 },
  summaryFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.md,
  },
  summaryTotal: { fontSize: fontSize.sm, color: colors.textSecondary },
  summaryTotalValue: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  helpRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.base },
  helpCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.skyTint,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  helpTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  helpBody: { fontSize: fontSize.xs, color: colors.textSecondary },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: spacing.base,
  },
  cancelText: { color: colors.danger, fontWeight: fontWeight.bold, fontSize: fontSize.base },
});
