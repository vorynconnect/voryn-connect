import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ErrorState, Skeleton } from '@/components/States';
import { colors, fontSize, fontWeight, gradients, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd, formatPoints } from '@/lib/format';
import type { PaymentMethod, WalletSnapshot, WalletTransaction } from '@/lib/types';

function txMeta(tx: WalletTransaction): { sign: string; color: string } {
  return tx.amountMinor >= 0
    ? { sign: '+', color: colors.blue }
    : { sign: '−', color: colors.textPrimary };
}

function txDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return `Today, ${d.toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' })}`;
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-JM', { month: 'short', day: 'numeric' });
}

export default function WalletScreen() {
  const router = useRouter();

  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSnapshot>('/v1/wallet') });
  const txQuery = useQuery({
    queryKey: ['wallet-transactions'],
    queryFn: () => api<{ transactions: WalletTransaction[] }>('/v1/wallet/transactions?limit=6'),
  });
  const methodsQuery = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api<{ methods: PaymentMethod[] }>('/v1/wallet/payment-methods'),
  });

  const refetchAll = () => {
    void walletQuery.refetch();
    void txQuery.refetch();
    void methodsQuery.refetch();
  };

  if (walletQuery.isError) {
    return (
      <View style={styles.flex}>
        <ScreenHeader />
        <ErrorState onRetry={refetchAll} />
      </View>
    );
  }

  // Month stats derived from the ledger (spend = debits this month).
  const now = new Date();
  const txs = txQuery.data?.transactions ?? [];
  const monthTx = txs.filter((t) => {
    const d = new Date(t.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const spentMinor = monthTx.filter((t) => t.amountMinor < 0).reduce((s, t) => s - t.amountMinor, 0);
  const savedMinor = monthTx
    .filter((t) => t.type === 'PROMO_CREDIT' || t.type === 'REFUND')
    .reduce((s, t) => s + t.amountMinor, 0);

  return (
    <View style={styles.flex}>
      <ScreenHeader />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={walletQuery.isRefetching} onRefresh={refetchAll} tintColor={colors.blue} />}
      >
        <Text style={styles.title}>Voryn Wallet</Text>
        <Text style={styles.subtitle}>Manage your money, rewards, and payments</Text>

        {/* Balance card */}
        <LinearGradient colors={gradients.walletCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available balance</Text>
          {walletQuery.isLoading ? (
            <Skeleton height={40} width={220} style={{ backgroundColor: 'rgba(255,255,255,0.25)' }} />
          ) : (
            <Text style={styles.balanceValue}>{walletQuery.data ? formatJmd(walletQuery.data.wallet.balanceMinor) : '—'}</Text>
          )}
          <Text style={styles.pointsLabel}>
            Voryn Points: <Text style={styles.pointsValue}>{formatPoints(walletQuery.data?.loyalty.pointsBalance ?? 0)}</Text>
            {' '}· redeem at checkout
          </Text>
          <View style={styles.balanceActions}>
            {(
              [
                { label: 'Top Up', icon: 'add', href: '/wallet-actions/top-up' },
                { label: 'Send', icon: 'paper-plane-outline', href: '/wallet-actions/send' },
                { label: 'Withdraw', icon: 'arrow-up-outline', href: '/wallet-actions/withdraw' },
                { label: 'Pay', icon: 'qr-code-outline', href: '/wallet-actions/scan-pay' },
              ] as const
            ).map((action, i) => (
              <View key={action.label} style={styles.balanceActionWrap}>
                {i > 0 ? <View style={styles.balanceDivider} /> : null}
                <Pressable style={styles.balanceAction} onPress={() => router.push(action.href)}>
                  <View style={styles.balanceActionIcon}>
                    <Ionicons name={action.icon} size={17} color={colors.textOnBrand} />
                  </View>
                  <Text style={styles.balanceActionText}>{action.label}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </LinearGradient>

        {/* Month stats */}
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: colors.skyTint }]}>
              <Ionicons name="trending-up" size={20} color={colors.blue} />
            </View>
            <View style={styles.statText}>
              <Text style={styles.statLabel}>This month spent</Text>
              <Text style={styles.statValue}>{formatJmd(spentMinor)}</Text>
            </View>
          </Card>
          <Card style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: colors.successTint }]}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            </View>
            <View style={styles.statText}>
              <Text style={styles.statLabel}>Saved with offers</Text>
              <Text style={styles.statValue}>{formatJmd(savedMinor)}</Text>
            </View>
          </Card>
        </View>

        {/* Quick actions */}
        <Card style={styles.quickRow} padded={false}>
          {(
            [
              { label: 'Scan to Pay', icon: 'qr-code-outline', href: '/wallet-actions/scan-pay' },
              { label: 'Transfer to provider', icon: 'people-outline', href: '/wallet-actions/send' },
              { label: 'Redeem points', icon: 'gift-outline', href: '/wallet-actions/redeem' },
              { label: 'Bills & utilities', icon: 'reader-outline', href: '/wallet-actions/bills' },
            ] as const
          ).map((item) => (
            <Pressable key={item.label} style={styles.quickItem} onPress={() => router.push(item.href)}>
              <View style={styles.quickIcon}>
                <Ionicons name={item.icon} size={22} color={colors.blue} />
              </View>
              <Text style={styles.quickLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </Card>

        {/* Payment methods */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Payment methods</Text>
          <Pressable onPress={() => router.push('/wallet-actions/payment-methods')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.methodsRow}>
          <Card style={styles.walletMethod}>
            <View style={styles.methodLogoWrap}>
              <Ionicons name="wallet" size={22} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.methodTitle}>Voryn Wallet</Text>
              <Text style={styles.methodMeta}>Primary account</Text>
              <View style={styles.defaultBadge}>
                <Text style={styles.defaultBadgeText}>Default</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Card>
          {(methodsQuery.data?.methods ?? [])
            .filter((m) => m.type === 'CARD')
            .map((method) => (
              <LinearGradient key={method.id} colors={gradients.banner} style={styles.cardMethod}>
                <Text style={styles.cardBrand}>{(method.brand ?? 'CARD').toUpperCase()}</Text>
                <Text style={styles.cardNumber}>•••• {method.last4}</Text>
                <Text style={styles.cardExpiry}>
                  Expires {String(method.expMonth).padStart(2, '0')}/{String(method.expYear).slice(-2)}
                </Text>
              </LinearGradient>
            ))}
          <Pressable style={styles.addMethod} onPress={() => router.push('/wallet-actions/payment-methods')}>
            <View style={styles.addMethodIcon}>
              <Ionicons name="add" size={22} color={colors.blue} />
            </View>
            <Text style={styles.addMethodText}>Add new method</Text>
          </Pressable>
        </ScrollView>

        {/* Recent transactions */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Recent transactions</Text>
          <Pressable onPress={() => router.push('/wallet-actions/transactions')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        <Card padded={false} style={styles.txCard}>
          {txQuery.isLoading ? (
            <View style={{ padding: spacing.base, gap: spacing.md }}>
              <Skeleton height={44} />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </View>
          ) : txs.length === 0 ? (
            <View style={styles.txEmpty}>
              <Text style={styles.txEmptyText}>No transactions yet. Top up to get started.</Text>
            </View>
          ) : (
            txs.map((tx, i) => {
              const meta = txMeta(tx);
              return (
                <Pressable
                  key={tx.id}
                  style={[styles.txRow, i < txs.length - 1 && styles.txRowBorder]}
                  onPress={() => router.push({ pathname: '/wallet-actions/transaction/[id]', params: { id: tx.id } })}
                >
                  <View style={styles.txIcon}>
                    <Ionicons
                      name={tx.amountMinor >= 0 ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
                      size={22}
                      color={colors.blue}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txTitle} numberOfLines={1}>
                      {tx.counterpartyName ?? tx.description}
                    </Text>
                    <Text style={styles.txMeta} numberOfLines={1}>
                      {tx.description}
                    </Text>
                  </View>
                  <View style={styles.txRight}>
                    <Text style={[styles.txAmount, { color: meta.color }]}>
                      {meta.sign}
                      {formatJmd(Math.abs(tx.amountMinor))}
                    </Text>
                    <Text style={styles.txDate}>{txDate(tx.createdAt)}</Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </Card>

        {/* Offers & rewards */}
        <Text style={[styles.sectionTitle, { marginBottom: spacing.md }]}>Offers & rewards</Text>
        <Card style={styles.rewardCard}>
          <View style={styles.rewardBadge}>
            <Text style={styles.rewardBadgeValue}>
              {(walletQuery.data?.loyalty.pointsBalance ?? 0).toLocaleString('en-JM')}
            </Text>
            <Text style={styles.rewardBadgeLabel}>pts</Text>
          </View>
          <Text style={styles.rewardText}>
            <Text style={styles.rewardStrong}>1 point = JMD 1 off</Text> at checkout. Cover up to{' '}
            <Text style={styles.rewardStrong}>20%</Text> of eligible orders.
          </Text>
          <Pressable style={styles.rewardCta} onPress={() => router.push('/wallet-actions/redeem')}>
            <Text style={styles.rewardCtaText}>How points work</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textOnBrand} />
          </Pressable>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  balanceCard: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.base, ...shadow.raised },
  balanceLabel: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.base },
  balanceValue: { color: colors.textOnBrand, fontSize: 38, fontWeight: fontWeight.heavy, marginTop: 4 },
  pointsLabel: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.base, marginTop: spacing.sm },
  pointsValue: { color: colors.textOnBrand, fontWeight: fontWeight.bold },
  balanceActions: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.35)',
    paddingTop: spacing.md,
  },
  balanceActionWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  balanceDivider: { width: StyleSheet.hairlineWidth, height: 30, backgroundColor: 'rgba(255,255,255,0.35)' },
  balanceAction: { flex: 1, alignItems: 'center', gap: 4 },
  balanceActionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceActionText: { color: colors.textOnBrand, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.base },
  statCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  statText: { flex: 1 },
  statLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  statValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 2 },
  quickRow: { flexDirection: 'row', paddingVertical: spacing.base, marginBottom: spacing.lg },
  quickItem: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  quickIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  quickLabel: { fontSize: fontSize.xs, color: colors.textPrimary, textAlign: 'center' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary },
  seeAll: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  methodsRow: { gap: spacing.md, paddingBottom: spacing.lg },
  walletMethod: { width: 250, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  methodLogoWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  methodMeta: { fontSize: fontSize.sm, color: colors.textSecondary },
  defaultBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.skyTint,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: 4,
  },
  defaultBadgeText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  cardMethod: { width: 220, borderRadius: radius.lg, padding: spacing.base, justifyContent: 'space-between', ...shadow.card },
  cardBrand: { color: colors.textOnBrand, fontWeight: fontWeight.heavy, fontSize: fontSize.md, fontStyle: 'italic' },
  cardNumber: { color: colors.textOnBrand, fontSize: fontSize.md, letterSpacing: 2, marginTop: spacing.lg },
  cardExpiry: { color: 'rgba(255,255,255,0.8)', fontSize: fontSize.xs, marginTop: 4 },
  addMethod: {
    width: 130,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.base,
  },
  addMethodIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMethodText: { color: colors.blue, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, textAlign: 'center' },
  txCard: { marginBottom: spacing.lg },
  txEmpty: { padding: spacing.lg, alignItems: 'center' },
  txEmptyText: { color: colors.textSecondary, fontSize: fontSize.base },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  txRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  txIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  txMeta: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  txRight: { alignItems: 'flex-end' },
  txAmount: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
  txDate: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  rewardCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rewardBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardBadgeValue: { color: colors.textOnBrand, fontWeight: fontWeight.heavy, fontSize: fontSize.base },
  rewardBadgeLabel: { color: colors.textOnBrand, fontSize: fontSize.xs },
  rewardText: { flex: 1, color: colors.textPrimary, fontSize: fontSize.base, lineHeight: 21 },
  rewardStrong: { fontWeight: fontWeight.bold },
  rewardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  rewardCtaText: { color: colors.textOnBrand, fontWeight: fontWeight.semibold, fontSize: fontSize.sm },
});
