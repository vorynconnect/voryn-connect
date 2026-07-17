import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { haversineKm, type LatLng } from './geo';
import { VorynDestinationPin, VorynPickupPin } from './pins';
import { useRoute } from './route';
import { useSmoothVehicle, type VehicleFix } from './useSmoothVehicle';
import { VehicleIcon, type VehicleKind } from './vehicle';

type Props = {
  pickup: LatLng;
  dropoff: LatLng;
  pickupLabel?: string;
  dropoffLabel?: string;
  /** Small sublabels under the chip titles, e.g. "Pickup" / "Destination". */
  pickupHint?: string;
  dropoffHint?: string;
  /** Icon shown in the dropoff chip (deliveries use "home"). */
  dropoffIcon?: keyof typeof Ionicons.glyphMap;
  /** merchant renders a storefront pin at pickup (deliveries). */
  pickupStyle?: 'dot' | 'merchant';
  vehicleKind?: VehicleKind;
  vehicleFix?: VehicleFix | null;
  /** Which leg is live: vehicle→pickup while arriving, vehicle→dropoff after. */
  phase: 'toPickup' | 'toDropoff';
  /** Extra bottom bounds padding so the route clears an overlaying sheet. */
  bottomPadding?: number;
  /** false = static preview (no pan/zoom, no recenter button). */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
};

function LabelChip({ text, hint, icon }: { text: string; hint?: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.chip}>
      {icon ? <Ionicons name={icon} size={14} color={colors.blue} /> : null}
      <View style={styles.chipBody}>
        <Text style={styles.chipText} numberOfLines={1}>
          {text}
        </Text>
        {hint ? <Text style={styles.chipHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Uber-style live trip map: pickup/dropoff pins with name chips, the live
 * route leg, and a smoothly gliding top-down vehicle sprite rotated to its
 * direction of travel.
 */
export function LiveTripMap({
  pickup,
  dropoff,
  pickupLabel,
  dropoffLabel,
  pickupHint,
  dropoffHint,
  dropoffIcon,
  pickupStyle = 'dot',
  vehicleKind = 'car',
  vehicleFix,
  phase,
  bottomPadding = 0,
  interactive = true,
  style,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  // Let the SVG paint before the marker is rasterized, then stop re-snapshotting.
  const [trackVehicle, setTrackVehicle] = useState(true);
  const lastFitRef = useRef<LatLng | null>(null);
  const [mapSize, setMapSize] = useState<{ w: number; h: number } | null>(null);

  // Frame padding must scale with the map, or small preview maps end up
  // zoomed way out (padding would eat the whole viewport).
  const edgePadding = () => {
    const w = mapSize?.w ?? 400;
    const h = mapSize?.h ?? 400;
    const vertical = Math.min(90, Math.round(h * 0.2));
    const horizontal = Math.min(70, Math.round(w * 0.14));
    return { top: vertical, right: horizontal, bottom: vertical + bottomPadding, left: horizontal };
  };

  const vehicle = useSmoothVehicle(vehicleFix);
  const vehiclePos = vehicle?.position ?? null;
  const target = phase === 'toPickup' ? pickup : dropoff;

  // Real road geometry (Uber-style) — the full planned trip plus the live
  // leg the vehicle is currently driving. Both fall back to straight lines.
  const tripRoute = useRoute(pickup, dropoff);
  const liveRoute = useRoute(vehiclePos ?? pickup, target, { minMoveMeters: 150 });

  useEffect(() => {
    const timer = setTimeout(() => setTrackVehicle(false), 1500);
    return () => clearTimeout(timer);
  }, [vehicleKind]);

  useEffect(() => {
    lastFitRef.current = null; // phase change reframes even if the car is idle
  }, [phase]);

  useEffect(() => {
    lastFitRef.current = null; // reframe when the map size settles or the road route arrives
  }, [mapSize?.w, mapSize?.h, tripRoute]);

  useEffect(() => {
    if (!ready) return;
    const anchor = vehiclePos ?? pickup;
    if (lastFitRef.current && haversineKm(lastFitRef.current, anchor) * 1000 < 120) return;
    lastFitRef.current = anchor;
    // Previews frame the whole road route; live trips frame the moving parts.
    const coords =
      vehiclePos == null && tripRoute.length > 2 ? tripRoute : [pickup, dropoff, ...(vehiclePos ? [vehiclePos] : [])];
    mapRef.current?.fitToCoordinates?.(coords, {
      edgePadding: edgePadding(),
      animated: true,
    });
  }, [ready, phase, vehiclePos?.latitude, vehiclePos?.longitude, bottomPadding, mapSize?.w, mapSize?.h, tripRoute]);

  const recenter = () => {
    lastFitRef.current = null;
    mapRef.current?.fitToCoordinates?.([pickup, dropoff, ...(vehiclePos ? [vehiclePos] : [])], {
      edgePadding: edgePadding(),
      animated: true,
    });
  };

  const initialRegion = {
    latitude: (pickup.latitude + dropoff.latitude) / 2,
    longitude: (pickup.longitude + dropoff.longitude) / 2,
    latitudeDelta: Math.max(0.02, Math.abs(pickup.latitude - dropoff.latitude) * 2.4),
    longitudeDelta: Math.max(0.02, Math.abs(pickup.longitude - dropoff.longitude) * 2.4),
  };

  const isPreview = vehicleFix == null;

  return (
    <View style={[styles.container, style]} pointerEvents={interactive ? 'auto' : 'none'}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onMapReady={() => setReady(true)}
        onLayout={(e) => setMapSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        pitchEnabled={false}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={false}
      >
        {isPreview ? (
          /* Static route preview (booking screens) — the whole trip, following roads */
          <Polyline coordinates={tripRoute} strokeColor={colors.blue} strokeWidth={5} />
        ) : (
          <>
            {/* Planned trip route (pickup → dropoff), muted while heading to pickup */}
            {phase === 'toPickup' ? (
              <Polyline coordinates={tripRoute} strokeColor={colors.borderStrong} strokeWidth={4} />
            ) : null}
            {/* Live leg the vehicle is driving right now, following roads */}
            <Polyline coordinates={liveRoute} strokeColor={colors.blue} strokeWidth={5} />
          </>
        )}

        <Marker coordinate={pickup} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
          <View style={styles.markerWrap}>
            {pickupLabel ? <LabelChip text={pickupLabel} hint={pickupHint} /> : null}
            {pickupStyle === 'merchant' ? (
              <View style={styles.merchantPin}>
                <Ionicons name="storefront" size={13} color={colors.textOnBrand} />
              </View>
            ) : (
              <VorynPickupPin />
            )}
          </View>
        </Marker>

        <Marker coordinate={dropoff} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
          <View style={styles.markerWrap}>
            {dropoffLabel ? <LabelChip text={dropoffLabel} hint={dropoffHint} icon={dropoffIcon} /> : null}
            <VorynDestinationPin />
          </View>
        </Marker>

        {vehiclePos ? (
          <Marker
            coordinate={vehiclePos}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={vehicle?.bearing ?? 0}
            tracksViewChanges={trackVehicle}
            zIndex={10}
          >
            <VehicleIcon kind={vehicleKind} />
          </Marker>
        ) : null}
      </MapView>

      {interactive ? (
        <Pressable style={[styles.recenter, { bottom: 14 + bottomPadding }]} onPress={recenter} hitSlop={8}>
          <Ionicons name="locate" size={19} color={colors.navy} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  markerWrap: { alignItems: 'center', gap: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    maxWidth: 170,
    ...shadow.card,
  },
  chipBody: { flexShrink: 1 },
  chipText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textPrimary },
  chipHint: { fontSize: 9, color: colors.blue, fontWeight: fontWeight.semibold, marginTop: 1 },
  merchantPin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  recenter: {
    position: 'absolute',
    right: 14,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
});
