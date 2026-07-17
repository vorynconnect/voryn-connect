import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';

const BENEFITS = [
  {
    icon: 'notifications-outline',
    title: 'Ride and trip alerts',
    body: 'Get real-time updates about your rides.',
  },
  {
    icon: 'cube-outline',
    title: 'Order status and delivery tracking',
    body: 'Track your orders from start to finish.',
  },
  {
    icon: 'pricetag-outline',
    title: 'Promotions and wallet updates',
    body: 'Be the first to know about offers and updates.',
  },
  {
    icon: 'chatbubble-ellipses-outline',
    title: 'Support replies',
    body: 'We’ll notify you when we reply.',
  },
] as const;

/** Onboarding step 4 of 4 — "Stay updated". */
export default function EnableNotificationsScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    setBusy(true);
    try {
      // SDK 54's expo-notifications types import PermissionResponse from 'expo',
      // which doesn't re-export it — the runtime shape still has `status`.
      const { status } = (await Notifications.requestPermissionsAsync()) as unknown as { status: string };
      if (status === 'granted') {
        try {
          const token = await Notifications.getExpoPushTokenAsync();
          await api('/v1/users/me/push-tokens', {
            method: 'POST',
            body: { token: token.data, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
          });
        } catch {
          // Push registration is best-effort in development builds.
        }
      }
    } finally {
      setBusy(false);
      router.replace('/(auth)/all-set');
    }
  };

  return (
    <View style={styles.flex}>
      <AuthBackdrop />
      <ScrollView contentContainerStyle={styles.container}>
        <BrandLogo height={52} />

        <Text style={styles.title}>Stay updated</Text>
        <Text style={styles.subtitle}>
          Turn on notifications for ride updates, order tracking, promotions, and support messages
        </Text>

        <View style={styles.heroCard}>
          <View style={styles.bell}>
            <Ionicons name="notifications" size={86} color={colors.blue} />
          </View>
          <View style={[styles.miniCard, styles.miniTopLeft]}>
            <Ionicons name="car" size={16} color={colors.blue} />
            <View>
              <Text style={styles.miniTitle}>Ride arriving</Text>
              <Text style={styles.miniBody}>2 min away</Text>
            </View>
          </View>
          <View style={[styles.miniCard, styles.miniRight]}>
            <Ionicons name="pricetag" size={16} color={colors.blue} />
            <View>
              <Text style={styles.miniTitle}>Special offer</Text>
              <Text style={styles.miniBody}>20% off your next ride!</Text>
            </View>
          </View>
          <View style={[styles.miniCard, styles.miniBottomLeft]}>
            <Ionicons name="bag-handle" size={16} color={colors.blue} />
            <View>
              <Text style={styles.miniTitle}>Order delivered</Text>
              <Text style={styles.miniBody}>Your order is here</Text>
            </View>
          </View>
        </View>

        <View style={styles.list}>
          {BENEFITS.map((benefit) => (
            <View key={benefit.title} style={styles.listRow}>
              <View style={styles.listIcon}>
                <Ionicons name={benefit.icon} size={22} color={colors.blue} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>{benefit.title}</Text>
                <Text style={styles.listBody}>{benefit.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <GradientButton title="Enable Notifications" onPress={enable} loading={busy} />

        <Pressable onPress={() => router.replace('/(auth)/all-set')} style={styles.laterWrap}>
          <Text style={styles.later}>Maybe later</Text>
        </Pressable>

        <Text style={styles.stepLabel}>Step 4 of 4</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: 72, paddingBottom: spacing['2xl'] },
  title: {
    fontSize: 36,
    fontWeight: fontWeight.heavy,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    lineHeight: 24,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    height: 250,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    ...shadow.card,
  },
  bell: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniCard: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadow.raised,
  },
  miniTopLeft: { top: 24, left: 16 },
  miniRight: { top: 96, right: 12 },
  miniBottomLeft: { bottom: 28, left: 12 },
  miniTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  miniBody: { fontSize: fontSize.xs, color: colors.textSecondary },
  list: { marginBottom: spacing.xl },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  listText: { flex: 1 },
  listTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  listBody: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2 },
  laterWrap: { alignItems: 'center', marginTop: spacing.lg },
  later: { color: colors.blue, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  stepLabel: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.xl, fontSize: fontSize.base },
});
