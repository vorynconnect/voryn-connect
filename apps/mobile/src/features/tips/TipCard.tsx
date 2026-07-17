import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';
import { formatJmd } from '@/lib/format';
import { MIN_TIP_MINOR, TipSelector } from './TipSelector';

type Props = {
  title: string;
  subtitle: string;
  /** Sends the tip (e.g. POST the tip endpoint). Throw to show the error inline. */
  onSubmit: (tipMinor: number) => Promise<unknown>;
};

/** Post-trip tip card: pick an amount, send once, thank-you state after. */
export function TipCard({ title, subtitle, onSubmit }: Props) {
  const [tipMinor, setTipMinor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sentMinor, setSentMinor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (sentMinor != null) {
    return (
      <Card style={styles.card}>
        <View style={styles.sentRow}>
          <Ionicons name="heart-circle" size={36} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.sentTitle}>Tip sent — thank you!</Text>
            <Text style={styles.subtitle}>{formatJmd(sentMinor)} goes straight to their wallet.</Text>
          </View>
        </View>
      </Card>
    );
  }

  const send = async () => {
    if (tipMinor < MIN_TIP_MINOR) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(tipMinor);
      setSentMinor(tipMinor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your tip.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <View style={{ height: spacing.md }} />
      <TipSelector valueMinor={tipMinor} onChange={setTipMinor} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={{ height: spacing.base }} />
      <GradientButton
        title={tipMinor >= MIN_TIP_MINOR ? `Send ${formatJmd(tipMinor)} tip` : 'Send a tip'}
        icon="heart-outline"
        disabled={tipMinor < MIN_TIP_MINOR}
        loading={submitting}
        onPress={send}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  title: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  error: { color: colors.danger, fontSize: fontSize.sm, marginTop: spacing.md },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sentTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
});
