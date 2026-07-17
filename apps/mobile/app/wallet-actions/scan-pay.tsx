import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ScreenHeader } from '@/components/ScreenHeader';
import { GradientButton } from '@/components/GradientButton';
import { BrandTextField } from '@/components/BrandTextField';
import { Card } from '@/components/Card';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';

type PayTarget = { phone: string; name?: string };

function parsePayload(data: string): PayTarget | null {
  try {
    const parsed = JSON.parse(data) as { type?: string; phone?: string; name?: string };
    if (parsed.type === 'voryn-pay' && typeof parsed.phone === 'string' && parsed.phone.length >= 7) {
      return { phone: parsed.phone, name: parsed.name };
    }
  } catch {
    // Not a Voryn payload — fall through.
  }
  return null;
}

/** Scan to Pay — scan another customer's or provider's Voryn QR code. */
export default function ScanPayScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [manualPhone, setManualPhone] = useState('');

  const goToSend = (target: PayTarget) =>
    router.replace({
      pathname: '/wallet-actions/send',
      params: { to: target.phone, ...(target.name ? { name: target.name } : {}) },
    });

  const onBarcode = ({ data }: { data: string }) => {
    if (scanned) return;
    const target = parsePayload(data);
    if (target) {
      setScanned(true);
      goToSend(target);
    } else {
      setInvalid(true);
    }
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <View style={styles.container}>
        <Text style={styles.title}>Scan to Pay</Text>
        <Text style={styles.subtitle}>Point your camera at a Voryn Connect QR code.</Text>

        <View style={styles.scannerWrap}>
          {permission?.granted ? (
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onBarcode}
            />
          ) : (
            <View style={styles.permissionBox}>
              <Ionicons name="camera-outline" size={40} color={colors.textMuted} />
              <Text style={styles.permissionText}>
                {permission === null
                  ? 'Checking camera access…'
                  : 'Camera access is needed to scan QR codes.'}
              </Text>
              {permission && !permission.granted ? (
                <Pressable style={styles.permissionButton} onPress={requestPermission}>
                  <Text style={styles.permissionButtonText}>Allow camera</Text>
                </Pressable>
              ) : null}
            </View>
          )}
          <View pointerEvents="none" style={styles.frame} />
        </View>

        {invalid ? (
          <Text style={styles.invalidText}>That QR code isn’t a Voryn Connect payment code.</Text>
        ) : null}

        <Card style={styles.manualCard}>
          <Text style={styles.manualTitle}>No code to scan?</Text>
          <BrandTextField
            icon="call-outline"
            placeholder="Enter recipient phone number"
            keyboardType="phone-pad"
            value={manualPhone}
            onChangeText={(text) => {
              setManualPhone(text);
              setInvalid(false);
            }}
          />
          <GradientButton
            title="Continue to pay"
            icon="paper-plane-outline"
            disabled={manualPhone.trim().length < 7}
            onPress={() => goToSend({ phone: manualPhone.trim() })}
          />
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  scannerWrap: {
    height: 300,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.navy,
    marginBottom: spacing.base,
  },
  camera: { flex: 1 },
  frame: {
    position: 'absolute',
    top: 40,
    left: 60,
    right: 60,
    bottom: 40,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: radius.lg,
  },
  permissionBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  permissionText: { color: '#FFFFFF', textAlign: 'center', fontSize: fontSize.sm, opacity: 0.9 },
  permissionButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  permissionButtonText: { color: colors.blue, fontWeight: fontWeight.bold },
  invalidText: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center', marginBottom: spacing.md },
  manualCard: {},
  manualTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
});
