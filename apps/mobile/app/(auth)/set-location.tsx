import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';

// Portmore town centre — initial map region for the launch market.
const PORTMORE = { latitude: 17.9583, longitude: -76.8822, latitudeDelta: 0.06, longitudeDelta: 0.06 };

/** Onboarding step 3 of 4 — "Set your location". */
export default function SetLocationScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [marker, setMarker] = useState<{ latitude: number; longitude: number } | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  // Set when the notice should move the user along once dismissed.
  const continueAfterDialog = useRef(false);

  const saveAddress = async (lat: number, lng: number, name: string) => {
    await api('/v1/users/me/addresses', {
      method: 'POST',
      body: {
        label: 'HOME',
        name,
        line1: name,
        latitude: lat,
        longitude: lng,
        isDefault: true,
      },
    });
  };

  const allowLocation = async () => {
    setBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        continueAfterDialog.current = true;
        setDialog({
          title: 'Location unavailable',
          message: 'You can still browse Portmore providers. Add an address manually anytime from your profile.',
        });
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      setMarker(position.coords);
      await saveAddress(position.coords.latitude, position.coords.longitude, 'Current location');
      router.push('/(auth)/enable-notifications');
    } catch {
      setDialog({ title: 'GPS unavailable', message: 'We could not read your location. You can add an address manually.' });
    } finally {
      setBusy(false);
    }
  };

  const addManually = () => {
    // Manual entry saves the Portmore default; editable later in Profile → Addresses.
    void saveAddress(PORTMORE.latitude, PORTMORE.longitude, 'Portmore, Jamaica').catch(() => undefined);
    router.push('/(auth)/enable-notifications');
  };

  return (
    <View style={styles.flex}>
      <AuthBackdrop />
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>

        <BrandLogo height={52} />

        <Text style={styles.title}>Set your location</Text>
        <Text style={styles.subtitle}>
          We use your location to power rides,{'\n'}deliveries, and nearby services
        </Text>

        <View style={styles.card}>
          <View style={styles.mapWrap}>
            <MapView style={styles.map} initialRegion={PORTMORE} pointerEvents="none">
              {marker ? <Marker coordinate={marker} /> : <Marker coordinate={PORTMORE} />}
            </MapView>
          </View>

          <Pressable style={styles.option} onPress={allowLocation}>
            <View style={styles.optionIcon}>
              <Ionicons name="navigate-outline" size={20} color={colors.blue} />
            </View>
            <Text style={styles.optionText}>Use current location</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </Pressable>

          <Pressable style={styles.option} onPress={addManually}>
            <View style={styles.optionIcon}>
              <Ionicons name="location-outline" size={20} color={colors.blue} />
            </View>
            <Text style={styles.optionText}>Add address manually</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.noteRow}>
          <Ionicons name="shield-checkmark-outline" size={22} color={colors.blue} />
          <Text style={styles.note}>
            Your location helps us show accurate nearby providers and delivery options.
          </Text>
        </View>

        <GradientButton title="Allow Location" icon="location-outline" onPress={allowLocation} loading={busy} />

        <View style={styles.stepsRow}>
          <View style={[styles.stepDot, styles.stepDone]}>
            <Ionicons name="checkmark" size={14} color={colors.textOnBrand} />
          </View>
          <View style={[styles.stepLine, styles.stepLineDone]} />
          <View style={[styles.stepDot, styles.stepDone]}>
            <Ionicons name="checkmark" size={14} color={colors.textOnBrand} />
          </View>
          <View style={[styles.stepLine, styles.stepLineDone]} />
          <View style={[styles.stepDot, styles.stepCurrent]}>
            <Text style={styles.stepCurrentText}>3</Text>
          </View>
          <View style={styles.stepLine} />
          <View style={styles.stepDot}>
            <Text style={styles.stepFutureText}>4</Text>
          </View>
        </View>
        <Text style={styles.stepLabel}>Step 3 of 4</Text>
      </ScrollView>
      <ConfirmDialog
        spec={dialog}
        onClose={() => {
          setDialog(null);
          if (continueAfterDialog.current) {
            continueAfterDialog.current = false;
            router.push('/(auth)/enable-notifications');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: 64, paddingBottom: spacing['2xl'] },
  backButton: {
    position: 'absolute',
    top: 58,
    left: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
    zIndex: 2,
  },
  title: {
    fontSize: 34,
    fontWeight: fontWeight.heavy,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    lineHeight: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.base,
    ...shadow.card,
    marginBottom: spacing.lg,
  },
  mapWrap: { borderRadius: radius.lg, overflow: 'hidden', height: 210, marginBottom: spacing.base },
  map: { flex: 1 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  optionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  optionText: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xl,
  },
  note: { flex: 1, color: colors.textSecondary, fontSize: fontSize.base, lineHeight: 21 },
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing['2xl'],
  },
  stepDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDone: { backgroundColor: colors.blue, borderColor: colors.blue },
  stepCurrent: { borderColor: colors.blue },
  stepCurrentText: { color: colors.blue, fontWeight: fontWeight.bold },
  stepFutureText: { color: colors.textMuted, fontWeight: fontWeight.semibold },
  stepLine: { width: 56, height: 3, backgroundColor: colors.border },
  stepLineDone: { backgroundColor: colors.blue },
  stepLabel: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.md, fontSize: fontSize.base },
});
