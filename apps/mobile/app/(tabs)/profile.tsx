import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { colors, fontSize, fontWeight, gradients, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import type { OrdersFeed, SessionProfileResponse } from '@/lib/types';

const GRID: Array<{ label: string; icon: keyof typeof Ionicons.glyphMap; href: Href }> = [
  { label: 'Personal Info', icon: 'person', href: '/profile-pages/edit' },
  { label: 'Addresses', icon: 'location', href: '/profile-pages/addresses' },
  { label: 'Payment Methods', icon: 'card', href: '/wallet-actions/payment-methods' },
  { label: 'Rewards', icon: 'gift', href: '/wallet-actions/redeem' },
  { label: 'Notifications', icon: 'notifications', href: '/notifications' },
  { label: 'Security', icon: 'shield-checkmark', href: '/profile-pages/security' },
];

const PREFERENCES: Array<{ title: string; body: string; icon: keyof typeof Ionicons.glyphMap; href: Href }> = [
  { title: 'Voryn Wallet', body: 'Manage balance and payment settings', icon: 'wallet-outline', href: '/(tabs)/wallet' },
  { title: 'Saved addresses', body: 'Home, Work, Other', icon: 'location-outline', href: '/profile-pages/addresses' },
  { title: 'Support', body: 'Chat with support or view tickets', icon: 'headset-outline', href: '/profile-pages/support' },
  { title: 'Privacy & security', body: 'Password, PIN, and verification', icon: 'shield-outline', href: '/profile-pages/security' },
  { title: 'Language & region', body: 'English • Jamaica', icon: 'globe-outline', href: '/profile-pages/language' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const signOut = useAuth((s) => s.signOut);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<SessionProfileResponse>('/v1/users/me'),
  });
  const ordersQuery = useQuery({
    queryKey: ['orders-feed'],
    queryFn: () => api<OrdersFeed>('/v1/orders'),
  });
  // Detect partner (driver/courier) access — 403 means this user isn't one.
  const driverQuery = useQuery({
    queryKey: ['driver-me'],
    queryFn: () => api<{ driver: unknown; courier: unknown }>('/v1/driver/me'),
    retry: false,
  });
  const isPartner = driverQuery.isSuccess;

  const me = meQuery.data;
  const ordersCount =
    (ordersQuery.data?.counts.active ?? 0) +
    (ordersQuery.data?.counts.completed ?? 0) +
    (ordersQuery.data?.counts.scheduled ?? 0);

  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  const confirmLogout = () => {
    setDialog({
      title: 'Log out',
      message: 'Are you sure you want to log out?',
      confirmLabel: 'Log out',
      destructive: true,
      onConfirm: async () => {
        await signOut();
        router.replace('/(auth)/login');
      },
    });
  };

  const confirmDelete = () => {
    setDialog({
      title: 'Delete account',
      message: 'This permanently deletes your account and revokes all sessions. This cannot be undone.',
      confirmLabel: 'Delete account',
      destructive: true,
      onConfirm: async () => {
        try {
          await api('/v1/users/me', { method: 'DELETE' });
        } finally {
          await signOut();
          router.replace('/(auth)/login');
        }
      },
    });
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={meQuery.isRefetching} onRefresh={() => meQuery.refetch()} tintColor={colors.blue} />
        }
      >
        <Text style={styles.title}>My Profile</Text>
        <Text style={styles.subtitle}>Manage your account, preferences, and activity</Text>

        {/* Hero card */}
        <LinearGradient colors={gradients.walletCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={styles.avatarWrap}>
              {me?.profile?.avatarUrl ? (
                <Image source={{ uri: me.profile.avatarUrl }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons name="person" size={40} color={colors.blue} />
                </View>
              )}
              <Pressable style={styles.avatarCamera} onPress={() => router.push('/profile-pages/edit')}>
                <Ionicons name="camera" size={14} color={colors.blue} />
              </Pressable>
            </View>
            <View style={styles.heroText}>
              <View style={styles.nameRow}>
                <Text style={styles.heroName}>{me?.user.fullName ?? '—'}</Text>
                <Ionicons name="checkmark-circle" size={18} color={colors.textOnBrand} />
              </View>
              {me?.user.phone ? (
                <View style={styles.heroMetaRow}>
                  <Ionicons name="call-outline" size={13} color="rgba(255,255,255,0.9)" />
                  <Text style={styles.heroMeta}>{me.user.phone}</Text>
                </View>
              ) : null}
              {me?.user.email ? (
                <View style={styles.heroMetaRow}>
                  <Ionicons name="mail-outline" size={13} color="rgba(255,255,255,0.9)" />
                  <Text style={styles.heroMeta}>{me.user.email}</Text>
                </View>
              ) : null}
              <View style={styles.heroChip}>
                <Ionicons name="location" size={12} color={colors.textOnBrand} />
                <Text style={styles.heroChipText}>Portmore, Jamaica</Text>
              </View>
            </View>
            <View style={styles.heroBadges}>
              <View style={styles.tierBadge}>
                <Ionicons name="medal" size={13} color="#8a6d1a" />
                <Text style={styles.tierText}>{me?.profile?.memberTier ?? 'Standard'} Member</Text>
              </View>
              <View style={styles.ptsBadge}>
                <Ionicons name="star" size={12} color={colors.textOnBrand} />
                <Text style={styles.ptsText}>{(me?.loyalty?.pointsBalance ?? 0).toLocaleString()} pts</Text>
              </View>
            </View>
          </View>
          <Pressable style={styles.editButton} onPress={() => router.push('/profile-pages/edit')}>
            <Ionicons name="create-outline" size={16} color={colors.blue} />
            <Text style={styles.editButtonText}>Edit profile</Text>
          </Pressable>
        </LinearGradient>

        {/* Stat tiles */}
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <Ionicons name="bag-handle-outline" size={20} color={colors.blue} />
            <Text style={styles.statLabel}>Orders</Text>
            <Text style={styles.statValue}>{ordersCount}</Text>
          </Card>
          <Card style={styles.statCard}>
            <Ionicons name="bookmark-outline" size={20} color={colors.blue} />
            <Text style={styles.statLabel}>Points</Text>
            <Text style={styles.statValue}>{(me?.loyalty?.pointsBalance ?? 0).toLocaleString()}</Text>
          </Card>
          <Card style={styles.statCard}>
            <Ionicons name="wallet-outline" size={20} color={colors.blue} />
            <Text style={styles.statLabel}>Wallet</Text>
            <Text style={styles.statValue} numberOfLines={1}>
              {me?.wallet ? formatJmd(me.wallet.balanceMinor).replace('JMD ', '') : '—'}
            </Text>
          </Card>
        </View>

        {/* Icon grid */}
        <View style={styles.grid}>
          {GRID.map((item) => (
            <Pressable key={item.label} style={styles.gridTile} onPress={() => router.push(item.href)}>
              <Ionicons name={item.icon} size={24} color={colors.blue} />
              <Text style={styles.gridLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Partner mode switch — only for users with a driver/courier profile */}
        {isPartner ? (
          <View style={styles.partnerCard}>
            <View style={styles.partnerIcon}>
              <Ionicons name="swap-horizontal" size={24} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.partnerTitle}>Switch to Driver &amp; Delivery</Text>
              <Text style={styles.partnerBody}>
                Go online, accept requests, and track your earnings in the partner dashboard.
              </Text>
            </View>
            <Pressable style={styles.partnerButton} onPress={() => router.replace('/driver/dashboard')}>
              <Text style={styles.partnerButtonText}>Switch now</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Account & preferences */}
        <Text style={styles.sectionTitle}>Account & preferences</Text>
        <Card padded={false} style={styles.prefCard}>
          {PREFERENCES.map((pref, i) => (
            <Pressable
              key={pref.title}
              style={[styles.prefRow, i < PREFERENCES.length - 1 && styles.prefBorder]}
              onPress={() => router.push(pref.href)}
            >
              <View style={styles.prefIcon}>
                <Ionicons name={pref.icon} size={20} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.prefTitle}>{pref.title}</Text>
                <Text style={styles.prefBody}>{pref.body}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          ))}
        </Card>

        {/* Logout / delete */}
        <Card padded={false} style={styles.prefCard}>
          <Pressable style={[styles.prefRow, styles.prefBorder]} onPress={confirmLogout}>
            <View style={[styles.prefIcon, { backgroundColor: colors.dangerTint }]}>
              <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            </View>
            <Text style={[styles.prefTitle, { color: colors.danger, flex: 1 }]}>Log out</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable style={styles.prefRow} onPress={confirmDelete}>
            <View style={[styles.prefIcon, { backgroundColor: colors.dangerTint }]}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </View>
            <Text style={[styles.prefTitle, { color: colors.danger, flex: 1 }]}>Delete account</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        </Card>

        <View style={styles.trustRow}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.blue} />
          <Text style={styles.trustText}>Trusted third-party providers</Text>
          <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
        </View>
      </ScrollView>
      <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  hero: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.base, ...shadow.raised },
  heroRow: { flexDirection: 'row', gap: spacing.md },
  avatarWrap: { position: 'relative' },
  avatar: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: 'rgba(255,255,255,0.6)' },
  avatarFallback: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  avatarCamera: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  heroText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroName: { color: colors.textOnBrand, fontSize: fontSize.lg, fontWeight: fontWeight.heavy },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  heroMeta: { color: 'rgba(255,255,255,0.92)', fontSize: fontSize.sm },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    marginTop: spacing.sm,
  },
  heroChipText: { color: colors.textOnBrand, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  heroBadges: { alignItems: 'flex-end', gap: spacing.sm },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F7DE8B',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  tierText: { color: '#8a6d1a', fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  ptsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  ptsText: { color: colors.textOnBrand, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.base,
  },
  editButtonText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.base },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: spacing.base },
  statLabel: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 4 },
  statValue: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  gridTile: {
    width: '31%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    alignItems: 'center',
    paddingVertical: spacing.base,
    gap: 6,
    ...shadow.card,
  },
  gridLabel: { fontSize: fontSize.xs, color: colors.textPrimary, fontWeight: fontWeight.medium, textAlign: 'center' },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  partnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.skyTint,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#D5E6FB',
    padding: spacing.base,
    marginBottom: spacing.lg,
  },
  partnerIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partnerTitle: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  partnerBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  partnerButton: {
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  partnerButtonText: { color: colors.textOnBrand, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  prefCard: { marginBottom: spacing.lg },
  prefRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  prefBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  prefIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  prefBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  trustText: { color: colors.textSecondary, fontSize: fontSize.sm },
});
