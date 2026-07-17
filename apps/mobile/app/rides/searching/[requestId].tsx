import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { EmptyState, ErrorState } from '@/components/States';
import { VorynPickupPin } from '@/features/map/pins';
import { VehicleIcon, vehicleKindForRide } from '@/features/map/vehicle';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmdCompact } from '@/lib/format';

const PICKUP_FALLBACK = { latitude: 17.9583, longitude: -76.8822 };

type SearchStatus = {
  status: 'SEARCHING' | 'DRIVER_ASSIGNED' | 'NO_DRIVER_FOUND' | 'CANCELLED' | 'ENDED';
  currentRadiusKm: number;
  stage: number;
  stageCount: number;
  maxRadiusKm: number;
  eligibleDriverCount: number;
  searchStartedAt: string;
  searchExpiresAt: string;
};

type RequestDetail = {
  request: {
    id: string;
    status: string;
    category: string;
    pickupName: string;
    pickupLat: number | null;
    pickupLng: number | null;
    dropoffName: string;
    estimateMinor: number;
    trip: { id: string } | null;
  };
  search: SearchStatus | null;
};

type NearbyDrivers = {
  drivers: Array<{ key: string; latitude: number; longitude: number; heading: number; category: string }>;
  count: number;
};

/** Expanding pulse broadcast from the pickup pin — visual only; the radius
 *  circle underneath is the real backend search area. */
function PulseRings({ active }: { active: boolean }) {
  const rings = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    if (!active) return;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const loops: Animated.CompositeAnimation[] = [];
    rings.forEach((value, i) => {
      timers.push(
        setTimeout(() => {
          const loop = Animated.loop(
            Animated.timing(value, {
              toValue: 1,
              duration: 2400,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          );
          loops.push(loop);
          loop.start();
        }, i * 800),
      );
    });
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
      rings.forEach((v) => v.setValue(0));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active) return null;
  return (
    <View pointerEvents="none" style={styles.pulseOverlay}>
      {rings.map((value, i) => (
        <Animated.View
          key={i}
          style={[
            styles.pulseRing,
            {
              opacity: value.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] }),
              transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.18, 1] }) }],
            },
          ]}
        />
      ))}
    </View>
  );
}

/** "Looking for a driver" — live search session: real radius, real supply. */
export default function SearchingDriverScreen() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const mapRef = useRef<MapView>(null);
  const [displayRadiusM, setDisplayRadiusM] = useState<number | null>(null);

  const requestQuery = useQuery({
    queryKey: ['ride-request', requestId],
    queryFn: () => api<RequestDetail>(`/v1/rides/requests/${requestId}`),
    refetchInterval: 3000,
  });

  const request = requestQuery.data?.request;
  const search = requestQuery.data?.search ?? null;
  const searching = request?.status === 'SEARCHING';
  const noDriver = request?.status === 'NO_DRIVER_AVAILABLE';
  const pickup =
    request?.pickupLat != null && request?.pickupLng != null
      ? { latitude: request.pickupLat, longitude: request.pickupLng }
      : PICKUP_FALLBACK;

  // Real nearby drivers (anonymized server-side). Zero results = zero markers.
  const nearbyQuery = useQuery({
    queryKey: ['nearby-drivers', request?.id],
    queryFn: () =>
      api<NearbyDrivers>(
        `/v1/rides/nearby-drivers?lat=${pickup.latitude}&lng=${pickup.longitude}&category=${request!.category}`,
      ),
    enabled: Boolean(request?.pickupLat != null && searching),
    refetchInterval: 10000,
  });
  const nearbyDrivers = nearbyQuery.data?.drivers ?? [];

  useEffect(() => {
    if (request?.trip) {
      router.replace({ pathname: '/rides/trip/[tripId]', params: { tripId: request.trip.id } });
    }
  }, [request?.trip, router]);

  // Animate the search-area circle and viewport to the backend's radius —
  // the drawn area is exactly what dispatch is currently searching.
  const radiusKm = search?.currentRadiusKm ?? null;
  useEffect(() => {
    if (radiusKm == null) return;
    const targetM = radiusKm * 1000;
    setDisplayRadiusM((current) => {
      if (current == null) return targetM;
      if (Math.abs(current - targetM) < 1) return current;
      return current; // rAF below glides the rest of the way
    });
    let frame: number | null = null;
    const startedAt = Date.now();
    const from = displayRadiusM ?? targetM;
    if (from !== targetM) {
      const step = () => {
        const t = Math.min(1, (Date.now() - startedAt) / 700);
        setDisplayRadiusM(from + (targetM - from) * t);
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }
    const delta = ((radiusKm * 2) / 111) * 1.35;
    mapRef.current?.animateToRegion?.(
      { ...pickup, latitudeDelta: delta, longitudeDelta: delta },
      700,
    );
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusKm]);

  if (requestQuery.isError) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => requestQuery.refetch()} />
      </View>
    );
  }

  const cancel = async () => {
    // "Back to rides" (no driver) returns to the rides landing to rebook;
    // cancelling an active search takes the customer home.
    if (noDriver) {
      router.replace('/rides');
      return;
    }
    try {
      await api(`/v1/rides/${requestId}/cancel`, { method: 'POST', body: {} });
    } catch {
      // Already assigned or no longer cancellable — leave the screen anyway.
    } finally {
      router.replace('/(tabs)/home');
    }
  };

  const searchMinutesLeft = search
    ? Math.max(1, Math.ceil((new Date(search.searchExpiresAt).getTime() - Date.now()) / 60000))
    : null;
  const widened = (search?.stage ?? 0) > 0;
  const vehicleKind = vehicleKindForRide(request?.category);

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{noDriver ? 'No drivers available' : 'Looking for a driver'}</Text>
        <Text style={styles.subtitle}>
          {noDriver
            ? 'No drivers are currently available nearby.'
            : widened
              ? 'Searching a wider area for available drivers…'
              : 'Sit tight! We’re finding the best driver for you.'}
        </Text>

        <Card padded={false} style={styles.mapCard}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={{ ...pickup, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
            pointerEvents="none"
          >
            {/* The actual area dispatch is searching right now */}
            {searching && displayRadiusM != null ? (
              <Circle
                center={pickup}
                radius={displayRadiusM}
                strokeColor="rgba(31,124,246,0.4)"
                fillColor="rgba(31,124,246,0.08)"
              />
            ) : null}

            {/* Real eligible drivers (anonymized positions from the backend) */}
            {nearbyDrivers.map((driver) => (
              <Marker
                key={driver.key}
                coordinate={{ latitude: driver.latitude, longitude: driver.longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
                flat
                rotation={driver.heading}
                tracksViewChanges={false}
              >
                <VehicleIcon kind={vehicleKind} size={34} />
              </Marker>
            ))}

            <Marker coordinate={pickup} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false} zIndex={10}>
              <VorynPickupPin />
            </Marker>
          </MapView>

          <PulseRings active={searching} />

          {searching && search ? (
            <View style={styles.searchingPill}>
              <Text style={styles.searchingPillText}>
                {widened ? `Searching a wider area within ${search.currentRadiusKm} km` : `Searching within ${search.currentRadiusKm} km`}
              </Text>
            </View>
          ) : null}
        </Card>

        {request ? (
          <Card style={styles.detailsCard}>
            <View style={styles.routeRow}>
              <View style={styles.routeIcons}>
                <View style={styles.pickupDot} />
                <View style={styles.routeDots} />
                <View style={styles.destRing} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>Pickup</Text>
                <Text style={styles.routeValue}>{request.pickupName}</Text>
                <View style={styles.routeDivider} />
                <Text style={styles.routeLabel}>Destination</Text>
                <Text style={styles.routeValue}>{request.dropoffName}</Text>
              </View>
            </View>
            <View style={styles.fareRow}>
              <View>
                <Text style={styles.fareLabel}>Ride type</Text>
                <Text style={styles.fareValue}>
                  {request.category.charAt(0) + request.category.slice(1).toLowerCase()}
                </Text>
              </View>
              <View style={styles.fareDivider} />
              <View>
                <Text style={styles.fareLabel}>Fare estimate</Text>
                <Text style={styles.fareValue}>{formatJmdCompact(request.estimateMinor)}</Text>
              </View>
            </View>
          </Card>
        ) : null}

        {noDriver ? (
          <EmptyState
            icon="car-outline"
            title="Try again in a few minutes"
            body="You can try again, change your ride type, or cancel without a fee. You have not been charged."
          />
        ) : (
          <Card style={styles.progressCard}>
            <View style={styles.progressRow}>
              <View style={styles.progressLogo}>
                <Ionicons name="radio-outline" size={26} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.progressTitle}>
                  {search && search.eligibleDriverCount > 0
                    ? `${search.eligibleDriverCount} driver${search.eligibleDriverCount === 1 ? '' : 's'} in range`
                    : 'Searching a wider area for available drivers…'}
                </Text>
                <Text style={styles.progressBody}>
                  {searchMinutesLeft != null
                    ? `We’ll keep searching for up to ${searchMinutesLeft} more min.`
                    : 'Starting your search…'}
                </Text>
              </View>
            </View>
            {search ? (
              <View style={styles.progressBars}>
                {Array.from({ length: search.stageCount }, (_, i) => (
                  <View key={i} style={[styles.bar, i <= search.stage && styles.barActive]} />
                ))}
              </View>
            ) : null}
          </Card>
        )}

        <Pressable style={styles.cancelButton} onPress={cancel}>
          <Ionicons name="close-circle-outline" size={20} color={colors.danger} />
          <Text style={styles.cancelText}>{noDriver ? 'Back to rides' : 'Cancel ride request'}</Text>
        </Pressable>
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
  map: { height: 320 },
  pulseOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    borderWidth: 2,
    borderColor: colors.blue,
    backgroundColor: 'rgba(31,124,246,0.07)',
  },
  searchingPill: {
    position: 'absolute',
    bottom: spacing.base,
    alignSelf: 'center',
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  searchingPillText: { color: colors.textOnBrand, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  detailsCard: { marginBottom: spacing.base },
  routeRow: { flexDirection: 'row', gap: spacing.md },
  routeIcons: { alignItems: 'center', paddingTop: 4 },
  pickupDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.blue },
  destRing: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: colors.blue },
  routeDots: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 4 },
  routeLabel: { fontSize: fontSize.xs, color: colors.blue, fontWeight: fontWeight.semibold },
  routeValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 1 },
  routeDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.md,
  },
  fareLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  fareValue: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 2 },
  fareDivider: { flex: 1 },
  progressCard: { marginBottom: spacing.base },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  progressLogo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  progressBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  progressBars: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.base },
  bar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.border },
  barActive: { backgroundColor: colors.blue },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderColor: colors.danger,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: spacing.base,
  },
  cancelText: { color: colors.danger, fontWeight: fontWeight.bold, fontSize: fontSize.md },
});
