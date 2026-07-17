import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { DriverHeader } from '@/features/driver/DriverHeader';
import type { DriverTrip } from '@/features/driver/types';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';

type Bucket = 'ongoing' | 'scheduled' | 'history';
type Range = 'today' | 'week' | 'all';

const ONGOING_LABELS: Record<string, string> = {
  DRIVER_ASSIGNED: 'Assigned',
  DRIVER_ARRIVING: 'En route',
  ARRIVED: 'At pickup',
  IN_PROGRESS: 'In progress',
  COURIER_ASSIGNED: 'Assigned',
  PICKED_UP: 'Picked up',
  ON_THE_WAY: 'On the way',
};

/** Trips — ongoing / scheduled / history for rides and deliveries. */
export default function DriverTripsScreen() {
  const router = useRouter();
  const [bucket, setBucket] = useState<Bucket>('ongoing');
  const [range, setRange] = useState<Range>('today');

  const tripsQuery = useQuery({
    queryKey: ['driver-trips', bucket],
    queryFn: () => api<{ trips: DriverTrip[] }>(`/v1/driver/trips?bucket=${bucket}`),
    refetchInterval: bucket === 'ongoing' ? 10000 : false,
  });
  const historyQuery = useQuery({
    queryKey: ['driver-trips', 'history'],
    queryFn: () => api<{ trips: DriverTrip[] }>('/v1/driver/trips?bucket=history'),
  });

  const trips = tripsQuery.data?.trips ?? [];
  const active = bucket === 'ongoing' ? trips[0] : undefined;

  const history = (historyQuery.data?.trips ?? []).filter((t) => {
    const when = new Date(t.when);
    const now = new Date();
    if (range === 'today') return when.toDateString() === now.toDateString();
    if (range === 'week') return now.getTime() - when.getTime() < 7 * 86_400_000;
    return true;
  });

  const fmtWhen = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-JM', { month: 'short', day: 'numeric', year: 'numeric' })} • ${d.toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' })}`;
  };

  return (
    <View style={styles.flex}>
      <DriverHeader />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={tripsQuery.isRefetching}
            onRefresh={() => {
              tripsQuery.refetch();
              historyQuery.refetch();
            }}
            tintColor={colors.blue}
          />
        }
      >
        <Text style={styles.title}>Trips</Text>

        {/* Bucket tabs */}
        <View style={styles.tabs}>
          {(
            [
              { key: 'ongoing', label: 'Ongoing' },
              { key: 'scheduled', label: 'Scheduled' },
              { key: 'history', label: 'History' },
            ] as const
          ).map((tab) => (
            <Pressable key={tab.key} style={styles.tab} onPress={() => setBucket(tab.key)}>
              <Text style={[styles.tabText, bucket === tab.key && styles.tabTextActive]}>{tab.label}</Text>
              {bucket === tab.key ? <View style={styles.tabUnderline} /> : null}
            </Pressable>
          ))}
        </View>

        {bucket === 'ongoing' ? (
          <>
            <Text style={styles.sectionTitle}>{active?.kind === 'delivery' ? 'Active delivery' : 'Active ride'}</Text>
            {tripsQuery.isLoading ? <LoadingState label="Checking active trips…" /> : null}
            {tripsQuery.isError ? <ErrorState onRetry={() => tripsQuery.refetch()} /> : null}
            {tripsQuery.isSuccess && !active ? (
              <EmptyState
                icon="car-outline"
                title="No active trip"
                body="Accept a request from the dashboard to start a trip."
              />
            ) : null}
            {active ? (
              <Card style={styles.activeCard}>
                <View style={styles.activeHead}>
                  <View style={styles.avatar}>
                    <Ionicons name="person" size={26} color={colors.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activeName}>{active.customerName}</Text>
                    <View style={styles.ratingRow}>
                      <Ionicons name={active.kind === 'ride' ? 'star' : 'bag-handle-outline'} size={13} color={colors.blue} />
                      <Text style={styles.ratingText}>{active.kind === 'ride' ? 'Passenger' : active.itemsSummary || 'Delivery'}</Text>
                    </View>
                  </View>
                  <View style={styles.progressPill}>
                    <View style={styles.progressDot} />
                    <Text style={styles.progressText}>{ONGOING_LABELS[active.status] ?? 'In progress'}</Text>
                  </View>
                </View>

                <View style={styles.routeRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.routeItem}>
                      <View style={[styles.routeDot, { backgroundColor: colors.blue }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.routeLabel}>Pickup</Text>
                        <Text style={styles.routeValue}>{active.pickupName}</Text>
                      </View>
                    </View>
                    <View style={styles.routeLine} />
                    <View style={styles.routeItem}>
                      <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.routeLabel, { color: colors.success }]}>Drop-off</Text>
                        <Text style={styles.routeValue}>{active.dropoffName}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.fareBox}>
                    <Text style={styles.fareLabel}>Fare estimate</Text>
                    <Text style={styles.fareValue}>{formatJmd(active.estimateMinor)}</Text>
                    {active.distanceKm != null ? <Text style={styles.fareMeta}>({active.distanceKm.toFixed(1)} km)</Text> : null}
                  </View>
                </View>

                <View style={styles.activeActions}>
                  <Pressable
                    style={styles.activeAction}
                    onPress={() => (active.customerPhone ? Linking.openURL(`tel:${active.customerPhone}`) : null)}
                  >
                    <Ionicons name="call-outline" size={17} color={colors.blue} />
                    <Text style={styles.activeActionText}>
                      {active.kind === 'ride' ? 'Contact passenger' : 'Contact customer'}
                    </Text>
                  </Pressable>
                  <View style={styles.actionDivider} />
                  <Pressable
                    style={styles.activeAction}
                    onPress={() => router.push({ pathname: '/driver/trip/[id]', params: { id: active.id, kind: active.kind } })}
                  >
                    <Ionicons name="navigate" size={17} color={colors.blue} />
                    <Text style={styles.activeActionText}>Open trip</Text>
                  </Pressable>
                </View>
              </Card>
            ) : null}
          </>
        ) : null}

        {bucket === 'scheduled' ? (
          <EmptyState
            icon="calendar-outline"
            title="No scheduled trips"
            body="Scheduled ride requests will appear here before pickup time."
          />
        ) : null}

        {/* History (also shown under ongoing per mockup) */}
        {bucket !== 'scheduled' ? (
          <>
            <View style={styles.historyHead}>
              <Text style={styles.sectionTitle}>Recent completed trips</Text>
              <View style={styles.rangeChips}>
                {(
                  [
                    { key: 'today', label: 'Today' },
                    { key: 'week', label: 'This Week' },
                    { key: 'all', label: 'All' },
                  ] as const
                ).map((chip) => (
                  <Pressable key={chip.key} onPress={() => setRange(chip.key)}>
                    <Text style={[styles.rangeText, range === chip.key && styles.rangeTextActive]}>{chip.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {historyQuery.isSuccess && history.length === 0 ? (
              <EmptyState icon="time-outline" title="No completed trips yet" body="Completed trips and deliveries appear here." />
            ) : null}
            {history.slice(0, 10).map((trip) => (
              <Card key={`${trip.kind}-${trip.id}`} style={styles.historyCard}>
                <View style={styles.historyRow}>
                  <View style={styles.historyIcon}>
                    <Ionicons name={trip.kind === 'ride' ? 'location-outline' : 'bag-handle-outline'} size={22} color={colors.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyDate}>{fmtWhen(trip.when)}</Text>
                    <Text style={styles.historyRoute} numberOfLines={1}>
                      {trip.pickupName} <Text style={{ color: colors.textSecondary }}>→</Text> {trip.dropoffName}
                    </Text>
                    <View style={styles.historyMeta}>
                      <Ionicons name="card-outline" size={13} color={colors.textSecondary} />
                      <Text style={styles.historyMetaText}>{trip.paymentLabel}</Text>
                      <Text style={styles.historyMetaText}>• {trip.code}</Text>
                    </View>
                  </View>
                  <Text style={styles.historyAmount}>{formatJmd(trip.earningsMinor ?? trip.estimateMinor)}</Text>
                  <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
                </View>
              </Card>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: 26, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginBottom: spacing.base },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.base,
    overflow: 'hidden',
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.md },
  tabText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  tabTextActive: { color: colors.blue, fontWeight: fontWeight.heavy },
  tabUnderline: { height: 3, backgroundColor: colors.blue, borderRadius: 2, alignSelf: 'stretch', marginTop: 8, marginHorizontal: 18 },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginBottom: spacing.md },
  activeCard: { marginBottom: spacing.lg },
  activeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.base },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeName: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  ratingText: { fontSize: fontSize.sm, color: colors.textSecondary },
  progressPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  progressDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.blue },
  progressText: { color: colors.blue, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  routeRow: { flexDirection: 'row', gap: spacing.md },
  routeItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  routeDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  routeLine: { width: 2, height: 22, backgroundColor: colors.blue, marginLeft: 5, marginVertical: 2 },
  routeLabel: { fontSize: fontSize.sm, color: colors.blue, fontWeight: fontWeight.semibold },
  routeValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  fareBox: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  fareLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  fareValue: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 2 },
  fareMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  activeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    marginTop: spacing.base,
  },
  activeAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: spacing.md,
  },
  activeActionText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  actionDivider: { width: 1, height: 26, backgroundColor: colors.border },
  historyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  rangeChips: { flexDirection: 'row', gap: spacing.base, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.base, paddingVertical: 7 },
  rangeText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: fontWeight.medium },
  rangeTextActive: { color: colors.blue, fontWeight: fontWeight.heavy },
  historyCard: { marginBottom: spacing.md },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  historyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyDate: { fontSize: fontSize.sm, color: colors.textSecondary },
  historyRoute: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 2 },
  historyMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  historyMetaText: { fontSize: fontSize.sm, color: colors.textSecondary },
  historyAmount: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.textPrimary },
});
