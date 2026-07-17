import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ErrorState, Skeleton } from '@/components/States';
import { colors, fontSize, fontWeight, gradients, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import type { HomeFeed } from '@/lib/types';

const FILTER_CHIPS: Array<{ label: string; icon: keyof typeof Ionicons.glyphMap; href?: Href }> = [
  { label: 'All', icon: 'apps' },
  { label: 'Rides', icon: 'car-outline', href: '/rides' },
  { label: 'Delivery', icon: 'bicycle-outline', href: '/delivery' },
  { label: 'Home Services', icon: 'home-outline', href: '/home-services' },
  { label: 'Auto Care', icon: 'disc-outline', href: '/auto-care' },
  { label: 'Technicians', icon: 'people-outline', href: '/technicians' },
];

const CATEGORY_TILES: Array<{ label: string; icon: keyof typeof Ionicons.glyphMap; href: Href }> = [
  { label: 'Get a Ride', icon: 'car-sport', href: '/rides' },
  { label: 'Rent a Vehicle', icon: 'key', href: '/rentals' },
  { label: 'Delivery', icon: 'bicycle', href: '/delivery' },
  { label: 'Auto Care', icon: 'settings', href: '/auto-care' },
  { label: 'Technicians', icon: 'person', href: '/technicians' },
  { label: 'Home Services', icon: 'home', href: '/home-services' },
  { label: 'Scan & Pay', icon: 'qr-code', href: '/wallet-actions/scan-pay' },
  { label: 'Orders', icon: 'clipboard', href: '/(tabs)/orders' },
];

export default function ServicesScreen() {
  const router = useRouter();
  const feedQuery = useQuery({
    queryKey: ['home-feed'],
    queryFn: () => api<HomeFeed>('/v1/discovery/home'),
  });

  if (feedQuery.isError) {
    return (
      <View style={styles.flex}>
        <ScreenHeader />
        <ErrorState onRetry={() => feedQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={feedQuery.isRefetching} onRefresh={() => feedQuery.refetch()} tintColor={colors.blue} />
        }
      >
        <Text style={styles.title}>Explore Services</Text>
        <Text style={styles.subtitle}>Book trusted third-party providers near you</Text>

        <Pressable style={styles.searchBar} onPress={() => router.push('/search')}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <Text style={styles.searchPlaceholder}>Search rides, food, home services...</Text>
          <Ionicons name="options-outline" size={20} color={colors.blue} />
        </Pressable>

        <Pressable style={styles.locationChip} onPress={() => router.push('/profile-pages/addresses')}>
          <Ionicons name="location" size={16} color={colors.blue} />
          <Text style={styles.locationText}>Portmore, Jamaica</Text>
          <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {FILTER_CHIPS.map((chip, i) => (
            <Pressable
              key={chip.label}
              style={[styles.chip, i === 0 && styles.chipActive]}
              onPress={() => (chip.href ? router.push(chip.href) : undefined)}
            >
              <Ionicons name={chip.icon} size={16} color={i === 0 ? colors.textOnBrand : colors.textPrimary} />
              <Text style={[styles.chipText, i === 0 && styles.chipTextActive]}>{chip.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Hero banner */}
        <LinearGradient colors={gradients.walletCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.heroTitle}>One app. Every need.</Text>
          <Text style={styles.heroBody}>Rides, delivery, home services and more – all in one place.</Text>
          <Pressable style={styles.heroCta} onPress={() => router.push('/search')}>
            <Text style={styles.heroCtaText}>Explore all</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.blue} />
          </Pressable>
          <View style={styles.heroBadges}>
            <View style={styles.heroBadge}>
              <Ionicons name="shield-checkmark-outline" size={13} color={colors.textOnBrand} />
              <Text style={styles.heroBadgeText}>Trusted providers</Text>
            </View>
            <View style={styles.heroBadge}>
              <Ionicons name="lock-closed-outline" size={13} color={colors.textOnBrand} />
              <Text style={styles.heroBadgeText}>Secure payments</Text>
            </View>
            <View style={styles.heroBadge}>
              <Ionicons name="navigate-outline" size={13} color={colors.textOnBrand} />
              <Text style={styles.heroBadgeText}>Real-time tracking</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Browse by category */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Browse by category</Text>
          <Pressable onPress={() => router.push('/search')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        <View style={styles.categoryGrid}>
          {CATEGORY_TILES.map((tile) => (
            <Pressable key={tile.label} style={styles.categoryTile} onPress={() => router.push(tile.href)}>
              <View style={styles.categoryIcon}>
                <Ionicons name={tile.icon} size={30} color={colors.blue} />
              </View>
              <Text style={styles.categoryLabel} numberOfLines={1}>
                {tile.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Popular services near you */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Popular services near you</Text>
          <Pressable onPress={() => router.push('/search')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        {feedQuery.isLoading ? (
          <View style={styles.popularRow}>
            <Skeleton height={170} width={160} />
            <Skeleton height={170} width={160} />
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.popularRow}>
            {(feedQuery.data?.popular ?? []).map((provider) => (
              <Pressable
                key={provider.id}
                style={styles.popularCard}
                onPress={() => router.push({ pathname: '/provider/[id]', params: { id: provider.id } })}
              >
                <View style={styles.popularHead}>
                  <Image source={{ uri: provider.logoUrl ?? undefined }} style={styles.popularLogo} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.popularName} numberOfLines={1}>
                      {provider.name}
                    </Text>
                  </View>
                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={13} color={colors.star} />
                    <Text style={styles.ratingText}>{provider.ratingAvg.toFixed(1)}</Text>
                  </View>
                </View>
                <Image source={{ uri: provider.coverUrl ?? undefined }} style={styles.popularCover} contentFit="cover" />
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Quick actions */}
        <Text style={[styles.sectionTitle, { marginBottom: spacing.md }]}>Quick actions</Text>
        <View style={styles.quickActionsRow}>
          <Pressable style={styles.quickAction} onPress={() => router.push('/(tabs)/orders')}>
            <Ionicons name="refresh-outline" size={18} color={colors.blue} />
            <Text style={styles.quickActionText}>Book again</Text>
          </Pressable>
          <Pressable style={styles.quickAction} onPress={() => router.push('/(tabs)/orders')}>
            <Ionicons name="calendar-outline" size={18} color={colors.blue} />
            <Text style={styles.quickActionText}>Schedule later</Text>
          </Pressable>
          <Pressable style={styles.quickAction} onPress={() => router.push('/(tabs)/orders')}>
            <Ionicons name="location-outline" size={18} color={colors.blue} />
            <Text style={styles.quickActionText}>Track order</Text>
          </Pressable>
          <Pressable style={styles.quickAction} onPress={() => router.push('/wallet-actions/scan-pay')}>
            <Ionicons name="qr-code-outline" size={18} color={colors.blue} />
            <Text style={styles.quickActionText}>Scan to pay</Text>
          </Pressable>
        </View>

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
    paddingVertical: 15,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  searchPlaceholder: { flex: 1, color: colors.textMuted, fontSize: fontSize.base },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  locationText: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  chipsRow: { gap: spacing.sm, paddingBottom: spacing.base },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  chipActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipText: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.textOnBrand },
  hero: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.lg, ...shadow.raised },
  heroTitle: { color: colors.textOnBrand, fontSize: fontSize.xl, fontWeight: fontWeight.heavy },
  heroBody: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.sm, marginTop: 4, lineHeight: 19 },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  heroCtaText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  heroBadges: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, flexWrap: 'wrap' },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroBadgeText: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.xs },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary },
  seeAll: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  categoryTile: {
    width: '23%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    alignItems: 'center',
    paddingVertical: spacing.base,
    ...shadow.card,
  },
  categoryIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  categoryLabel: { fontSize: fontSize.xs, color: colors.textPrimary, fontWeight: fontWeight.medium },
  popularRow: { gap: spacing.md, paddingBottom: spacing.lg },
  popularCard: {
    width: 168,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    ...shadow.card,
  },
  popularHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  popularLogo: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.skyTint },
  popularName: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  popularCover: { height: 84, borderRadius: radius.sm, backgroundColor: colors.skyTint },
  quickActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  quickActionText: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  trustText: { color: colors.textSecondary, fontSize: fontSize.sm },
});
