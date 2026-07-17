import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { OrderFeedItem, OrdersFeed } from '@/lib/types';

const TABS = ['All', 'Active', 'Completed', 'Scheduled', 'Cancelled'] as const;
type Tab = (typeof TABS)[number];

const STATUS_LABELS: Record<string, { label: string; tone: 'info' | 'success' | 'danger' | 'muted' }> = {
  PLACED: { label: 'Placed', tone: 'info' },
  CONFIRMED: { label: 'Confirmed', tone: 'info' },
  PREPARING: { label: 'Preparing', tone: 'info' },
  COURIER_ASSIGNED: { label: 'Courier assigned', tone: 'info' },
  PICKED_UP: { label: 'Picked up', tone: 'info' },
  ON_THE_WAY: { label: 'On the way', tone: 'success' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  BOOKED: { label: 'Booked', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'info' },
  IN_SERVICE: { label: 'In service', tone: 'info' },
  DRIVER_ASSIGNED: { label: 'Driver assigned', tone: 'info' },
  DRIVER_ARRIVING: { label: 'Driver arriving', tone: 'info' },
  IN_PROGRESS: { label: 'On your trip', tone: 'success' },
  ACTIVE: { label: 'Active rental', tone: 'success' },
  EXTENDED: { label: 'Extended', tone: 'success' },
  PENDING_PAYMENT: { label: 'Payment pending', tone: 'muted' },
};

function statusMeta(status: string) {
  if (status.startsWith('CANCELLED') || status === 'NO_DRIVER_AVAILABLE' || status === 'NO_SHOW') {
    return { label: 'Cancelled', tone: 'danger' as const };
  }
  return STATUS_LABELS[status] ?? { label: status, tone: 'muted' as const };
}

function trackHref(item: OrderFeedItem): Href {
  switch (item.kind) {
    case 'order':
      return { pathname: '/delivery/tracking/[orderId]', params: { orderId: item.id } };
    case 'ride':
      return { pathname: '/rides/trip/[tripId]', params: { tripId: item.id } };
    case 'booking':
      return { pathname: '/bookings/tracking/[bookingId]', params: { bookingId: item.id } };
    case 'rental':
      return { pathname: '/rentals/active/[id]', params: { id: item.id } };
  }
}

export default function OrdersScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('All');
  const [search, setSearch] = useState('');

  const feedQuery = useQuery({
    queryKey: ['orders-feed'],
    queryFn: () => api<OrdersFeed>('/v1/orders'),
    refetchInterval: 15_000,
  });

  const items = feedQuery.data?.items ?? [];
  const counts = feedQuery.data?.counts ?? { active: 0, completed: 0, scheduled: 0, cancelled: 0 };

  const filtered = useMemo(() => {
    let list = items;
    if (tab !== 'All') list = list.filter((i) => i.bucket === tab.toLowerCase());
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (i) => i.title.toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, tab, search]);

  const inProgress = filtered.filter((i) => i.bucket === 'active');
  const rest = filtered.filter((i) => i.bucket !== 'active');

  return (
    <View style={styles.flex}>
      <ScreenHeader />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={feedQuery.isRefetching} onRefresh={() => feedQuery.refetch()} tintColor={colors.blue} />
        }
      >
        <Text style={styles.title}>Your Orders</Text>
        <Text style={styles.subtitle}>Track your current and past orders</Text>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search orders, providers, or items..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          <Ionicons name="options-outline" size={20} color={colors.blue} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {TABS.map((t) => (
            <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.countsRow}>
          {(
            [
              { label: 'Active', value: counts.active, icon: 'time-outline', color: colors.blue, tint: colors.skyTint },
              { label: 'Completed', value: counts.completed, icon: 'checkmark-circle-outline', color: colors.success, tint: colors.successTint },
              { label: 'Scheduled', value: counts.scheduled, icon: 'calendar-outline', color: colors.blue, tint: colors.skyTint },
              { label: 'Cancelled', value: counts.cancelled, icon: 'close-circle-outline', color: colors.danger, tint: colors.dangerTint },
            ] as const
          ).map((stat) => (
            <Card key={stat.label} style={styles.countCard}>
              <View style={[styles.countIcon, { backgroundColor: stat.tint }]}>
                <Ionicons name={stat.icon} size={18} color={stat.color} />
              </View>
              <Text style={styles.countLabel}>{stat.label}</Text>
              <Text style={[styles.countValue, { color: stat.color }]}>{stat.value}</Text>
            </Card>
          ))}
        </View>

        {feedQuery.isLoading ? <LoadingState label="Loading your orders…" /> : null}
        {feedQuery.isError ? <ErrorState onRetry={() => feedQuery.refetch()} /> : null}

        {!feedQuery.isLoading && !feedQuery.isError && filtered.length === 0 ? (
          <EmptyState
            icon="clipboard-outline"
            title={tab === 'All' ? 'No orders yet' : `No ${tab.toLowerCase()} orders`}
            body="When you order food, book rides or services, they’ll show up here."
          />
        ) : null}

        {inProgress.length > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>In progress</Text>
              <Pressable onPress={() => setTab('Active')}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            </View>
            {inProgress.map((item) => {
              const meta = statusMeta(item.status);
              return (
                <Card key={`${item.kind}-${item.id}`} style={styles.activeCard}>
                  <View style={styles.activeTop}>
                    <Image source={{ uri: item.logoUrl ?? undefined }} style={styles.activeLogo} contentFit="cover" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activeName}>{item.title}</Text>
                      <Text style={styles.activeMeta}>{item.subtitle}</Text>
                      <Text style={styles.activeCode}>#{item.code}</Text>
                    </View>
                    <View style={styles.activeRight}>
                      <View style={[styles.statusPill, styles[`pill_${meta.tone}`]]}>
                        <View style={[styles.statusDot, styles[`dot_${meta.tone}`]]} />
                        <Text style={[styles.statusText, styles[`text_${meta.tone}`]]}>{meta.label}</Text>
                      </View>
                      {item.etaLabel ? (
                        <View style={styles.etaRow}>
                          <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                          <Text style={styles.etaText}>{item.etaLabel}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.totalLabel}>Total</Text>
                      <Text style={styles.totalValue}>{formatJmd(item.totalMinor)}</Text>
                    </View>
                  </View>
                  <View style={styles.activeActions}>
                    <Pressable style={styles.activeAction} onPress={() => router.push(trackHref(item))}>
                      <Ionicons name="location-outline" size={17} color={colors.blue} />
                      <Text style={styles.activeActionText}>Track</Text>
                    </Pressable>
                    <Pressable style={styles.activeAction} onPress={() => router.push('/profile-pages/support')}>
                      <Ionicons name="headset-outline" size={17} color={colors.blue} />
                      <Text style={styles.activeActionText}>Support</Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })}
          </>
        ) : null}

        {rest.length > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Recent orders</Text>
            </View>
            <View style={styles.recentGrid}>
              {rest.map((item) => {
                const meta = statusMeta(item.status);
                return (
                  <Card key={`${item.kind}-${item.id}`} style={styles.recentCard}>
                    <View style={styles.recentHead}>
                      <Image source={{ uri: item.logoUrl ?? undefined }} style={styles.recentLogo} contentFit="cover" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.recentName} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.recentMeta} numberOfLines={1}>
                          {item.subtitle}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.statusPill, styles[`pill_${meta.tone}`], { alignSelf: 'flex-start' }]}>
                      <View style={[styles.statusDot, styles[`dot_${meta.tone}`]]} />
                      <Text style={[styles.statusText, styles[`text_${meta.tone}`]]}>{meta.label}</Text>
                    </View>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.recentTotal}>{formatJmd(item.totalMinor)}</Text>
                    <Pressable
                      style={styles.recentAction}
                      onPress={() =>
                        item.bucket === 'completed'
                          ? router.push(trackHref(item))
                          : router.push(trackHref(item))
                      }
                    >
                      <Ionicons
                        name={item.bucket === 'completed' ? 'refresh-outline' : 'document-text-outline'}
                        size={15}
                        color={colors.blue}
                      />
                      <Text style={styles.recentActionText}>
                        {item.bucket === 'completed' ? (item.kind === 'ride' ? 'Book again' : 'Reorder') : 'View details'}
                      </Text>
                    </Pressable>
                  </Card>
                );
              })}
            </View>
          </>
        ) : null}

        <View style={styles.trustRow}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.blue} />
          <Text style={styles.trustText}>Trusted third-party providers</Text>
          <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: 4,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: fontSize.base, paddingVertical: spacing.md },
  tabsRow: { gap: spacing.sm, paddingBottom: spacing.base },
  tab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  tabText: { color: colors.textPrimary, fontSize: fontSize.base, fontWeight: fontWeight.medium },
  tabTextActive: { color: colors.textOnBrand, fontWeight: fontWeight.bold },
  countsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  countCard: { flex: 1, alignItems: 'flex-start', padding: spacing.md },
  countIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  countLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  countValue: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, marginTop: 2 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary },
  seeAll: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  activeCard: { marginBottom: spacing.md },
  activeTop: { flexDirection: 'row', gap: spacing.md },
  activeLogo: { width: 54, height: 54, borderRadius: radius.md, backgroundColor: colors.skyTint },
  activeName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  activeMeta: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  activeCode: { fontSize: fontSize.sm, color: colors.blue, marginTop: 4, fontWeight: fontWeight.semibold },
  activeRight: { alignItems: 'flex-end' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    marginBottom: 4,
  },
  pill_info: { backgroundColor: colors.skyTint },
  pill_success: { backgroundColor: colors.successTint },
  pill_danger: { backgroundColor: colors.dangerTint },
  pill_muted: { backgroundColor: colors.surfaceMuted },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  dot_info: { backgroundColor: colors.blue },
  dot_success: { backgroundColor: colors.success },
  dot_danger: { backgroundColor: colors.danger },
  dot_muted: { backgroundColor: colors.textMuted },
  statusText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  text_info: { color: colors.blue },
  text_success: { color: colors.success },
  text_danger: { color: colors.danger },
  text_muted: { color: colors.textSecondary },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  etaText: { fontSize: fontSize.sm, color: colors.textSecondary },
  totalLabel: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 4 },
  totalValue: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  activeActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  activeAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeActionText: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  recentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  recentCard: { width: '48%', flexGrow: 1 },
  recentHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  recentLogo: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.skyTint },
  recentName: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  recentMeta: { fontSize: fontSize.xs, color: colors.textSecondary },
  recentTotal: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginBottom: spacing.sm },
  recentAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recentActionText: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.sm },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  trustText: { color: colors.textSecondary, fontSize: fontSize.sm },
});
