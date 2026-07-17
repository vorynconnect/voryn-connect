import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView from 'react-native-maps';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { LoadingState, ErrorState } from '@/components/States';
import { DriverHeader } from '@/features/driver/DriverHeader';
import type { DriverDashboard, DriverMe, DriverRequest } from '@/features/driver/types';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmd } from '@/lib/format';

const PORTMORE = { latitude: 17.9583, longitude: -76.8822, latitudeDelta: 0.06, longitudeDelta: 0.06 };

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Driver Dashboard — online toggle, vehicle, stats, live demand, actions. */
export default function DriverDashboardScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  const meQuery = useQuery({ queryKey: ['driver-me'], queryFn: () => api<DriverMe>('/v1/driver/me') });
  const dashQuery = useQuery({
    queryKey: ['driver-dashboard'],
    queryFn: () => api<DriverDashboard>('/v1/driver/dashboard'),
    refetchInterval: 15000,
  });
  const requestsQuery = useQuery({
    queryKey: ['driver-requests'],
    queryFn: () => api<{ requests: DriverRequest[] }>('/v1/driver/requests'),
    refetchInterval: meQuery.data?.isOnline ? 6000 : false,
  });

  const statusMutation = useMutation({
    mutationFn: (isOnline: boolean) => api('/v1/driver/status', { method: 'POST', body: { isOnline } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-me'] });
      queryClient.invalidateQueries({ queryKey: ['driver-dashboard'] });
    },
    onError: (err) =>
      setDialog({ title: 'Could not update status', message: err instanceof ApiError ? err.message : 'Try again.' }),
  });

  if (meQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <DriverHeader />
        <LoadingState label="Loading your dashboard…" />
      </View>
    );
  }
  if (meQuery.isError || !meQuery.data) {
    return (
      <View style={styles.flex}>
        <DriverHeader />
        <ErrorState onRetry={() => meQuery.refetch()} />
      </View>
    );
  }

  const me = meQuery.data;
  const stats = dashQuery.data?.stats;
  const isOnline = me.isOnline;
  const firstName = me.user.fullName.split(/\s+/)[0];
  const pending = requestsQuery.data?.requests ?? [];
  const nextRequest = pending[0];
  const vehicleLabel = me.driver
    ? `${me.driver.vehicleMake ?? ''} ${me.driver.vehicleModel ?? ''}`.trim() || 'Your vehicle'
    : me.courier?.vehicleDesc ?? 'Delivery vehicle';
  const vehicleSub = me.driver ? me.driver.plateNo ?? '' : me.courier?.vehicleType ?? '';

  const toggleOnline = (value: boolean) => statusMutation.mutate(value);

  return (
    <View style={styles.flex}>
      <DriverHeader />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={dashQuery.isRefetching} onRefresh={() => dashQuery.refetch()} tintColor={colors.blue} />}
      >
        {/* Title + online toggle */}
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{me.driver ? 'Driver Dashboard' : 'Delivery Dashboard'}</Text>
            <Text style={styles.subtitle}>
              {greeting()}, <Text style={styles.subtitleName}>{firstName}</Text>
            </Text>
          </View>
          <View style={styles.onlinePill}>
            <View style={[styles.onlineDot, { backgroundColor: isOnline ? colors.success : colors.textMuted }]} />
            <Text style={styles.onlineText}>{isOnline ? 'Online' : 'Offline'}</Text>
            <Switch
              value={isOnline}
              onValueChange={toggleOnline}
              trackColor={{ true: colors.blue, false: colors.borderStrong }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* Vehicle card */}
        <Card style={styles.vehicleCard}>
          <View style={styles.vehicleRow}>
            <View style={styles.vehicleIcon}>
              <Ionicons name={me.driver ? 'car-sport' : 'bicycle'} size={30} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.vehicleName}>{vehicleLabel}</Text>
              <Text style={styles.vehicleMeta}>{vehicleSub}</Text>
              <View style={styles.verifiedRow}>
                <Ionicons name="checkmark-circle" size={15} color={colors.blue} />
                <Text style={styles.verifiedText}>{me.driver ? 'Vehicle verified' : 'Courier verified'}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </View>
        </Card>

        {/* Stat tiles */}
        <View style={styles.statGrid}>
          <Pressable style={styles.statTile} onPress={() => router.push('/driver/earnings')}>
            <View style={styles.statIcon}><Ionicons name="cash-outline" size={20} color={colors.blue} /></View>
            <Text style={styles.statLabel}>Today's Earnings</Text>
            <Text style={styles.statValue}>{formatJmd(stats?.todayEarningsMinor ?? 0)}</Text>
            <Text style={styles.statLink}>View breakdown ›</Text>
          </Pressable>
          <Pressable style={styles.statTile} onPress={() => router.push('/driver/trips')}>
            <View style={styles.statIcon}><Ionicons name="car-outline" size={20} color={colors.blue} /></View>
            <Text style={styles.statLabel}>Completed Trips</Text>
            <Text style={styles.statValue}>{stats?.completedToday ?? 0}</Text>
            <Text style={styles.statLink}>View trips ›</Text>
          </Pressable>
          <View style={styles.statTile}>
            <View style={styles.statIcon}><Ionicons name="trending-up-outline" size={20} color={colors.blue} /></View>
            <Text style={styles.statLabel}>Acceptance Rate</Text>
            <Text style={styles.statValue}>{stats?.acceptanceRate != null ? `${stats.acceptanceRate}%` : '—'}</Text>
            <Text style={[styles.statLink, { color: colors.success }]}>
              {stats?.acceptanceRate != null && stats.acceptanceRate >= 85 ? 'Excellent' : ' '}
            </Text>
          </View>
          <View style={styles.statTile}>
            <View style={styles.statIcon}><Ionicons name="star-outline" size={20} color={colors.blue} /></View>
            <Text style={styles.statLabel}>Rating</Text>
            <Text style={styles.statValue}>{(stats?.ratingAvg ?? 0).toFixed(2)}</Text>
            <Text style={styles.statLink}>{(stats?.ratingAvg ?? 0) >= 4.8 ? 'Top-rated' : `${stats?.ratingCount ?? 0} ratings`}</Text>
          </View>
        </View>

        {/* Live demand map */}
        <Card padded={false} style={styles.mapCard}>
          <MapView style={styles.map} initialRegion={PORTMORE} />
          <View style={styles.mapBadge}>
            <Ionicons name="stats-chart" size={13} color={colors.textPrimary} />
            <Text style={styles.mapBadgeText}>Live demand</Text>
          </View>
          {nextRequest ? (
            <Pressable
              style={styles.requestChip}
              onPress={() =>
                router.push({ pathname: '/driver/request/[id]', params: { id: nextRequest.id, kind: nextRequest.kind } })
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.requestChipTitle}>
                  {pending.length} Pending
                </Text>
                <Text style={styles.requestChipBody}>
                  {nextRequest.kind === 'ride' ? 'New ride request' : 'New delivery request'}
                </Text>
                <Text style={styles.requestChipMeta}>
                  {nextRequest.distanceKm != null ? `${nextRequest.distanceKm.toFixed(1)} km` : nextRequest.pickupName}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.blue} />
            </Pressable>
          ) : null}
        </Card>

        {/* Current activity */}
        <Text style={styles.sectionTitle}>Current activity</Text>
        <View style={styles.activityRow}>
          <Card style={styles.activityCard}>
            <View style={styles.activityIcon}>
              <Ionicons name={isOnline ? 'radio-outline' : 'moon-outline'} size={22} color={colors.blue} />
            </View>
            <Text style={styles.activityTitle}>{isOnline ? 'Ready to receive requests' : 'You are offline'}</Text>
            <Text style={styles.activityBody}>
              {isOnline
                ? `You're online and visible to ${me.driver ? 'riders' : 'merchants'}.`
                : 'Go online to start receiving requests.'}
            </Text>
          </Card>
          <Card style={styles.activityCard}>
            <View style={[styles.activityIcon, { backgroundColor: colors.warningTint }]}>
              <Ionicons name="flash-outline" size={22} color={colors.warning} />
            </View>
            <Text style={styles.activityTitle}>
              {pending.length > 0 ? `${pending.length} request${pending.length === 1 ? '' : 's'} waiting` : 'No surge right now'}
            </Text>
            <Text style={styles.activityBody}>
              {pending.length > 0 ? 'Open the request to review and accept.' : 'Peak-hour bonuses appear here.'}
            </Text>
          </Card>
        </View>

        {/* Quick actions */}
        <View style={styles.actionsRow}>
          <Pressable
            style={[styles.actionTile, styles.actionPrimary]}
            onPress={() => toggleOnline(!isOnline)}
          >
            <Ionicons name="power" size={22} color={colors.textOnBrand} />
            <Text style={styles.actionPrimaryText}>{isOnline ? 'Go offline' : 'Go online'}</Text>
          </Pressable>
          <Pressable style={styles.actionTile} onPress={() => router.push('/driver/trips')}>
            <Ionicons name="list-outline" size={22} color={colors.blue} />
            <Text style={styles.actionText}>View trips</Text>
          </Pressable>
          <Pressable style={styles.actionTile} onPress={() => router.push('/driver/wallet')}>
            <Ionicons name="wallet-outline" size={22} color={colors.blue} />
            <Text style={styles.actionText}>Cash out</Text>
          </Pressable>
          <Pressable
            style={styles.actionTile}
            onPress={() =>
              setDialog({
                title: 'Voryn Support',
                message: 'Partner support is available 24/7.',
                confirmLabel: 'Call support',
                onConfirm: () => void Linking.openURL('tel:+18765550000'),
              })
            }
          >
            <Ionicons name="headset-outline" size={22} color={colors.blue} />
            <Text style={styles.actionText}>Support</Text>
          </Pressable>
        </View>
      </ScrollView>
      <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.base },
  title: { fontSize: 26, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.md, color: colors.textSecondary, marginTop: 3 },
  subtitleName: { color: colors.blue, fontWeight: fontWeight.bold },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingLeft: spacing.base,
    paddingRight: spacing.sm,
    paddingVertical: 5,
    ...shadow.card,
  },
  onlineDot: { width: 9, height: 9, borderRadius: 5 },
  onlineText: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  vehicleCard: { marginBottom: spacing.md },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleIcon: {
    width: 74,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleName: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  vehicleMeta: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  verifiedText: { fontSize: fontSize.sm, color: colors.blue, fontWeight: fontWeight.semibold },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.md },
  statTile: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    ...shadow.card,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  statLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  statValue: { fontSize: 24, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 2 },
  statLink: { fontSize: fontSize.sm, color: colors.blue, fontWeight: fontWeight.semibold, marginTop: 6 },
  mapCard: { overflow: 'hidden', marginBottom: spacing.base, height: 190 },
  map: { width: '100%', height: '100%' },
  mapBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    ...shadow.card,
  },
  mapBadgeText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  requestChip: {
    position: 'absolute',
    top: 12,
    right: 12,
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow.card,
  },
  requestChipTitle: { color: colors.blue, fontWeight: fontWeight.heavy, fontSize: fontSize.base },
  requestChipBody: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  requestChipMeta: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 1 },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginBottom: spacing.md },
  activityRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.base },
  activityCard: { flex: 1 },
  activityIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  activityTitle: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  activityBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 3, lineHeight: 19 },
  actionsRow: { flexDirection: 'row', gap: spacing.sm },
  actionTile: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.base,
    ...shadow.card,
  },
  actionPrimary: { backgroundColor: colors.blue },
  actionPrimaryText: { color: colors.textOnBrand, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  actionText: { color: colors.textPrimary, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
});
