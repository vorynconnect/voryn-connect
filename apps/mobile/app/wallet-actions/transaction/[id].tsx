import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { WalletTransaction } from '@/lib/types';

const STATUS_TONES: Record<string, { label: string; color: string; tint: string }> = {
  COMPLETED: { label: 'Completed', color: colors.success, tint: colors.successTint },
  PENDING: { label: 'Pending', color: colors.warning, tint: colors.warningTint },
  FAILED: { label: 'Failed', color: colors.danger, tint: colors.dangerTint },
  REVERSED: { label: 'Reversed', color: colors.textSecondary, tint: colors.surfaceMuted },
};

const TYPE_LABELS: Record<string, string> = {
  TOP_UP: 'Top up',
  PURCHASE: 'Purchase',
  REFUND: 'Refund',
  TRANSFER_IN: 'Transfer received',
  TRANSFER_OUT: 'Transfer sent',
  WITHDRAWAL: 'Withdrawal',
  PROMO_CREDIT: 'Rewards credit',
  REVERSAL: 'Reversal',
  ADJUSTMENT: 'Adjustment',
};

/** Transaction details — a single ledger entry. */
export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const txQuery = useQuery({
    queryKey: ['wallet-transaction', id],
    queryFn: () => api<{ transaction: WalletTransaction }>(`/v1/wallet/transactions/${id}`),
  });

  if (txQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading transaction…" />
      </View>
    );
  }
  if (txQuery.isError || !txQuery.data) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => txQuery.refetch()} />
      </View>
    );
  }

  const tx = txQuery.data.transaction;
  const credit = tx.amountMinor >= 0;
  const tone = STATUS_TONES[tx.status] ?? STATUS_TONES.COMPLETED!;
  const when = new Date(tx.createdAt);

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: credit ? colors.successTint : colors.skyTint }]}>
            <Ionicons
              name={credit ? 'arrow-down-outline' : 'arrow-up-outline'}
              size={28}
              color={credit ? colors.success : colors.blue}
            />
          </View>
          <Text style={[styles.amount, { color: credit ? colors.success : colors.textPrimary }]}>
            {credit ? '+' : '−'}
            {formatJmd(Math.abs(tx.amountMinor))}
          </Text>
          <Text style={styles.description}>{tx.description}</Text>
          <View style={[styles.statusPill, { backgroundColor: tone.tint }]}>
            <View style={[styles.statusDot, { backgroundColor: tone.color }]} />
            <Text style={[styles.statusText, { color: tone.color }]}>{tone.label}</Text>
          </View>
        </View>

        <Card padded={false} style={styles.detailsCard}>
          {[
            { label: 'Type', value: TYPE_LABELS[tx.type] ?? tx.type },
            ...(tx.counterpartyName ? [{ label: credit ? 'From' : 'To', value: tx.counterpartyName }] : []),
            {
              label: 'Date',
              value: `${when.toLocaleDateString('en-JM', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}, ${when.toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' })}`,
            },
            { label: 'Balance after', value: formatJmd(tx.balanceAfterMinor) },
            { label: 'Reference', value: tx.id },
          ].map((row, i, arr) => (
            <View key={row.label} style={[styles.detailRow, i < arr.length - 1 && styles.detailBorder]}>
              <Text style={styles.detailLabel}>{row.label}</Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                {row.value}
              </Text>
            </View>
          ))}
        </Card>

        <View style={styles.helpRow}>
          <Ionicons name="help-circle-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.helpText}>Questions about this transaction? Contact Support from your Profile.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  hero: { alignItems: 'center', marginBottom: spacing.lg },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  amount: { fontSize: 36, fontWeight: fontWeight.heavy },
  description: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 4, textAlign: 'center' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  detailsCard: { marginBottom: spacing.base },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.base,
    padding: spacing.base,
  },
  detailBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  detailLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  detailValue: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary, textAlign: 'right' },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  helpText: { fontSize: fontSize.xs, color: colors.textSecondary },
});
