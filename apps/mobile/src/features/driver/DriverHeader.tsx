import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BrandLogo } from '@/components/BrandLogo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '@/components/Avatar';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';

/** Driver dashboard header — logo, notification bell, avatar (per mockups). */
export function DriverHeader({ centerTitle }: { centerTitle?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const profile = useAuth((s) => s.profile);

  const notifQuery = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api<{ unreadCount: number }>('/v1/notifications'),
    refetchInterval: 30000,
  });
  const unread = notifQuery.data?.unreadCount ?? 0;

  return (
    <View style={[styles.row, { paddingTop: insets.top + spacing.sm }]}>
      <BrandLogo height={38} />
      {centerTitle ? <Text style={styles.centerTitle}>{centerTitle}</Text> : <View style={{ flex: 1 }} />}
      <Pressable style={styles.bell} onPress={() => router.push('/notifications')} hitSlop={8}>
        <Ionicons name="notifications-outline" size={24} color={colors.textPrimary} />
        {unread > 0 ? <View style={styles.dot} /> : null}
      </Pressable>
      <Pressable onPress={() => router.push('/driver/profile')} hitSlop={4}>
        <Avatar uri={profile?.avatarUrl} name={user?.fullName} size={40} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
  },
  centerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.lg,
    fontWeight: fontWeight.heavy,
    color: colors.textPrimary,
  },
  bell: { position: 'relative', padding: 2 },
  dot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.blue,
    borderWidth: 1.5,
    borderColor: colors.background,
  },
});
