import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GradientButton } from '@/components/GradientButton';
import { Card } from '@/components/Card';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';

type Props = {
  tone: 'success' | 'pending' | 'failed';
  title: string;
  body: string;
  detailRows?: Array<{ label: string; value: string }>;
  ctaTitle?: string;
  onCta?: () => void;
};

const TONES = {
  success: { icon: 'checkmark' as const, color: colors.success, tint: colors.successTint },
  pending: { icon: 'time-outline' as const, color: colors.warning, tint: colors.warningTint },
  failed: { icon: 'close' as const, color: colors.danger, tint: colors.dangerTint },
};

/** Terminal state for wallet actions — success, pending, or failed. */
export function ActionResult({ tone, title, body, detailRows, ctaTitle, onCta }: Props) {
  const router = useRouter();
  const t = TONES[tone];
  return (
    <View style={styles.wrap}>
      <View style={[styles.circle, { backgroundColor: t.color }]}>
        <Ionicons name={t.icon} size={46} color={colors.textOnBrand} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {detailRows?.length ? (
        <Card style={styles.detailCard}>
          {detailRows.map((row) => (
            <View key={row.label} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{row.label}</Text>
              <Text style={styles.detailValue}>{row.value}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      <GradientButton
        title={ctaTitle ?? 'Back to Wallet'}
        icon="wallet-outline"
        style={styles.cta}
        onPress={onCta ?? (() => router.back())}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: spacing.xl },
  circle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
  },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary, textAlign: 'center' },
  body: { fontSize: fontSize.base, color: colors.textSecondary, textAlign: 'center', marginTop: 6, paddingHorizontal: spacing.lg },
  detailCard: { alignSelf: 'stretch', marginTop: spacing.lg },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  detailValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  cta: { alignSelf: 'stretch', marginTop: spacing.xl },
});
