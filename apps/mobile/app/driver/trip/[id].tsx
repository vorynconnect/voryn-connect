import { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/States';
import { DriverHeader } from '@/features/driver/DriverHeader';
import { useDriverLocationPublisher } from '@/features/driver/useLocationPublisher';
import { LiveTripMap } from '@/features/map/LiveTripMap';
import { vehicleKindForCourier, vehicleKindForRide } from '@/features/map/vehicle';
import {
  DELIVERY_CTA,
  DELIVERY_STEPS,
  RIDE_CTA,
  RIDE_STEPS,
  type DriverMe,
  type DriverTrip,
} from '@/features/driver/types';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmdCompact } from '@/lib/format';

const PORTMORE = { latitude: 17.9583, longitude: -76.8822 };

function stepIndex(kind: 'ride' | 'delivery', status: string): number {
  if (kind === 'ride') {
    if (status === 'DRIVER_ASSIGNED' || status === 'DRIVER_ARRIVING') return 0;
    if (status === 'ARRIVED' || status === 'IN_PROGRESS') return 1;
    return 2;
  }
  if (status === 'COURIER_ASSIGNED' || status === 'PICKED_UP') return 0;
  if (status === 'ON_THE_WAY') return 1;
  return 2;
}

/** Active Trip — live progress, passenger/customer contact, advance CTA. */
export default function DriverActiveTripScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id, kind } = useLocalSearchParams<{ id: string; kind: 'ride' | 'delivery' }>();

  const tripQuery = useQuery({
    queryKey: ['driver-trip', id, kind],
    queryFn: () =>
      api<{ trip: DriverTrip; eta: { etaMinutes: number; stale: boolean } | null }>(
        `/v1/driver/trips/${id}?kind=${kind}`,
      ),
    refetchInterval: 15000,
  });
  const trip = tripQuery.data?.trip;
  const eta = tripQuery.data?.eta ?? null;
  const meQuery = useQuery({ queryKey: ['driver-me'], queryFn: () => api<DriverMe>('/v1/driver/me') });
  const myFix = useDriverLocationPublisher(trip);

  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  // Runs once when the current notice dialog is dismissed (e.g. payout → dashboard).
  const afterDialogClose = useRef<(() => void) | null>(null);

  const advanceMutation = useMutation({
    mutationFn: (override?: boolean) =>
      api<{ trip: DriverTrip }>(`/v1/driver/trips/${id}/advance`, {
        method: 'POST',
        body: { kind, override: override === true },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['driver-trip', id, kind], data);
      queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
      queryClient.invalidateQueries({ queryKey: ['driver-dashboard'] });
      if (data.trip.status === 'COMPLETED' || data.trip.status === 'DELIVERED') {
        queryClient.invalidateQueries({ queryKey: ['wallet'] });
        queryClient.invalidateQueries({ queryKey: ['driver-earnings'] });
        afterDialogClose.current = () => router.replace('/driver/dashboard');
        setDialog({
          title: kind === 'ride' ? 'Trip complete 🎉' : 'Delivery complete 🎉',
          message: `Your payout of ${formatJmdCompact(data.trip.earningsMinor ?? 0)} has been added to your wallet.`,
        });
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'GEOFENCE_TOO_FAR') {
        // GPS says the driver isn't at the stop yet — allow a logged override.
        setDialog({
          title: 'Not at the stop yet?',
          message: `${err.message}\n\nConfirming anyway is recorded for support review.`,
          confirmLabel: "I'm here — confirm",
          onConfirm: () => advanceMutation.mutate(true),
        });
        return;
      }
      setDialog({
        title: 'Could not update trip',
        message: err instanceof ApiError ? err.message : 'Try again.',
      });
    },
  });

  if (tripQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <DriverHeader />
        <LoadingState label="Loading trip…" />
      </View>
    );
  }
  if (tripQuery.isError || !trip) {
    return (
      <View style={styles.flex}>
        <DriverHeader />
        <ErrorState onRetry={() => tripQuery.refetch()} />
      </View>
    );
  }

  const steps = kind === 'ride' ? RIDE_STEPS : DELIVERY_STEPS;
  const activeStep = stepIndex(kind!, trip.status);
  const cta = kind === 'ride' ? RIDE_CTA[trip.status] : DELIVERY_CTA[trip.status];
  const done = trip.status === 'COMPLETED' || trip.status === 'DELIVERED';
  const cancelled = trip.status.startsWith('CANCELLED');

  const pickup = trip.pickupLat != null && trip.pickupLng != null
    ? { latitude: trip.pickupLat, longitude: trip.pickupLng }
    : PORTMORE;
  const dropoff = trip.dropoffLat != null && trip.dropoffLng != null
    ? { latitude: trip.dropoffLat, longitude: trip.dropoffLng }
    : { latitude: PORTMORE.latitude + 0.02, longitude: PORTMORE.longitude + 0.02 };
  const toPickup =
    kind === 'ride'
      ? ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'ARRIVED'].includes(trip.status)
      : trip.status === 'COURIER_ASSIGNED';
  const myVehicle =
    kind === 'ride'
      ? vehicleKindForRide(meQuery.data?.driver?.rideCategory)
      : vehicleKindForCourier(meQuery.data?.courier?.vehicleType);
  // Backend road-route ETA from this driver's live pings; no local guesswork.
  const etaDisplay = eta && !eta.stale ? String(eta.etaMinutes) : '—';
  // Delivery estimates already arrive as courier take-home (fee minus Voryn's
  // margin, plus tip); ride estimates are the customer fare, so approximate the
  // driver's cut as fare minus the 12% commission.
  const driverEarnings =
    trip.earningsMinor ?? (trip.kind === 'delivery' ? trip.estimateMinor : Math.round(trip.estimateMinor * 0.88));

  return (
    <View style={styles.flex}>
      <DriverHeader />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{kind === 'ride' ? 'Active Trip' : 'Active Delivery'}</Text>
          <View style={styles.onlinePill}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>Online</Text>
          </View>
        </View>

        {/* Map */}
        <Card padded={false} style={styles.mapCard}>
          <LiveTripMap
            style={styles.map}
            pickup={pickup}
            dropoff={dropoff}
            pickupLabel={trip.pickupName}
            dropoffLabel={trip.dropoffName}
            pickupStyle={kind === 'delivery' ? 'merchant' : 'dot'}
            vehicleKind={myVehicle}
            vehicleFix={myFix}
            phase={toPickup ? 'toPickup' : 'toDropoff'}
          />
          <View style={styles.etaChip}>
            <Text style={styles.etaLabel}>ETA</Text>
            <Text style={styles.etaValue}>{etaDisplay}</Text>
            <Text style={styles.etaUnit}>min</Text>
          </View>
        </Card>

        {/* Stepper */}
        <Card padded={false} style={styles.stepperCard}>
          <View style={styles.stepper}>
            {steps.map((step, i) => (
              <View key={step.key} style={styles.stepWrap}>
                <View style={[styles.step, i === activeStep && styles.stepActive, i < activeStep && styles.stepDone]}>
                  <Ionicons
                    name={step.icon}
                    size={15}
                    color={i <= activeStep ? colors.textOnBrand : colors.textSecondary}
                  />
                  <Text style={[styles.stepText, i <= activeStep && { color: colors.textOnBrand }]}>{step.label}</Text>
                </View>
                {i < steps.length - 1 ? <View style={styles.stepDash} /> : null}
              </View>
            ))}
          </View>
        </Card>

        {/* Customer card */}
        <Card style={styles.customerCard}>
          <View style={styles.customerRow}>
            {trip.customerAvatarUrl ? (
              <Avatar uri={trip.customerAvatarUrl} name={trip.customerName} size={56} />
            ) : (
              <View style={styles.avatar}>
                <Ionicons name="person" size={28} color={colors.blue} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.customerName}>{trip.customerName}</Text>
              <View style={styles.routeItem}>
                <View style={[styles.routeDot, { backgroundColor: colors.blue }]} />
                <Text style={styles.routeText} numberOfLines={1}>{trip.pickupName}</Text>
              </View>
              <View style={styles.routeItem}>
                <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
                <Text style={styles.routeText} numberOfLines={1}>{trip.dropoffName}</Text>
              </View>
              {trip.itemsSummary ? (
                <Text style={styles.itemsText} numberOfLines={1}>{trip.itemsSummary}</Text>
              ) : null}
            </View>
            <View style={styles.contactCol}>
              <Pressable
                style={styles.contactButton}
                onPress={() =>
                  trip.customerPhone
                    ? Linking.openURL(`tel:${trip.customerPhone}`)
                    : setDialog({ title: 'No phone number', message: 'This customer has no phone number on file.' })
                }
              >
                <Ionicons name="call" size={15} color={colors.blue} />
                <Text style={styles.contactText}>Call</Text>
              </Pressable>
              <Pressable
                style={styles.contactButton}
                onPress={() =>
                  router.push({
                    pathname: '/chat',
                    params: {
                      context: trip.kind === 'ride' ? 'RIDE' : 'ORDER',
                      referenceId: trip.id,
                      title: trip.customerName,
                      avatarUrl: trip.customerAvatarUrl ?? '',
                    },
                  })
                }
              >
                <Ionicons name="chatbubble-ellipses" size={15} color={colors.blue} />
                <Text style={styles.contactText}>Chat</Text>
              </Pressable>
            </View>
          </View>
        </Card>

        {/* PIN / earnings / distance */}
        <Card padded={false} style={styles.metaCard}>
          {trip.kind === 'ride' && trip.pickupCode ? (
            <View style={[styles.metaCol, styles.metaBorder]}>
              <Text style={styles.metaLabel}>Trip PIN</Text>
              <Pressable
                style={styles.pinRow}
                onPress={async () => {
                  await Clipboard.setStringAsync(trip.pickupCode!);
                  setDialog({ title: 'Copied', message: 'Trip PIN copied to clipboard.' });
                }}
              >
                <Text style={styles.pinValue}>{trip.pickupCode}</Text>
                <Ionicons name="copy-outline" size={15} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
          <View style={[styles.metaCol, styles.metaBorder]}>
            <View style={styles.metaLabelRow}>
              <Text style={styles.metaLabel}>Est. earnings</Text>
              <Ionicons name="information-circle-outline" size={13} color={colors.textSecondary} />
            </View>
            <Text style={styles.metaValue}>{formatJmdCompact(driverEarnings)}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{trip.distanceKm != null ? 'Trip distance' : 'Reference'}</Text>
            <Text style={styles.metaValue}>{trip.distanceKm != null ? `${trip.distanceKm.toFixed(1)} km` : trip.code}</Text>
          </View>
        </Card>

        {/* Advance CTA */}
        {!done && !cancelled && cta ? (
          <Pressable
            style={[styles.ctaButton, advanceMutation.isPending && { opacity: 0.7 }]}
            disabled={advanceMutation.isPending}
            onPress={() => advanceMutation.mutate(false)}
          >
            <Ionicons name="checkmark-circle-outline" size={22} color={colors.textOnBrand} />
            <Text style={styles.ctaText}>{advanceMutation.isPending ? 'Updating…' : cta}</Text>
          </Pressable>
        ) : null}
        {done ? (
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.doneText}>
              {kind === 'ride' ? 'Trip completed' : 'Delivered'} — payout added to your wallet.
            </Text>
          </View>
        ) : null}
        {cancelled ? (
          <>
            <View style={styles.cancelledBanner}>
              <Ionicons name="close-circle" size={20} color={colors.danger} />
              <Text style={styles.cancelledText}>
                {kind === 'ride'
                  ? 'The rider cancelled this trip. No need to continue to the pickup.'
                  : 'This order was cancelled by the customer.'}
              </Text>
            </View>
            <Pressable style={styles.backButton} onPress={() => router.replace('/driver/dashboard')}>
              <Ionicons name="arrow-back" size={18} color={colors.textOnBrand} />
              <Text style={styles.ctaText}>Back to dashboard</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
      <ConfirmDialog
        spec={dialog}
        onClose={() => {
          setDialog(null);
          const fn = afterDialogClose.current;
          afterDialogClose.current = null;
          fn?.();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.base },
  title: { fontSize: 26, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: 7,
    ...shadow.card,
  },
  onlineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.success },
  onlineText: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  mapCard: { overflow: 'hidden', height: 280, marginBottom: spacing.md },
  map: { width: '100%', height: '100%' },
  etaChip: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    alignItems: 'center',
    ...shadow.card,
  },
  etaLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  etaValue: { fontSize: 26, fontWeight: fontWeight.heavy, color: colors.textPrimary, lineHeight: 30 },
  etaUnit: { fontSize: fontSize.xs, color: colors.textSecondary },
  stepperCard: { marginBottom: spacing.md, padding: spacing.md },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  stepActive: { backgroundColor: colors.blue },
  stepDone: { backgroundColor: colors.borderStrong },
  stepText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textSecondary },
  stepDash: { flex: 1, height: 2, backgroundColor: colors.border, marginHorizontal: 6 },
  customerCard: { marginBottom: spacing.md },
  customerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerName: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginBottom: 6 },
  routeItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeText: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
  itemsText: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  contactCol: { gap: spacing.sm },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: 8,
  },
  contactText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  metaCard: { flexDirection: 'row', marginBottom: spacing.base },
  metaCol: { flex: 1, padding: spacing.base },
  metaBorder: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  metaLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  metaLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaValue: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 4 },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  pinValue: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary, letterSpacing: 2 },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: colors.blue,
    borderRadius: radius.lg,
    paddingVertical: 18,
    ...shadow.cta,
  },
  ctaText: { color: colors.textOnBrand, fontWeight: fontWeight.heavy, fontSize: fontSize.md },
  doneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.successTint,
    borderRadius: radius.lg,
    padding: spacing.base,
  },
  doneText: { color: colors.success, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  cancelledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.dangerTint,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  cancelledText: { flex: 1, color: colors.danger, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: colors.navy,
    borderRadius: radius.lg,
    paddingVertical: 18,
  },
});
