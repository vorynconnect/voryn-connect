import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { useAuth } from '@/stores/auth';

/** Receive — personal QR code another Voryn customer scans to pay you. */
export default function ReceiveScreen() {
  const user = useAuth((s) => s.user);
  const phone = user?.phone ?? '';
  const payload = JSON.stringify({ v: 1, type: 'voryn-pay', phone, name: user?.fullName ?? '' });

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <View style={styles.container}>
        <Text style={styles.title}>Receive Money</Text>
        <Text style={styles.subtitle}>Let another Voryn Connect customer scan your code.</Text>

        <Card style={styles.qrCard}>
          <View style={styles.qrWrap}>
            {phone ? (
              <QRCode value={payload} size={210} color={colors.navy} backgroundColor="#FFFFFF" />
            ) : (
              <Text style={styles.qrMissing}>Add a phone number to your account to receive payments.</Text>
            )}
          </View>
          <Text style={styles.name}>{user?.fullName}</Text>
          {phone ? (
            <Pressable
              style={styles.phoneRow}
              onPress={async () => {
                await Clipboard.setStringAsync(phone);
              }}
            >
              <Text style={styles.phone}>{phone}</Text>
              <Ionicons name="copy-outline" size={16} color={colors.blue} />
            </Pressable>
          ) : null}
        </Card>

        <GradientButton
          title="Share payment details"
          icon="share-outline"
          disabled={!phone}
          onPress={() =>
            Share.share({
              message: `Pay me on Voryn Connect — send to ${phone} (${user?.fullName}).`,
            })
          }
        />
        <View style={styles.hintRow}>
          <Ionicons name="shield-checkmark-outline" size={15} color={colors.textSecondary} />
          <Text style={styles.hintText}>Transfers arrive instantly in your Voryn Wallet.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg },
  qrCard: { alignItems: 'center', paddingVertical: spacing.xl, marginBottom: spacing.lg },
  qrWrap: {
    padding: spacing.base,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.base,
  },
  qrMissing: { width: 210, textAlign: 'center', color: colors.textSecondary, fontSize: fontSize.sm },
  name: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  phone: { fontSize: fontSize.base, color: colors.textSecondary },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: spacing.base },
  hintText: { fontSize: fontSize.xs, color: colors.textSecondary },
});
