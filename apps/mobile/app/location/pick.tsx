import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton } from '@/components/GradientButton';
import { reverseLabel } from '@/features/map/geocode';
import { DEFAULT_PICKUP } from '@/features/map/useCurrentLocation';
import type { LatLng } from '@/features/map/geo';
import { useLocationPick } from '@/stores/locationPick';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';

const REGION_DELTA = { latitudeDelta: 0.012, longitudeDelta: 0.012 };

/**
 * "Choose on map": pan/zoom under a fixed centre pin, reverse-geocode where
 * the map settles, confirm. The result is published to the locationPick store
 * under the caller's token — see useLocationPick.
 */
export default function PickLocationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const publish = useLocationPick((s) => s.publish);
  const params = useLocalSearchParams<{ token: string; title?: string; lat?: string; lng?: string }>();

  const initial: LatLng =
    params.lat && params.lng
      ? { latitude: Number(params.lat), longitude: Number(params.lng) }
      : DEFAULT_PICKUP;

  const [center, setCenter] = useState<LatLng>(initial);
  const [label, setLabel] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reverse-geocode where the map settles — debounced so panning doesn't
  // fire a lookup per frame (each one costs provider quota).
  useEffect(() => {
    setResolving(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const name = await reverseLabel(center);
      setLabel(name);
      setResolving(false);
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [center.latitude, center.longitude]);

  const confirm = () => {
    publish({
      token: params.token ?? 'pick',
      name: label ?? 'Dropped pin',
      latitude: center.latitude,
      longitude: center.longitude,
    });
    router.back();
  };

  return (
    <View style={styles.flex}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...initial, ...REGION_DELTA }}
        onRegionChangeComplete={(region) =>
          setCenter({ latitude: region.latitude, longitude: region.longitude })
        }
      />

      {/* Fixed centre pin — the tip marks the selected point. */}
      <View pointerEvents="none" style={styles.pinWrap}>
        <Ionicons name="location" size={44} color={colors.blue} style={styles.pin} />
        <View style={styles.pinShadow} />
      </View>

      <Pressable
        style={[styles.backBtn, { top: insets.top + spacing.md }]}
        onPress={() => router.back()}
        hitSlop={8}
      >
        <Ionicons name="arrow-back" size={20} color={colors.navy} />
      </Pressable>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.sheetTitle}>{params.title ?? 'Choose location'}</Text>
        <View style={styles.addressRow}>
          <View style={styles.addressIcon}>
            <Ionicons name="location-outline" size={18} color={colors.blue} />
          </View>
          {resolving ? (
            <View style={styles.addressLoading}>
              <ActivityIndicator size="small" color={colors.blue} />
              <Text style={styles.addressHint}>Finding address…</Text>
            </View>
          ) : (
            <Text style={styles.addressText} numberOfLines={2}>
              {label ?? 'Dropped pin — move the map to adjust'}
            </Text>
          )}
        </View>
        <Text style={styles.helper}>Move the map until the pin sits on the exact spot.</Text>
        <GradientButton title="Confirm location" onPress={confirm} disabled={resolving} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  pinWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  // Lift the icon so its tip (bottom centre) touches the map centre.
  pin: { marginBottom: 40, textShadowColor: 'rgba(22,48,93,0.3)', textShadowRadius: 6 },
  pinShadow: {
    position: 'absolute',
    width: 10,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(22,48,93,0.35)',
    top: '50%',
    marginTop: -2,
  },
  backBtn: {
    position: 'absolute',
    left: spacing.lg,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    ...shadow.raised,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    zIndex: 20,
    ...shadow.raised,
  },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  addressIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressLoading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addressHint: { color: colors.textSecondary, fontSize: fontSize.base },
  addressText: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  helper: { color: colors.textSecondary, fontSize: fontSize.sm, marginBottom: spacing.base },
});
