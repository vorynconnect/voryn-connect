import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { RateProviderCard } from '@/features/reviews/RateProviderCard';
import { TipCard } from '@/features/tips/TipCard';
import { LiveTripMap } from '@/features/map/LiveTripMap';
import type { VehicleFix } from '@/features/map/useSmoothVehicle';
import { vehicleKindForRide, vehicleLabel } from '@/features/map/vehicle';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import { useTracking } from '@/lib/socket';

type TripDetail = {
  trip: {
    id: string;
    code: string;
    status: string;
    pickupCode: string;
    baseFareMinor: number;
    distanceFareMinor: number;
    serviceFeeMinor: number;
    tipMinor: number;
    totalMinor: number;
    startedAt: string | null;
    completedAt: string | null;
    request: {
      pickupName: string;
      pickupLat: number;
      pickupLng: number;
      dropoffName: string;
      dropoffLat: number;
      dropoffLng: number;
      distanceKm: number | null;
      estimateMinor: number;
      paymentMethodType: string;
      customerId: string;
    };
    driver: {
      id: string;
      providerId: string | null;
      vehicleMake: string | null;
      vehicleModel: string | null;
      vehicleColor: string | null;
      plateNo: string | null;
      rideCategory: string;
      ratingAvg: number;
      tripsCount: number;
      user: { fullName: string; customerProfile: { avatarUrl: string | null } | null };
    };
  };
  events: Array<{ id: string; status: string; label: string; createdAt: string }>;
  driverLocation: { latitude: number; longitude: number; heading: number | null } | null;
  /** Authoritative backend ETA (road route from the driver's live position). */
  eta: {
    etaSeconds: number;
    etaMinutes: number;
    distanceMeters: number;
    source: 'route' | 'approximate';
    calculatedAt: string;
    driverLocationAt: string;
    stale: boolean;
  } | null;
};

/** Driver on the way / On your trip / Ride complete — one live screen. */
export default function RideTripScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [liveLocation, setLiveLocation] = useState<VehicleFix | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const tripQuery = useQuery({
    queryKey: ['ride-trip', tripId],
    queryFn: () => api<TripDetail>(`/v1/rides/trips/${tripId}`),
    refetchInterval: 8000,
  });

  useTracking('RIDE', tripId, {
    onEvent: () => void tripQuery.refetch(),
    onLocation: (loc) =>
      setLiveLocation({ latitude: loc.latitude, longitude: loc.longitude, heading: loc.heading ?? null }),
  });

  if (tripQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading your trip…" />
      </View>
    );
  }
  if (tripQuery.isError || !tripQuery.data) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => tripQuery.refetch()} />
      </View>
    );
  }

  const { trip, driverLocation, eta } = tripQuery.data;
  const pickup = { latitude: trip.request.pickupLat, longitude: trip.request.pickupLng };
  const dropoff = { latitude: trip.request.dropoffLat, longitude: trip.request.dropoffLng };
  const vehicleFix = liveLocation ?? driverLocation ?? null;
  const completed = trip.status === 'COMPLETED';
  const cancelled = trip.status.startsWith('CANCELLED');
  const inProgress = trip.status === 'IN_PROGRESS';
  const arriving = trip.status === 'DRIVER_ASSIGNED' || trip.status === 'DRIVER_ARRIVING';
  const arrived = trip.status === 'ARRIVED';
  const live = !completed && !cancelled;

  const vehicleKind = vehicleKindForRide(trip.driver.rideCategory);
  // Backend-authoritative ETA; a stale driver fix shows "Updating…" instead
  // of presenting an old number as current.
  const etaText = arrived ? 'Here now' : eta && !eta.stale ? `${eta.etaMinutes} min` : 'Updating…';

  const heading = completed
    ? 'Ride complete'
    : inProgress
      ? 'On your trip'
      : arrived
        ? 'Your driver is here'
        : 'Driver on the way';
  const subheading = completed
    ? 'You arrived at your destination.'
    : inProgress
      ? 'Sit back, relax. We’ll get you there.'
      : arrived
        ? `Meet ${trip.driver.user.fullName.split(' ')[0]} at the pickup point.`
        : 'Your driver is arriving soon. Please be ready.';

  const shareTrip = () =>
    Share.share({
      message: `I'm on a Voryn Connect ride (${trip.code}) with ${trip.driver.user.fullName} — ${trip.driver.vehicleMake} ${trip.driver.vehicleModel}, plate ${trip.driver.plateNo}.`,
    });

  const cancelRide = () =>
    setDialog({
      title: 'Cancel this ride?',
      message: `${trip.driver.user.fullName.split(' ')[0]} is on the way to your pickup. This will cancel the trip for both of you.`,
      confirmLabel: 'Cancel ride',
      destructive: true,
      onConfirm: async () => {
        setCancelling(true);
        try {
          await api(`/v1/rides/${trip.id}/cancel`, { method: 'POST', body: {} });
          await queryClient.invalidateQueries({ queryKey: ['orders-feed'] });
          await tripQuery.refetch();
        } catch (err) {
          setDialog({
            title: 'Could not cancel',
            message: err instanceof Error ? err.message : 'This trip can no longer be cancelled.',
          });
        } finally {
          setCancelling(false);
        }
      },
    });

  const driverCard = (
    <Card style={styles.driverCard}>
      <View style={styles.driverRow}>
        {trip.driver.user.customerProfile?.avatarUrl ? (
          <Avatar uri={trip.driver.user.customerProfile.avatarUrl} name={trip.driver.user.fullName} size={60} />
        ) : (
          <View style={styles.driverAvatar}>
            <Ionicons name="person" size={30} color={colors.blue} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.driverNameRow}>
            <Text style={styles.driverName}>{trip.driver.user.fullName}</Text>
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={11} color={colors.blue} />
              <Text style={styles.ratingBadgeText}>{trip.driver.ratingAvg.toFixed(1)}</Text>
            </View>
          </View>
          <Text style={styles.driverMeta}>
            {trip.driver.vehicleMake} {trip.driver.vehicleModel}
            {trip.driver.vehicleColor ? ` • ${trip.driver.vehicleColor}` : ''} • {vehicleLabel(vehicleKind)}
          </Text>
          <Text style={styles.driverTrips}>{trip.driver.tripsCount.toLocaleString()} trips</Text>
        </View>
        {trip.driver.plateNo ? (
          <View style={styles.plateBox}>
            <Text style={styles.plateText}>{trip.driver.plateNo}</Text>
          </View>
        ) : null}
      </View>
      {live ? (
        <View style={styles.driverActions}>
          <Pressable style={styles.driverAction} onPress={shareTrip}>
            <Ionicons name="share-outline" size={17} color={colors.blue} />
            <Text style={styles.driverActionText}>Share trip</Text>
          </Pressable>
          <Pressable style={styles.driverAction} onPress={() => router.push('/profile-pages/support')}>
            <Ionicons name="shield-checkmark-outline" size={17} color={colors.blue} />
            <Text style={styles.driverActionText}>Safety</Text>
          </Pressable>
          <Pressable
            style={styles.driverAction}
            onPress={() =>
              router.push({
                pathname: '/chat',
                params: {
                  context: 'RIDE',
                  referenceId: trip.id,
                  title: trip.driver.user.fullName,
                  avatarUrl: trip.driver.user.customerProfile?.avatarUrl ?? '',
                },
              })
            }
          >
            <Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.blue} />
            <Text style={styles.driverActionText}>Chat</Text>
          </Pressable>
          <Pressable style={styles.driverAction} onPress={() => router.push('/profile-pages/support')}>
            <Ionicons name="call-outline" size={17} color={colors.blue} />
            <Text style={styles.driverActionText}>Call</Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );

  const fareCard = (
    <Card style={styles.fareCard}>
      <Text style={styles.fareTitle}>{completed ? 'Fare breakdown' : 'Trip details'}</Text>
      {completed ? (
        <>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Base fare</Text>
            <Text style={styles.fareValue}>{formatJmd(trip.baseFareMinor)}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Distance ({trip.request.distanceKm ?? '—'} km)</Text>
            <Text style={styles.fareValue}>{formatJmd(trip.distanceFareMinor)}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Service fee</Text>
            <Text style={styles.fareValue}>{formatJmd(trip.serviceFeeMinor)}</Text>
          </View>
          {trip.tipMinor > 0 ? (
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Tip</Text>
              <Text style={styles.fareValue}>{formatJmd(trip.tipMinor)}</Text>
            </View>
          ) : null}
          <View style={styles.fareTotalRow}>
            <Text style={styles.fareTotalLabel}>Total</Text>
            <View style={styles.paidRow}>
              <Text style={styles.fareTotal}>{formatJmd(trip.totalMinor)}</Text>
              <View style={styles.paidBadge}>
                <Ionicons name="checkmark-circle" size={12} color={colors.success} />
                <Text style={styles.paidText}>Paid</Text>
              </View>
            </View>
          </View>
        </>
      ) : (
        <>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Pickup</Text>
            <Text style={styles.fareValue}>{trip.request.pickupName}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Destination</Text>
            <Text style={styles.fareValue}>{trip.request.dropoffName}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Payment method</Text>
            <Text style={styles.fareValue}>
              {trip.request.paymentMethodType === 'VORYN_WALLET' ? 'Voryn Wallet' : trip.request.paymentMethodType}
            </Text>
          </View>
          <View style={styles.fareTotalRow}>
            <Text style={styles.fareTotalLabel}>Estimated fare</Text>
            <Text style={styles.fareTotal}>{formatJmd(trip.request.estimateMinor)}</Text>
          </View>
        </>
      )}
    </Card>
  );

  // ── Uber-style live layout: full-screen map + bottom sheet ──
  if (live) {
    return (
      <View style={styles.flex}>
        <LiveTripMap
          style={StyleSheet.absoluteFill}
          pickup={pickup}
          dropoff={dropoff}
          pickupLabel={trip.request.pickupName}
          dropoffLabel={trip.request.dropoffName}
          vehicleKind={vehicleKind}
          vehicleFix={vehicleFix}
          phase={inProgress ? 'toDropoff' : 'toPickup'}
          bottomPadding={SHEET_HEIGHT}
        />

        <View style={[styles.floatRow, { top: insets.top + spacing.md }]} pointerEvents="box-none">
          <Pressable style={styles.floatButton} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}>
            <Ionicons name="arrow-back" size={20} color={colors.navy} />
          </Pressable>
          <Pressable style={styles.floatChip} onPress={() => router.push('/profile-pages/support')}>
            <Ionicons name="headset-outline" size={15} color={colors.blue} />
            <Text style={styles.floatChipText}>Support</Text>
          </Pressable>
        </View>

        <View style={[styles.sheet, { height: SHEET_HEIGHT + insets.bottom }]}>
          <View style={styles.sheetHandle} />
          <ScrollView contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHeadRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{heading}</Text>
                <Text style={styles.subtitle}>{subheading}</Text>
              </View>
              <View style={styles.etaPill}>
                <View style={styles.liveDot} />
                <Text style={styles.etaPillText}>{etaText}</Text>
              </View>
            </View>

            {arriving || arrived ? (
              <Card style={styles.codeCard}>
                <View style={styles.routeRow}>
                  <View style={styles.routeIcons}>
                    <View style={styles.pickupDot} />
                    <View style={styles.routeDots} />
                    <View style={styles.destDot} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeValue}>{trip.request.pickupName}</Text>
                    <Text style={styles.routeSub}>Portmore, St. Catherine</Text>
                    <View style={{ height: spacing.md }} />
                    <Text style={styles.routeValue}>{trip.request.dropoffName}</Text>
                  </View>
                  <View style={styles.pickupCodeBox}>
                    <Text style={styles.pickupCodeLabel}>Pickup code</Text>
                    <Text style={styles.pickupCode}>{trip.pickupCode}</Text>
                    <Text style={styles.pickupCodeHint}>Show this code{'\n'}to your driver</Text>
                  </View>
                </View>
              </Card>
            ) : null}

            {driverCard}
            {fareCard}

            {!inProgress ? (
              <Pressable style={styles.cancelButton} onPress={cancelRide} disabled={cancelling}>
                <Ionicons name="close-circle-outline" size={19} color={colors.danger} />
                <Text style={styles.cancelText}>{cancelling ? 'Cancelling…' : 'Cancel ride'}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>

        <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />
      </View>
    );
  }

  // ── Completed / cancelled: classic card layout ──
  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{cancelled ? 'Ride cancelled' : heading}</Text>
            <Text style={styles.subtitle}>{cancelled ? 'This trip was cancelled.' : subheading}</Text>
          </View>
        </View>

        {driverCard}
        {fareCard}

        {completed ? (
          <>
            {trip.tipMinor === 0 ? (
              <TipCard
                title={`Tip ${trip.driver.user.fullName.split(' ')[0]}?`}
                subtitle="Show your appreciation — 100% of the tip goes to your driver."
                onSubmit={async (tipMinor) => {
                  await api(`/v1/rides/trips/${trip.id}/tip`, { method: 'POST', body: { tipMinor } });
                  await tripQuery.refetch();
                }}
              />
            ) : null}
            <RateProviderCard
              providerId={trip.driver.providerId ?? ''}
              subjectType="RIDE_TRIP"
              subjectId={trip.id}
              title="How was your ride?"
              subtitle="Rate your driver and help us improve."
            />
            <View style={styles.completeActions}>
              <Pressable style={styles.secondaryButton} onPress={() => router.replace('/rides')}>
                <Ionicons name="refresh-outline" size={17} color={colors.blue} />
                <Text style={styles.secondaryButtonText}>Book again</Text>
              </Pressable>
              <GradientButton
                title="Download receipt"
                icon="download-outline"
                style={{ flex: 1 }}
                onPress={() => router.push('/(tabs)/orders')}
              />
            </View>
          </>
        ) : null}

        {cancelled ? (
          <GradientButton title="Book a new ride" onPress={() => router.replace('/rides')} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const SHEET_HEIGHT = 340;

const styles = StyleSheet.create({
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderColor: colors.danger,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: spacing.base,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
  },
  cancelText: { color: colors.danger, fontWeight: fontWeight.bold, fontSize: fontSize.md },
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.base },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2 },
  floatRow: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  floatButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  floatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadow.card,
  },
  floatChipText: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.sm },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...shadow.card,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sheetContent: { paddingHorizontal: spacing.lg },
  sheetHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  etaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.navy,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  etaPillText: { color: colors.textOnBrand, fontWeight: fontWeight.heavy, fontSize: fontSize.base },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  codeCard: { marginBottom: spacing.md },
  routeRow: { flexDirection: 'row', gap: spacing.md },
  routeIcons: { alignItems: 'center', paddingTop: 5 },
  pickupDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.blue },
  destDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: colors.blue },
  routeDots: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 4 },
  routeValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  routeSub: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  pickupCodeBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  pickupCodeLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  pickupCode: { fontSize: 30, fontWeight: fontWeight.heavy, color: colors.blue, marginVertical: 2 },
  pickupCodeHint: { fontSize: 10, color: colors.textSecondary, textAlign: 'center' },
  driverCard: { marginBottom: spacing.md },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  driverAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  driverName: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
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
  driverMeta: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  driverTrips: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1 },
  plateBox: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  plateText: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.textPrimary, letterSpacing: 1 },
  driverActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  driverAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  driverActionText: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.sm },
  fareCard: { marginBottom: spacing.base },
  fareTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm, gap: spacing.md },
  fareLabel: { fontSize: fontSize.base, color: colors.textSecondary },
  fareValue: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: fontWeight.medium, flexShrink: 1, textAlign: 'right' },
  fareTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
  },
  fareTotalLabel: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  fareTotal: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.blue },
  paidRow: { alignItems: 'flex-end', gap: 4 },
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.successTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  paidText: { color: colors.success, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  completeActions: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
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
