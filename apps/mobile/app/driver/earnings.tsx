import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { DriverHeader } from '@/features/driver/DriverHeader';
import type { DriverEarnings, DriverMe } from '@/features/driver/types';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd, formatJmdCompact } from '@/lib/format';

/** Earnings — period summaries, weekly chart, breakdown, performance. */
export default function DriverEarningsScreen() {
  const router = useRouter();
  const earningsQuery = useQuery({ queryKey: ['driver-earnings'], queryFn: () => api<DriverEarnings>('/v1/driver/earnings') });
  const meQuery = useQuery({ queryKey: ['driver-me'], queryFn: () => api<DriverMe>('/v1/driver/me') });

  if (earningsQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <DriverHeader />
        <LoadingState label="Calculating earnings…" />
      </View>
    );
  }
  if (earningsQuery.isError || !earningsQuery.data) {
    return (
      <View style={styles.flex}>
        <DriverHeader />
        <ErrorState onRetry={() => earningsQuery.refetch()} />
      </View>
    );
  }

  const earnings = earningsQuery.data;
  const maxBar = Math.max(...earnings.series.map((s) => s.valueMinor), 1);
  const breakdownRows = [
    { icon: 'car-outline' as const, label: 'Ride earnings', minor: earnings.breakdown.rideMinor, tint: colors.skyTint, color: colors.blue },
    { icon: 'bag-handle-outline' as const, label: 'Delivery earnings', minor: earnings.breakdown.deliveryMinor, tint: colors.successTint, color: colors.success },
    { icon: 'cash-outline' as const, label: 'Tips', minor: earnings.breakdown.tipsMinor, tint: colors.successTint, color: colors.success },
    { icon: 'gift-outline' as const, label: 'Bonuses', minor: earnings.breakdown.bonusesMinor, tint: '#F1ECFE', color: '#7C3AED' },
  ];

  return (
    <View style={styles.flex}>
      <DriverHeader />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={earningsQuery.isRefetching} onRefresh={() => earningsQuery.refetch()} tintColor={colors.blue} />}
      >
        <Text style={styles.title}>Earnings</Text>

        {/* Period cards */}
        <View style={styles.periodRow}>
          {(
            [
              { label: 'Today', minor: earnings.summary.todayMinor, delta: null },
              { label: 'This Week', minor: earnings.summary.weekMinor, delta: earnings.summary.weekDeltaPct },
              { label: 'This Month', minor: earnings.summary.monthMinor, delta: null },
            ] as const
          ).map((period) => (
            <Card key={period.label} style={styles.periodCard}>
              <View style={styles.periodHead}>
                <Text style={styles.periodLabel}>{period.label}</Text>
                <Ionicons name="stats-chart" size={15} color={colors.blue} />
              </View>
              <Text style={styles.periodValue}>{formatJmdCompact(period.minor)}</Text>
              {period.delta != null ? (
                <View style={styles.deltaRow}>
                  <Ionicons name={period.delta >= 0 ? 'arrow-up' : 'arrow-down'} size={12} color={period.delta >= 0 ? colors.success : colors.danger} />
                  <Text style={[styles.deltaText, { color: period.delta >= 0 ? colors.success : colors.danger }]}>
                    {Math.abs(period.delta)}% vs last week
                  </Text>
                </View>
              ) : null}
            </Card>
          ))}
        </View>

        {/* Weekly bar chart */}
        <Card style={styles.chartCard}>
          <Text style={styles.chartTitle}>Earnings this week</Text>
          <Text style={styles.chartTotal}>{formatJmd(earnings.summary.weekMinor)}</Text>
          <View style={styles.chart}>
            {earnings.series.map((day) => (
              <View key={day.label} style={styles.barCol}>
                {day.valueMinor > 0 ? (
                  <Text style={styles.barValue}>{Math.round(day.valueMinor / 100).toLocaleString('en-JM')}</Text>
                ) : (
                  <Text style={styles.barValue}>—</Text>
                )}
                <View style={[styles.bar, { height: Math.max(4, (day.valueMinor / maxBar) * 110) }]} />
                <Text style={styles.barLabel}>{day.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Breakdown + performance */}
        <View style={styles.twoCol}>
          <Card style={styles.colCard}>
            <Text style={styles.colTitle}>Earnings breakdown</Text>
            {breakdownRows.map((row) => (
              <View key={row.label} style={styles.breakRow}>
                <View style={[styles.breakIcon, { backgroundColor: row.tint }]}>
                  <Ionicons name={row.icon} size={16} color={row.color} />
                </View>
                <Text style={styles.breakLabel}>{row.label}</Text>
                <Text style={styles.breakValue}>{formatJmdCompact(row.minor)}</Text>
              </View>
            ))}
          </Card>
          <Card style={styles.colCard}>
            <Text style={styles.colTitle}>Performance</Text>
            <View style={styles.perfRow}>
              <View style={[styles.breakIcon, { backgroundColor: colors.skyTint }]}>
                <Ionicons name="checkmark-done-outline" size={16} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.perfLabel}>Completed trips</Text>
                <Text style={styles.perfValue}>{earnings.performance.completedWeek}</Text>
                <Text style={styles.perfMeta}>{earnings.performance.completedAll} all time</Text>
              </View>
            </View>
            <View style={styles.perfRow}>
              <View style={[styles.breakIcon, { backgroundColor: colors.skyTint }]}>
                <Ionicons name="star-outline" size={16} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.perfLabel}>Average rating</Text>
                <Text style={styles.perfValue}>{earnings.performance.ratingAvg.toFixed(2)}</Text>
                <Text style={[styles.perfMeta, { color: colors.blue }]}>
                  {earnings.performance.ratingAvg >= 4.8 ? 'Top-rated driver' : ' '}
                </Text>
              </View>
            </View>
          </Card>
        </View>

        {/* Available for payout */}
        <Card style={styles.payoutCard}>
          <View style={styles.payoutRow}>
            <View style={styles.payoutIcon}>
              <Ionicons name="wallet-outline" size={22} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.payoutLabel}>Available for payout</Text>
              <Text style={styles.payoutValue}>{formatJmd(meQuery.data?.walletBalanceMinor ?? 0)}</Text>
            </View>
          </View>
          <GradientButton
            title="Transfer to wallet or bank"
            icon="arrow-forward"
            onPress={() => router.push('/driver/wallet')}
          />
          <View style={styles.payoutNote}>
            <Ionicons name="shield-checkmark-outline" size={14} color={colors.success} />
            <Text style={styles.payoutNoteText}>Payouts are processed instantly</Text>
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: 26, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginBottom: spacing.base },
  periodRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  periodCard: { flex: 1, padding: spacing.md },
  periodHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  periodLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  periodValue: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 6 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  deltaText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  chartCard: { marginBottom: spacing.md },
  chartTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  chartTotal: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.blue, marginTop: 2, marginBottom: spacing.base },
  chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 160 },
  barCol: { alignItems: 'center', flex: 1, gap: 5 },
  barValue: { fontSize: 9, color: colors.textSecondary },
  bar: { width: 22, borderRadius: 6, backgroundColor: colors.blue },
  barLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  twoCol: { gap: spacing.md, marginBottom: spacing.md },
  colCard: {},
  colTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  breakRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 7 },
  breakIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  breakLabel: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary, fontWeight: fontWeight.medium },
  breakValue: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  perfRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 8 },
  perfLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  perfValue: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  perfMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  payoutCard: { marginBottom: spacing.base },
  payoutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.base },
  payoutIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.skyTint, alignItems: 'center', justifyContent: 'center' },
  payoutLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  payoutValue: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  payoutNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: spacing.md },
  payoutNoteText: { fontSize: fontSize.sm, color: colors.textSecondary },
});
