import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/States';
import { DriverHeader } from '@/features/driver/DriverHeader';
import type { DriverRequest } from '@/features/driver/types';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmdCompact } from '@/lib/format';

const ACCEPT_WINDOW_SECONDS = 15;
const PORTMORE = { latitude: 17.9583, longitude: -76.8822 };

/** New Request — review and accept/decline within the countdown window. */
export default function DriverRequestScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id, kind } = useLocalSearchParams<{ id: string; kind: 'ride' | 'delivery' }>();
  const [secondsLeft, setSecondsLeft] = useState(ACCEPT_WINDOW_SECONDS);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  const requestsQuery = useQuery({
    queryKey: ['driver-requests'],
    queryFn: () => api<{ requests: DriverRequest[] }>('/v1/driver/requests'),
  });
  const request = requestsQuery.data?.requests.find((r) => r.id === id && r.kind === kind);

  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const acceptMutation = useMutation({
    mutationFn: () => api<{ tripId: string }>(`/v1/driver/requests/${id}/accept`, { method: 'POST', body: { kind } }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['driver-requests'] });
      queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
      router.replace({ pathname: '/driver/trip/[id]', params: { id: data.tripId, kind: kind! } });
    },
    onError: (err) => {
      setDialog({ title: 'Could not accept', message: err instanceof ApiError ? err.message : 'Try again.' });
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => api(`/v1/driver/requests/${id}/decline`, { method: 'POST', body: { kind } }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-requests'] });
      router.back();
    },
  });

  if (requestsQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <DriverHeader centerTitle="New Request" />
        <LoadingState label="Loading request…" />
      </View>
    );
  }
  if (!request) {
    return (
      <View style={styles.flex}>
        <DriverHeader centerTitle="New Request" />
        <ErrorState
          title="Request no longer available"
          body="It may have been taken by another driver."
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  const pickup = request.pickupLat != null && request.pickupLng != null
    ? { latitude: request.pickupLat, longitude: request.pickupLng }
    : PORTMORE;
  const dropoff = request.dropoffLat != null && request.dropoffLng != null
    ? { latitude: request.dropoffLat, longitude: request.dropoffLng }
    : PORTMORE;
  const region = {
    latitude: (pickup.latitude + dropoff.latitude) / 2,
    longitude: (pickup.longitude + dropoff.longitude) / 2,
    latitudeDelta: Math.max(0.03, Math.abs(pickup.latitude - dropoff.latitude) * 2.2),
    longitudeDelta: Math.max(0.03, Math.abs(pickup.longitude - dropoff.longitude) * 2.2),
  };
  const estMinutes = request.distanceKm != null ? Math.max(5, Math.round(request.distanceKm * 1.6)) : null;
  const paymentLabel =
    request.paymentMethodType === 'VORYN_WALLET' ? 'Wallet' : request.paymentMethodType === 'CARD' ? 'Card' : 'Cash';
  const countdownFraction = secondsLeft / ACCEPT_WINDOW_SECONDS;

  return (
    <View style={styles.flex}>
      <DriverHeader centerTitle="New Request" />
      <ScrollView contentContainerStyle={styles.container}>
        {/* Route map */}
        <Card padded={false} style={styles.mapCard}>
          <MapView style={styles.map} initialRegion={region}>
            <Marker coordinate={pickup} title="Pickup">
              <View style={styles.pickupMarker} />
            </Marker>
            <Marker coordinate={dropoff} title={request.dropoffName}>
              <View style={styles.dropoffMarker}>
                <Ionicons name="location" size={14} color={colors.textOnBrand} />
              </View>
            </Marker>
            <Polyline coordinates={[pickup, dropoff]} strokeColor={colors.blue} strokeWidth={4} />
          </MapView>
          <View style={styles.pickupCallout}>
            <Text style={styles.calloutLabel}>Pickup</Text>
            <Text style={styles.calloutValue} numberOfLines={2}>{request.pickupName}</Text>
          </View>
          <View style={styles.dropoffCallout}>
            <Text style={[styles.calloutLabel, { color: colors.danger }]}>Drop-off</Text>
            <Text style={styles.calloutValue} numberOfLines={2}>{request.dropoffName}</Text>
          </View>
        </Card>

        {/* Request card */}
        <Card style={styles.requestCard}>
          <View style={styles.requestHead}>
            {request.customerAvatarUrl ? (
              <Avatar uri={request.customerAvatarUrl} name={request.customerName} size={56} />
            ) : (
              <View style={styles.avatar}>
                <Ionicons name="person" size={26} color={colors.blue} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.customerName}>{request.customerName}</Text>
              <View style={styles.customerMeta}>
                <Ionicons name={request.kind === 'ride' ? 'star' : 'bag-handle'} size={13} color={colors.blue} />
                <Text style={styles.customerMetaText}>
                  {request.kind === 'ride' ? `${request.category ?? 'ECONOMY'} ride` : request.itemsSummary || 'Delivery order'}
                </Text>
              </View>
            </View>
            {/* Countdown ring */}
            <View style={styles.countdownWrap}>
              <View style={[styles.countdownRing, { borderColor: countdownFraction > 0.3 ? colors.blue : colors.danger }]}>
                <Text style={styles.countdownValue}>{secondsLeft}</Text>
                <Text style={styles.countdownUnit}>sec</Text>
              </View>
            </View>
          </View>

          <View style={styles.routeAndStats}>
            <View style={{ flex: 1 }}>
              <View style={styles.routeItem}>
                <View style={[styles.routeDot, { backgroundColor: colors.blue }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.routeLabel}>Pickup</Text>
                  <Text style={styles.routeValue}>{request.pickupName}</Text>
                </View>
              </View>
              <View style={styles.routeLine} />
              <View style={styles.routeItem}>
                <View style={styles.dropPin}>
                  <Ionicons name="location" size={11} color={colors.textOnBrand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.routeLabel, { color: colors.danger }]}>Drop-off</Text>
                  <Text style={styles.routeValue}>{request.dropoffName}</Text>
                </View>
              </View>
            </View>
            <View style={styles.statsCol}>
              {request.distanceKm != null ? (
                <>
                  <Text style={styles.statLabel}>Distance</Text>
                  <Text style={styles.statValue}>{request.distanceKm.toFixed(1)} km</Text>
                </>
              ) : null}
              {estMinutes != null ? (
                <>
                  <Text style={styles.statLabel}>Est. time</Text>
                  <Text style={styles.statValue}>{estMinutes} min</Text>
                </>
              ) : null}
              <Text style={styles.statLabel}>{request.kind === 'ride' ? 'Fare estimate' : 'Delivery earnings'}</Text>
              <Text style={styles.fareValue}>{formatJmdCompact(request.estimateMinor)}</Text>
            </View>
          </View>
        </Card>

        {/* Info chips */}
        <View style={styles.chipsRow}>
          <Card style={styles.chip}>
            <View style={styles.chipIcon}>
              <Ionicons name="card-outline" size={18} color={colors.blue} />
            </View>
            <Text style={styles.chipLabel}>Payment</Text>
            <Text style={styles.chipValue}>{request.kind === 'ride' ? paymentLabel : 'Prepaid'}</Text>
          </Card>
          <Card style={styles.chip}>
            <View style={[styles.chipIcon, { backgroundColor: colors.warningTint }]}>
              <Ionicons name="flash-outline" size={18} color={colors.warning} />
            </View>
            <Text style={styles.chipLabel}>{request.kind === 'ride' ? 'Category' : 'Type'}</Text>
            <Text style={styles.chipValue}>{request.kind === 'ride' ? request.category ?? 'ECONOMY' : 'Delivery'}</Text>
          </Card>
          <Card style={styles.chip}>
            <View style={styles.chipIcon}>
              <Ionicons name="information-circle-outline" size={18} color={colors.blue} />
            </View>
            <Text style={styles.chipLabel}>Note</Text>
            <Text style={styles.chipValue} numberOfLines={2}>
              {request.kind === 'ride' ? 'Meet at pickup point' : 'Collect from the store counter'}
            </Text>
          </Card>
        </View>

        {/* Decline / Accept */}
        <View style={styles.buttonsRow}>
          <Pressable
            style={styles.declineButton}
            disabled={declineMutation.isPending}
            onPress={() => declineMutation.mutate()}
          >
            <Text style={styles.declineText}>Decline</Text>
          </Pressable>
          <Pressable
            style={[styles.acceptButton, acceptMutation.isPending && { opacity: 0.7 }]}
            disabled={acceptMutation.isPending}
            onPress={() => acceptMutation.mutate()}
          >
            <Text style={styles.acceptText}>{acceptMutation.isPending ? 'Accepting…' : 'Accept Request'}</Text>
          </Pressable>
        </View>

        <View style={styles.safetyRow}>
          <Ionicons name="shield-checkmark-outline" size={15} color={colors.textSecondary} />
          <Text style={styles.safetyText}>Your safety is our priority</Text>
        </View>
      </ScrollView>
      <ConfirmDialog
        spec={dialog}
        onClose={() => {
          setDialog(null);
          router.back();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  mapCard: { overflow: 'hidden', height: 250, marginBottom: spacing.md },
  map: { width: '100%', height: '100%' },
  pickupMarker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.blue,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  dropoffMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  pickupCallout: {
    position: 'absolute',
    top: 12,
    left: 12,
    maxWidth: 190,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadow.card,
  },
  dropoffCallout: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    maxWidth: 190,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadow.card,
  },
  calloutLabel: { fontSize: fontSize.xs, color: colors.blue, fontWeight: fontWeight.bold },
  calloutValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: fontWeight.semibold, marginTop: 1 },
  requestCard: { marginBottom: spacing.md },
  requestHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.base },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerName: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  customerMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  customerMetaText: { fontSize: fontSize.sm, color: colors.textSecondary },
  countdownWrap: { alignItems: 'center' },
  countdownRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownValue: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  countdownUnit: { fontSize: 10, color: colors.textSecondary, marginTop: -2 },
  routeAndStats: { flexDirection: 'row', gap: spacing.base },
  routeItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  routeDot: { width: 14, height: 14, borderRadius: 7, marginTop: 3 },
  dropPin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeLine: { width: 2, height: 20, backgroundColor: colors.borderStrong, marginLeft: 6, marginVertical: 2 },
  routeLabel: { fontSize: fontSize.sm, color: colors.blue, fontWeight: fontWeight.semibold },
  routeValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  statsCol: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border, paddingLeft: spacing.base, minWidth: 118 },
  statLabel: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 6 },
  statValue: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  fareValue: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.blue },
  chipsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.base },
  chip: { flex: 1, padding: spacing.md },
  chipIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  chipLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  chipValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 1 },
  buttonsRow: { flexDirection: 'row', gap: spacing.md },
  declineButton: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.danger,
    borderRadius: radius.lg,
    paddingVertical: 17,
    alignItems: 'center',
  },
  declineText: { color: colors.danger, fontWeight: fontWeight.heavy, fontSize: fontSize.md },
  acceptButton: {
    flex: 1.6,
    backgroundColor: colors.blue,
    borderRadius: radius.lg,
    paddingVertical: 17,
    alignItems: 'center',
    ...shadow.cta,
  },
  acceptText: { color: colors.textOnBrand, fontWeight: fontWeight.heavy, fontSize: fontSize.md },
  safetyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.base },
  safetyText: { fontSize: fontSize.sm, color: colors.textSecondary },
});
