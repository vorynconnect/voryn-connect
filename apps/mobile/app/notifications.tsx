import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

const TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  RIDE_UPDATE: 'car-outline',
  ORDER_UPDATE: 'bag-outline',
  BOOKING_UPDATE: 'calendar-outline',
  RENTAL_UPDATE: 'key-outline',
  WALLET_UPDATE: 'wallet-outline',
  PROMO: 'gift-outline',
  SUPPORT_REPLY: 'headset-outline',
  SYSTEM: 'information-circle-outline',
};

function notifDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24 && d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-JM', { month: 'short', day: 'numeric' });
}

/** Notifications center — ride, order, booking, wallet, and promo updates. */
export default function NotificationsScreen() {
  const queryClient = useQueryClient();

  const notifQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: Notification[]; unreadCount: number }>('/v1/notifications'),
  });

  const readMutation = useMutation({
    mutationFn: (id: string) => api(`/v1/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const readAllMutation = useMutation({
    mutationFn: () => api('/v1/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const notifications = notifQuery.data?.notifications ?? [];
  const unreadCount = notifQuery.data?.unreadCount ?? 0;

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'You’re all caught up.'}
          </Text>
        </View>
        {unreadCount > 0 ? (
          <Pressable onPress={() => readAllMutation.mutate()} disabled={readAllMutation.isPending}>
            <Text style={styles.readAll}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      {notifQuery.isLoading ? <LoadingState label="Loading notifications…" /> : null}
      {notifQuery.isError ? <ErrorState onRetry={() => notifQuery.refetch()} /> : null}
      {notifQuery.isSuccess && notifications.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="No notifications yet"
          body="Order updates, ride status, and rewards will show up here."
        />
      ) : null}

      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const unread = !item.readAt;
          return (
            <Pressable
              style={[styles.row, unread && styles.rowUnread]}
              onPress={() => {
                if (unread) readMutation.mutate(item.id);
              }}
            >
              <View style={styles.rowIcon}>
                <Ionicons name={TYPE_ICONS[item.type] ?? 'notifications-outline'} size={19} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTitleRow}>
                  <Text style={[styles.rowTitle, unread && { fontWeight: fontWeight.heavy }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {unread ? <View style={styles.unreadDot} /> : null}
                </View>
                <Text style={styles.rowBody} numberOfLines={2}>
                  {item.body}
                </Text>
                <Text style={styles.rowTime}>{notifDate(item.createdAt)}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2 },
  readAll: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm, paddingBottom: 4 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'], gap: spacing.sm },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    ...shadow.card,
  },
  rowUnread: { backgroundColor: '#F4F9FF' },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.blue },
  rowBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, lineHeight: 19 },
  rowTime: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 },
});
