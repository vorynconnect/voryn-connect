import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { searchPlaces, type Place } from '@/features/map/geocode';
import { useCurrentLocation } from '@/features/map/useCurrentLocation';
import { VorynPickupPin } from '@/features/map/pins';
import { VehicleIcon, vehicleKindForRide } from '@/features/map/vehicle';
import type { LatLng } from '@/features/map/geo';
import { useLocationPick } from '@/stores/locationPick';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';

const REGION_DELTA = { latitudeDelta: 0.07, longitudeDelta: 0.07 };

const CATEGORIES = [
  { key: 'ECONOMY', label: 'Economy', seats: '1–4', icon: 'car-sport' },
  { key: 'COMFORT', label: 'Comfort', seats: '1–4', icon: 'car' },
  { key: 'XL', label: 'XL', seats: '1–6', icon: 'bus' },
  { key: 'MOTO', label: 'Moto', seats: '1', icon: 'bicycle' },
] as const;

/** Get a Ride landing — map, pickup/destination, category, recent places. */
export default function RidesLandingScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['key']>('ECONOMY');
  const [destination, setDestination] = useState('');
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const currentLocation = useCurrentLocation();
  // Rider can re-pin the pickup on the map; the locate icon clears it.
  const [pickupOverride, setPickupOverride] = useState<{ label: string; point: LatLng; isReal: boolean } | null>(
    null,
  );
  const pickup = pickupOverride ?? currentLocation;
  const region = { ...pickup.point, ...REGION_DELTA };

  // Results from the "choose on map" screen (pickup or destination token).
  const picked = useLocationPick((s) => s.picked);
  const consumePicked = useLocationPick((s) => s.consume);
  useEffect(() => {
    if (!picked) return;
    if (picked.token === 'ride-pickup') {
      const result = consumePicked('ride-pickup');
      if (result) {
        setPickupOverride({
          label: result.name,
          point: { latitude: result.latitude, longitude: result.longitude },
          isReal: true,
        });
      }
    } else if (picked.token === 'ride-dest') {
      const result = consumePicked('ride-dest');
      if (result) goToChoose(result.name, result.latitude, result.longitude);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  // Recenter the map once a real GPS/browser fix replaces the fallback.
  useEffect(() => {
    if (pickup.isReal) mapRef.current?.animateToRegion?.(region, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup.isReal, pickup.point.latitude, pickup.point.longitude]);

  // Live destination search (debounced — Nominatim allows ~1 req/s).
  useEffect(() => {
    const q = destination.trim();
    setSearchError(null);
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const places = await searchPlaces(q);
      setSuggestions(places);
      setSearching(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [destination]);

  // Real nearby online drivers (anonymized server-side) — zero means zero cars.
  const nearbyQuery = useQuery({
    queryKey: ['nearby-drivers-landing', pickup.point.latitude.toFixed(3), pickup.point.longitude.toFixed(3)],
    queryFn: () =>
      api<{ drivers: Array<{ key: string; latitude: number; longitude: number; heading: number; category: string }> }>(
        `/v1/rides/nearby-drivers?lat=${pickup.point.latitude}&lng=${pickup.point.longitude}`,
      ),
    refetchInterval: 12000,
  });
  const nearbyDrivers = nearbyQuery.data?.drivers ?? [];

  const addressesQuery = useQuery({
    queryKey: ['addresses'],
    queryFn: () =>
      api<{ addresses: Array<{ id: string; label: string; name: string; line1: string; latitude: number; longitude: number }> }>(
        '/v1/users/me/addresses',
      ),
  });
  const addresses = addressesQuery.data?.addresses ?? [];
  const home = addresses.find((a) => a.label === 'HOME') ?? addresses[0];
  const work = addresses.find((a) => a.label === 'WORK');

  const goToChoose = (destName: string, destLat: number, destLng: number) => {
    router.push({
      pathname: '/rides/choose',
      params: {
        category,
        destName,
        destLat: String(destLat),
        destLng: String(destLng),
        pickupName: pickup.label,
        pickupLat: String(pickup.point.latitude),
        pickupLng: String(pickup.point.longitude),
      },
    });
  };

  /** Resolve typed text to a real place (top suggestion or fresh search). */
  const submitDestination = async () => {
    const q = destination.trim();
    if (!q) return;
    const place = suggestions[0] ?? (await searchPlaces(q))[0];
    if (!place) {
      setSearchError('We couldn’t find that place. Try adding "Portmore" or "Kingston".');
      return;
    }
    goToChoose(place.name, place.point.latitude, place.point.longitude);
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Get a Ride</Text>
            <Text style={styles.subtitle}>Fast, reliable rides around Portmore</Text>
          </View>
          <View style={styles.locationChip}>
            <Ionicons name="location" size={14} color={colors.blue} />
            <Text style={styles.locationText}>Portmore, Jamaica</Text>
            <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
          </View>
        </View>

        {/* Map with pickup/destination overlay */}
        <Card padded={false} style={styles.mapCard}>
          <MapView ref={mapRef} style={styles.map} initialRegion={region}>
            {nearbyDrivers.map((driver) => (
              <Marker
                key={driver.key}
                coordinate={{ latitude: driver.latitude, longitude: driver.longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
                flat
                rotation={driver.heading}
                tracksViewChanges={false}
              >
                <VehicleIcon kind={vehicleKindForRide(driver.category)} size={32} />
              </Marker>
            ))}
            <Marker coordinate={pickup.point} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false} zIndex={10}>
              <VorynPickupPin />
            </Marker>
          </MapView>
          <Pressable style={styles.recenter} onPress={() => mapRef.current?.animateToRegion?.(region, 400)} hitSlop={8}>
            <Ionicons name="locate" size={19} color={colors.navy} />
          </Pressable>
          <View style={styles.routeCard}>
            <View style={styles.routeRow}>
              <View style={styles.routeIcons}>
                <View style={styles.pickupDot} />
                <View style={styles.routeDots} />
                <Ionicons name="location" size={18} color={colors.danger} />
              </View>
              <View style={styles.routeInputs}>
                <View style={styles.routeInputRow}>
                  <Pressable
                    style={{ flex: 1 }}
                    onPress={() =>
                      router.push({
                        pathname: '/location/pick',
                        params: {
                          token: 'ride-pickup',
                          title: 'Set pickup location',
                          lat: String(pickup.point.latitude),
                          lng: String(pickup.point.longitude),
                        },
                      })
                    }
                  >
                    <Text style={styles.routeLabel}>Pickup</Text>
                    <Text style={styles.routeValue} numberOfLines={1}>
                      {pickup.label}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setPickupOverride(null)} hitSlop={8}>
                    <Ionicons name="locate-outline" size={20} color={colors.blue} />
                  </Pressable>
                </View>
                <View style={styles.routeDivider} />
                <TextInput
                  style={styles.destInput}
                  placeholder="Where to?"
                  placeholderTextColor={colors.textMuted}
                  value={destination}
                  onChangeText={setDestination}
                  onSubmitEditing={() => void submitDestination()}
                  returnKeyType="go"
                />
              </View>
            </View>
          </View>
        </Card>

        {/* Real place suggestions for the typed destination */}
        {searching || suggestions.length > 0 || searchError ? (
          <Card padded={false} style={styles.suggestCard}>
            {searching && suggestions.length === 0 ? (
              <View style={styles.suggestRow}>
                <ActivityIndicator size="small" color={colors.blue} />
                <Text style={styles.suggestDetail}>Searching places…</Text>
              </View>
            ) : null}
            {suggestions.map((place, i) => (
              <Pressable
                key={`${place.point.latitude},${place.point.longitude}`}
                style={[styles.suggestRow, i > 0 && styles.suggestBorder]}
                onPress={() => goToChoose(place.name, place.point.latitude, place.point.longitude)}
              >
                <View style={styles.suggestIcon}>
                  <Ionicons name="location-outline" size={17} color={colors.blue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestName} numberOfLines={1}>
                    {place.name}
                  </Text>
                  <Text style={styles.suggestDetail} numberOfLines={1}>
                    {place.detail}
                  </Text>
                </View>
                <Ionicons name="arrow-forward" size={16} color={colors.textSecondary} />
              </Pressable>
            ))}
            {searchError ? <Text style={styles.searchError}>{searchError}</Text> : null}
          </Card>
        ) : null}

        {/* Ride categories */}
        <View style={styles.categoriesRow}>
          {CATEGORIES.map((cat) => {
            const active = category === cat.key;
            return (
              <Pressable
                key={cat.key}
                style={[styles.categoryCard, active && styles.categoryActive]}
                onPress={() => setCategory(cat.key)}
              >
                <Text style={[styles.categoryLabel, active && styles.categoryLabelActive]}>{cat.label}</Text>
                <Ionicons name={cat.icon} size={34} color={active ? colors.blue : colors.textSecondary} />
                <View style={styles.categorySeats}>
                  <Ionicons name="person-outline" size={12} color={colors.textSecondary} />
                  <Text style={styles.categorySeatsText}>{cat.seats}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Recent places */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Recent places</Text>
          <Pressable onPress={() => router.push('/profile-pages/addresses')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>

        {home ? (
          <Pressable style={styles.placeRow} onPress={() => goToChoose(home.line1, home.latitude, home.longitude)}>
            <View style={styles.placeIcon}>
              <Ionicons name="home" size={19} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.placeTitle}>Home</Text>
              <Text style={styles.placeBody}>{home.line1}</Text>
            </View>
            <Ionicons name="star-outline" size={19} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        {work ? (
          <Pressable style={styles.placeRow} onPress={() => goToChoose(work.line1, work.latitude, work.longitude)}>
            <View style={styles.placeIcon}>
              <Ionicons name="briefcase" size={18} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.placeTitle}>Work</Text>
              <Text style={styles.placeBody}>{work.line1}</Text>
            </View>
            <Ionicons name="star-outline" size={19} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        <Pressable
          style={styles.placeRow}
          onPress={() =>
            router.push({
              pathname: '/location/pick',
              params: {
                token: 'ride-dest',
                title: 'Choose destination',
                lat: String(pickup.point.latitude),
                lng: String(pickup.point.longitude),
              },
            })
          }
        >
          <View style={styles.placeIcon}>
            <Ionicons name="map" size={18} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.placeTitle}>Choose on map</Text>
            <Text style={styles.placeBody}>Drop a pin on the exact spot</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
        <Pressable style={styles.placeRow} onPress={() => router.push('/profile-pages/addresses')}>
          <View style={styles.placeIcon}>
            <Ionicons name="star" size={18} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.placeTitle}>Saved places</Text>
            <Text style={styles.placeBody}>View your saved locations</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
        <Pressable style={styles.placeRow} onPress={() => void submitDestination()}>
          <View style={styles.placeIcon}>
            <Ionicons name="calendar-outline" size={18} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.placeTitle}>Schedule a ride</Text>
            <Text style={styles.placeBody}>Pick a date and time</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>

        <GradientButton
          title="Set destination"
          style={{ marginTop: spacing.base }}
          disabled={!destination.trim()}
          onPress={() => void submitDestination()}
        />
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
  mapCard: { overflow: 'hidden', marginBottom: spacing.base },
  map: { height: 280 },
  pinHalo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(31,124,246,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recenter: {
    position: 'absolute',
    right: spacing.md,
    top: 280 - 60 - 42 - spacing.md, // bottom-right of the map, clear of the route card
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    ...shadow.card,
  },
  routeCard: {
    backgroundColor: colors.surface,
    margin: spacing.md,
    marginTop: -60,
    borderRadius: radius.lg,
    padding: spacing.base,
    ...shadow.raised,
  },
  routeRow: { flexDirection: 'row', gap: spacing.md },
  routeIcons: { alignItems: 'center', paddingTop: 6 },
  pickupDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 3,
    borderColor: colors.blue,
    backgroundColor: colors.surface,
  },
  routeDots: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 4 },
  routeInputs: { flex: 1 },
  routeInputRow: { flexDirection: 'row', alignItems: 'center' },
  suggestCard: { marginBottom: spacing.base },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  suggestBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  suggestIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestName: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  suggestDetail: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  searchError: { color: colors.danger, fontSize: fontSize.sm, padding: spacing.md },
  routeLabel: { fontSize: fontSize.xs, color: colors.blue, fontWeight: fontWeight.semibold },
  routeValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 1 },
  routeDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  destInput: { fontSize: fontSize.md, color: colors.textPrimary, paddingVertical: 2 },
  categoriesRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  categoryCard: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    ...shadow.card,
  },
  categoryActive: { borderColor: colors.blue, backgroundColor: '#F4F9FF' },
  categoryLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  categoryLabelActive: { color: colors.blue },
  categorySeats: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  categorySeatsText: { fontSize: fontSize.xs, color: colors.textSecondary },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary },
  seeAll: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  placeIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  placeBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
});
