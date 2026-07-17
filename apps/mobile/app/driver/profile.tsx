import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/States';
import { DriverHeader } from '@/features/driver/DriverHeader';
import type { DriverEarnings, DriverMe } from '@/features/driver/types';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  danger?: boolean;
  onPress: () => void;
};

/** Driver Profile — identity, switch to customer, settings, insights. */
export default function DriverProfileScreen() {
  const router = useRouter();
  const signOut = useAuth((s) => s.signOut);
  const authProfile = useAuth((s) => s.profile);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  const meQuery = useQuery({ queryKey: ['driver-me'], queryFn: () => api<DriverMe>('/v1/driver/me') });
  const earningsQuery = useQuery({ queryKey: ['driver-earnings'], queryFn: () => api<DriverEarnings>('/v1/driver/earnings') });

  if (meQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <DriverHeader />
        <LoadingState label="Loading profile…" />
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
  const rating = me.driver?.ratingAvg ?? me.courier?.ratingAvg ?? 0;
  const vehicleLabel = me.driver
    ? `${me.driver.vehicleMake ?? ''} ${me.driver.vehicleModel ?? ''} • ${me.driver.plateNo ?? ''}`.trim()
    : me.courier?.vehicleDesc ?? 'Delivery partner';
  const memberYear = new Date(me.memberSince).getFullYear();

  const rows: Row[] = [
    { icon: 'person-outline', label: 'Personal information', onPress: () => router.push('/profile-pages/edit') },
    { icon: 'car-outline', label: 'Vehicle details', onPress: () => router.push('/driver/vehicle-details') },
    {
      icon: 'shield-checkmark-outline',
      label: 'Documents & verification',
      onPress: () => router.push('/driver/documents'),
    },
    { icon: 'card-outline', label: 'Payment methods', onPress: () => router.push('/wallet-actions/payment-methods') },
    { icon: 'wallet-outline', label: 'Wallet & payouts', onPress: () => router.push('/driver/wallet') },
    { icon: 'notifications-outline', label: 'Notifications', onPress: () => router.push('/notifications') },
    { icon: 'medkit-outline', label: 'Safety center', onPress: () => router.push('/driver/safety') },
    { icon: 'help-circle-outline', label: 'Help & support', onPress: () => router.push('/profile-pages/support') },
    {
      icon: 'log-out-outline',
      label: 'Logout',
      danger: true,
      onPress: () =>
        setDialog({
          title: 'Log out?',
          message: 'You will stop receiving requests.',
          confirmLabel: 'Log out',
          destructive: true,
          onConfirm: async () => {
            await signOut();
            router.replace('/(auth)/login');
          },
        }),
    },
  ];

  return (
    <View style={styles.flex}>
      <DriverHeader />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.subtitle}>Manage your {me.driver ? 'driver' : 'delivery'} account and preferences</Text>

        {/* Identity card */}
        <Card style={styles.identityCard}>
          <View style={styles.identityRow}>
            <Avatar uri={authProfile?.avatarUrl ?? me.user.avatarUrl} name={me.user.fullName} size={74} />
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{me.user.fullName}</Text>
                <View style={[styles.onlineBadge, { backgroundColor: me.isOnline ? colors.successTint : colors.surfaceMuted }]}>
                  <View style={[styles.onlineDot, { backgroundColor: me.isOnline ? colors.success : colors.textMuted }]} />
                  <Text style={[styles.onlineBadgeText, { color: me.isOnline ? colors.success : colors.textSecondary }]}>
                    {me.isOnline ? 'Online' : 'Offline'}
                  </Text>
                </View>
              </View>
              <Text style={styles.vehicleText}>{vehicleLabel}</Text>
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={15} color={colors.blue} />
                <Text style={styles.ratingValue}>{rating.toFixed(2)}</Text>
                <Text style={styles.ratingMeta}>{rating >= 4.8 ? 'Top-rated' : ''}</Text>
              </View>
              <View style={styles.verifiedRow}>
                <Ionicons name="shield-checkmark" size={15} color={colors.blue} />
                <Text style={styles.verifiedText}>{me.driver ? 'Driver verified' : 'Courier verified'}</Text>
              </View>
            </View>
            <Pressable style={styles.editButton} onPress={() => router.push('/profile-pages/edit')}>
              <Ionicons name="pencil-outline" size={14} color={colors.blue} />
              <Text style={styles.editText}>Edit profile</Text>
            </Pressable>
          </View>
        </Card>

        {/* Switch to customer */}
        <View style={styles.switchCard}>
          <View style={styles.switchIcon}>
            <Ionicons name="swap-horizontal" size={24} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Switch to Customer</Text>
            <Text style={styles.switchBody}>Browse services, book rides, order delivery, and use Voryn Connect as a customer.</Text>
          </View>
          <Pressable style={styles.switchButton} onPress={() => router.replace('/(tabs)/home')}>
            <Text style={styles.switchButtonText}>Switch now</Text>
          </Pressable>
        </View>

        {/* Settings list */}
        <Card padded={false} style={styles.listCard}>
          {rows.map((row, i) => (
            <Pressable key={row.label} style={[styles.listRow, i < rows.length - 1 && styles.listBorder]} onPress={row.onPress}>
              <View style={[styles.listIcon, row.danger && { backgroundColor: colors.dangerTint }]}>
                <Ionicons name={row.icon} size={18} color={row.danger ? colors.danger : colors.blue} />
              </View>
              <Text style={[styles.listLabel, row.danger && { color: colors.danger }]}>{row.label}</Text>
              <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
            </Pressable>
          ))}
        </Card>

        {/* Account insights */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Account insights</Text>
        </View>
        <View style={styles.insightsRow}>
          <Card style={styles.insightCard}>
            <Ionicons name="navigate-outline" size={20} color={colors.blue} />
            <Text style={styles.insightLabel}>Trips completed</Text>
            <Text style={styles.insightValue}>{earningsQuery.data?.performance.completedAll ?? me.driver?.tripsCount ?? 0}</Text>
          </Card>
          <Card style={[styles.insightCard, { backgroundColor: colors.successTint }]}>
            <Ionicons name="star-outline" size={20} color={colors.success} />
            <Text style={styles.insightLabel}>Rating</Text>
            <Text style={styles.insightValue}>{rating.toFixed(2)}</Text>
          </Card>
          <Card style={[styles.insightCard, { backgroundColor: '#F1ECFE' }]}>
            <Ionicons name="calendar-outline" size={20} color="#7C3AED" />
            <Text style={styles.insightLabel}>Member since</Text>
            <Text style={styles.insightValue}>{memberYear}</Text>
          </Card>
        </View>

        {/* Protected banner */}
        <Card style={styles.protectedCard}>
          <View style={styles.protectedIcon}>
            <Ionicons name="shield-checkmark" size={22} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.protectedTitle}>Your account is protected</Text>
            <Text style={styles.protectedBody}>Your account is protected and verified for partner operations.</Text>
          </View>
          <View style={styles.lockIcon}>
            <Ionicons name="lock-closed" size={18} color={colors.blue} />
          </View>
        </Card>
      </ScrollView>
      <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: 26, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 3, marginBottom: spacing.base },
  identityCard: { marginBottom: spacing.md },
  identityRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  name: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  onlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  onlineBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  vehicleText: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 3 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  ratingValue: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  ratingMeta: { fontSize: fontSize.sm, color: colors.textSecondary },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  verifiedText: { fontSize: fontSize.sm, color: colors.blue, fontWeight: fontWeight.semibold },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  editText: { color: colors.blue, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  switchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.skyTint,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#D5E6FB',
    padding: spacing.base,
    marginBottom: spacing.base,
  },
  switchIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchTitle: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  switchBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  switchButton: {
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  switchButtonText: { color: colors.textOnBrand, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  listCard: { marginBottom: spacing.base },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  listBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  listIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listLabel: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  insightsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.base },
  insightCard: { flex: 1, alignItems: 'flex-start', gap: 6, backgroundColor: colors.skyTint },
  insightLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  insightValue: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  protectedCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  protectedIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  protectedTitle: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  protectedBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  lockIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
