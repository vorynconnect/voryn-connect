import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { DriverHeader } from '@/features/driver/DriverHeader';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { WalletSnapshot, WalletTransaction } from '@/lib/types';

const TX_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; tint: string; color: string }> = {
  PAYOUT: { icon: 'car-outline', tint: '#EAF3FE', color: '#1F7CF6' },
  WITHDRAWAL: { icon: 'arrow-up-outline', tint: '#E8F7EE', color: '#16A34A' },
  PROMO_CREDIT: { icon: 'star-outline', tint: '#F1ECFE', color: '#7C3AED' },
  TRANSFER_IN: { icon: 'arrow-down-outline', tint: '#E8F7EE', color: '#16A34A' },
  TRANSFER_OUT: { icon: 'paper-plane-outline', tint: '#EAF3FE', color: '#1F7CF6' },
};

function txTitle(tx: WalletTransaction): string {
  if (tx.type === 'PAYOUT') return 'Trip payout';
  if (tx.type === 'WITHDRAWAL') return 'Cash out to bank';
  if (tx.type === 'PROMO_CREDIT') return 'Bonus';
  return tx.description;
}

/** Driver Wallet — balance, payout method, transactions, cash out. */
export default function DriverWalletScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState(false);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSnapshot>('/v1/wallet') });
  const txQuery = useQuery({
    queryKey: ['wallet-transactions'],
    queryFn: () => api<{ transactions: WalletTransaction[] }>('/v1/wallet/transactions?limit=10'),
  });

  const balance = walletQuery.data?.wallet.balanceMinor ?? 0;

  const cashoutMutation = useMutation({
    // Fresh idempotency key per attempt — a fixed key would swallow repeat cash-outs.
    mutationFn: (amountMinor: number) =>
      api('/v1/wallet/withdraw', {
        method: 'POST',
        body: { amountMinor, idempotencyKey: `cashout-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      }),
    onSuccess: (_data, amountMinor) => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
      setDialog({
        title: 'Cash out requested',
        message: `${formatJmd(amountMinor)} is on its way. Bank transfers arrive within 1–2 business days.`,
      });
    },
    onError: (err) =>
      setDialog({ title: 'Cash out failed', message: err instanceof ApiError ? err.message : 'Try again.' }),
  });

  const cashOut = () => {
    if (balance <= 0) {
      setDialog({ title: 'Nothing to cash out', message: 'Complete trips to earn payouts first.' });
      return;
    }
    setDialog({
      title: 'Cash out now?',
      message: `Withdraw ${formatJmd(balance)} to your bank account.`,
      confirmLabel: 'Cash out',
      onConfirm: () => cashoutMutation.mutate(balance),
    });
  };

  if (walletQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <DriverHeader />
        <LoadingState label="Loading wallet…" />
      </View>
    );
  }
  if (walletQuery.isError) {
    return (
      <View style={styles.flex}>
        <DriverHeader />
        <ErrorState onRetry={() => walletQuery.refetch()} />
      </View>
    );
  }

  const transactions = (txQuery.data?.transactions ?? []).filter((tx) =>
    ['PAYOUT', 'WITHDRAWAL', 'PROMO_CREDIT', 'TRANSFER_IN', 'TRANSFER_OUT'].includes(tx.type),
  );

  const fmtWhen = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-JM', { month: 'short', day: 'numeric', year: 'numeric' })} • ${d.toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' })}`;
  };

  return (
    <View style={styles.flex}>
      <DriverHeader />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={walletQuery.isRefetching} onRefresh={() => walletQuery.refetch()} tintColor={colors.blue} />}
      >
        <Text style={styles.title}>Wallet</Text>

        {/* Balance cards */}
        <View style={styles.balanceRow}>
          <View style={[styles.balanceCard, { backgroundColor: colors.skyTint }]}>
            <View style={styles.balanceHead}>
              <Text style={styles.balanceLabel}>Available balance</Text>
              <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
                <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.blue} />
              </Pressable>
            </View>
            <Text style={styles.balanceValue}>{hidden ? '•••••' : formatJmd(balance)}</Text>
            <Text style={styles.balanceMeta}>Ready to cash out</Text>
          </View>
          <View style={[styles.balanceCard, { backgroundColor: colors.warningTint }]}>
            <View style={styles.balanceHead}>
              <Text style={styles.balanceLabel}>Earnings pending</Text>
              <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
            </View>
            <Text style={styles.balanceValue}>{formatJmd(0)}</Text>
            <Text style={styles.balanceMeta}>Payouts land instantly — nothing clearing</Text>
          </View>
        </View>

        {/* Quick actions */}
        <Card padded={false} style={styles.quickCard}>
          {(
            [
              { icon: 'card-outline' as const, label: 'Cash Out', onPress: cashOut },
              // One shared wallet across modes — reuse the customer send-money flow.
              { icon: 'swap-horizontal-outline' as const, label: 'Transfer', onPress: () => router.push('/wallet-actions/send') },
              { icon: 'document-text-outline' as const, label: 'Transaction History', onPress: () => router.push('/wallet-actions/transactions') },
            ] as const
          ).map((action, i, arr) => (
            <Pressable key={action.label} style={[styles.quickAction, i < arr.length - 1 && styles.quickBorder]} onPress={action.onPress}>
              <View style={styles.quickIcon}>
                <Ionicons name={action.icon} size={19} color={colors.textOnBrand} />
              </View>
              <Text style={styles.quickLabel} numberOfLines={2}>{action.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>
          ))}
        </Card>

        {/* Payout method */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Payout method</Text>
          <Pressable onPress={() => router.push('/wallet-actions/payment-methods')}>
            <Text style={styles.manageLink}>Manage</Text>
          </Pressable>
        </View>
        <View style={styles.methodRow}>
          <Card style={[styles.methodCard, styles.methodActive]}>
            <View style={styles.methodIcon}>
              <Ionicons name="business-outline" size={20} color={colors.blue} />
            </View>
            <Text style={styles.methodTitle}>Bank Account</Text>
            <Text style={styles.methodMeta}>Linked via Voryn Finance</Text>
            <View style={styles.defaultBadge}>
              <Text style={styles.defaultText}>Default</Text>
            </View>
            <View style={styles.methodCheck}>
              <Ionicons name="checkmark" size={13} color={colors.textOnBrand} />
            </View>
          </Card>
          <Card style={styles.methodCard}>
            <View style={styles.methodIcon}>
              <Ionicons name="wallet" size={20} color={colors.blue} />
            </View>
            <Text style={styles.methodTitle}>Voryn Wallet</Text>
            <Text style={styles.methodMeta}>Instant cash out</Text>
            <View style={[styles.defaultBadge, { backgroundColor: colors.successTint }]}>
              <Text style={[styles.defaultText, { color: colors.success }]}>Active</Text>
            </View>
          </Card>
        </View>

        {/* Recent transactions */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Recent transactions</Text>
          <Pressable onPress={() => router.push('/wallet-actions/transactions')}>
            <Text style={styles.manageLink}>View all</Text>
          </Pressable>
        </View>
        <Card padded={false} style={styles.txCard}>
          {transactions.length === 0 ? (
            <View style={styles.txEmpty}>
              <Text style={styles.txEmptyText}>No payouts yet — complete a trip to see your first payout here.</Text>
            </View>
          ) : (
            transactions.map((tx, i) => {
              const meta = TX_ICONS[tx.type] ?? TX_ICONS.PAYOUT!;
              const credit = tx.amountMinor >= 0;
              return (
                <Pressable
                  key={tx.id}
                  style={[styles.txRow, i < transactions.length - 1 && styles.txBorder]}
                  onPress={() => router.push({ pathname: '/wallet-actions/transaction/[id]', params: { id: tx.id } })}
                >
                  <View style={[styles.txIcon, { backgroundColor: meta.tint }]}>
                    <Ionicons name={meta.icon} size={18} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txTitle}>{txTitle(tx)}</Text>
                    <Text style={styles.txMeta}>{fmtWhen(tx.createdAt)}</Text>
                  </View>
                  <Text style={[styles.txAmount, { color: credit ? colors.success : colors.danger }]}>
                    {credit ? '+' : '−'}
                    {formatJmd(Math.abs(tx.amountMinor))}
                  </Text>
                  <Ionicons name="chevron-forward" size={15} color={colors.textSecondary} />
                </Pressable>
              );
            })
          )}
        </Card>

        <GradientButton title="Cash out now" icon="card-outline" loading={cashoutMutation.isPending} onPress={cashOut} />
      </ScrollView>
      <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: 26, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginBottom: spacing.base },
  balanceRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  balanceCard: { flex: 1, borderRadius: radius.lg, padding: spacing.base },
  balanceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balanceLabel: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: fontWeight.medium },
  balanceValue: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 8 },
  balanceMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 4 },
  quickCard: { marginBottom: spacing.base, flexDirection: 'row' },
  quickAction: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, padding: spacing.md },
  quickBorder: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  quickIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: { flex: 1, fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textPrimary },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  manageLink: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  methodRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.base },
  methodCard: { flex: 1, position: 'relative' },
  methodActive: { borderWidth: 1.5, borderColor: colors.blue },
  methodIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  methodTitle: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  methodMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  defaultBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    marginTop: spacing.md,
  },
  defaultText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  methodCheck: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txCard: { marginBottom: spacing.base },
  txEmpty: { padding: spacing.lg },
  txEmptyText: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  txBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  txIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  txTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  txMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  txAmount: { fontSize: fontSize.base, fontWeight: fontWeight.heavy },
});
