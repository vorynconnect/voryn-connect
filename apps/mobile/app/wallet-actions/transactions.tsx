import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { WalletTransaction } from '@/lib/types';

const TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  TOP_UP: 'add-circle-outline',
  PURCHASE: 'bag-outline',
  REFUND: 'return-down-back-outline',
  TRANSFER_IN: 'arrow-down-outline',
  TRANSFER_OUT: 'paper-plane-outline',
  WITHDRAWAL: 'arrow-up-outline',
  PROMO_CREDIT: 'gift-outline',
  REVERSAL: 'refresh-outline',
  ADJUSTMENT: 'settings-outline',
};

function txDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) {
    return `Today, ${d.toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-JM', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Full transaction history with cursor pagination. */
export default function TransactionsScreen() {
  const router = useRouter();

  const txQuery = useInfiniteQuery({
    queryKey: ['wallet-transactions-all'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<{ transactions: WalletTransaction[]; nextCursor?: string }>(
        `/v1/wallet/transactions?limit=25${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const transactions = txQuery.data?.pages.flatMap((page) => page.transactions) ?? [];

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>
        <Text style={styles.subtitle}>Every wallet movement, newest first.</Text>
      </View>
      {txQuery.isLoading ? <LoadingState label="Loading transactions…" /> : null}
      {txQuery.isError ? <ErrorState onRetry={() => txQuery.refetch()} /> : null}
      {txQuery.isSuccess && transactions.length === 0 ? (
        <EmptyState icon="receipt-outline" title="No transactions yet" body="Top up your wallet to get started." />
      ) : null}
      <FlatList
        data={transactions}
        keyExtractor={(tx) => tx.id}
        contentContainerStyle={styles.list}
        onEndReached={() => {
          if (txQuery.hasNextPage && !txQuery.isFetchingNextPage) txQuery.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        renderItem={({ item: tx }) => {
          const credit = tx.amountMinor >= 0;
          return (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: '/wallet-actions/transaction/[id]', params: { id: tx.id } })}
            >
              <View style={[styles.rowIcon, credit && { backgroundColor: colors.successTint }]}>
                <Ionicons
                  name={TYPE_ICONS[tx.type] ?? 'swap-horizontal-outline'}
                  size={19}
                  color={credit ? colors.success : colors.blue}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {tx.counterpartyName ?? tx.description}
                </Text>
                <Text style={styles.rowMeta}>{txDate(tx.createdAt)}</Text>
              </View>
              <Text style={[styles.rowAmount, { color: credit ? colors.blue : colors.textPrimary }]}>
                {credit ? '+' : '−'}
                {formatJmd(Math.abs(tx.amountMinor))}
              </Text>
            </Pressable>
          );
        }}
        ListFooterComponent={txQuery.isFetchingNextPage ? <LoadingState label="Loading more…" /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'], gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    ...shadow.card,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  rowMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  rowAmount: { fontSize: fontSize.base, fontWeight: fontWeight.heavy },
});
