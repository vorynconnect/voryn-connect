import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { BrandLogo } from './BrandLogo';
import { colors, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';

type Props = {
  showBack?: boolean;
};

/**
 * Standard page header from the mockups: optional back button on the left,
 * the official logo centered, notification bell (with unread dot) on the right.
 */
export function ScreenHeader({ showBack }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api<{ unreadCount: number }>('/v1/notifications'),
    staleTime: 60_000,
  });
  const hasUnread = (data?.unreadCount ?? 0) > 0;

  return (
    <View style={[styles.row, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.side}>
        {showBack ? (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
            style={styles.backButton}
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
      </View>
      <BrandLogo height={40} />
      <View style={[styles.side, styles.right]}>
        <Pressable
          onPress={() => router.push('/notifications')}
          accessibilityLabel="Notifications"
          hitSlop={8}
        >
          <Ionicons name="notifications-outline" size={26} color={colors.textPrimary} />
          {hasUnread ? <View style={styles.dot} /> : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    // paddingTop is applied inline as insets.top + spacing.md so the header
    // clears the status bar / notch on device.
    paddingBottom: spacing.sm,
  },
  side: { width: 48 },
  right: { alignItems: 'flex-end' },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  dot: {
    position: 'absolute',
    top: 0,
    right: 2,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.blue,
  },
});
