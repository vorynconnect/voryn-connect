import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { LoadingState, ErrorState, Skeleton } from '@/components/States';
import { colors, fontSize, fontWeight, gradients, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import type { HomeFeed, WalletSnapshot } from '@/lib/types';

const SERVICE_TILES: Array<{ label: string; icon: keyof typeof Ionicons.glyphMap; href: Href }> = [
  { label: 'Get a Ride', icon: 'car-sport', href: '/rides' },
  { label: 'Delivery', icon: 'bicycle', href: '/delivery' },
  { label: 'Home Services', icon: 'home', href: '/home-services' },
  { label: 'Auto Care', icon: 'settings', href: '/auto-care' },
];

const QUICK_ICONS: Array<{ label: string; icon: keyof typeof Ionicons.glyphMap; href: Href }> = [
  { label: 'Get a Ride', icon: 'car-outline', href: '/rides' },
  { label: 'Rent a Vehicle', icon: 'key-outline', href: '/rentals' },
  { label: 'Delivery', icon: 'briefcase-outline', href: '/delivery' },
  { label: 'Auto Care', icon: 'build-outline', href: '/auto-care' },
  { label: 'Technicians', icon: 'person-outline', href: '/technicians' },
  { label: 'Home Services', icon: 'home-outline', href: '/home-services' },
  { label: 'Scan & Pay', icon: 'qr-code-outline', href: '/wallet-actions/scan-pay' },
  { label: 'Orders', icon: 'clipboard-outline', href: '/(tabs)/orders' },
];

function categoryLabel(categories: string[]): string {
  const first = categories[0] ?? '';
  const map: Record<string, string> = {
    RESTAURANT: 'Delivery',
    GROCERY: 'Delivery',
    PHARMACY: 'Delivery',
    CONVENIENCE: 'Delivery',
    DRINKS: 'Delivery',
    RIDES: 'Ride',
    VEHICLE_RENTAL: 'Rentals',
    AUTO_CARE: 'Auto Care',
    TECHNICIAN: 'Technicians',
    HOME_SERVICES: 'Home Services',
  };
  return map[first] ?? 'Provider';
}

export default function HomeScreen() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const firstName = user?.fullName.split(' ')[0] ?? 'there';

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: () => api<WalletSnapshot>('/v1/wallet'),
  });
  const feedQuery = useQuery({
    queryKey: ['home-feed'],
    queryFn: () => api<HomeFeed>('/v1/discovery/home'),
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning,' : hour < 17 ? 'Good afternoon,' : 'Good evening,';

  if (feedQuery.isError && walletQuery.isError) {
    return (
      <View style={styles.flex}>
        <ScreenHeader />
        <ErrorState onRetry={() => Promise.all([feedQuery.refetch(), walletQuery.refetch()])} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.headerBlock}>
        <View style={styles.greetingRow}>
          <View>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.name}>{firstName}</Text>
          </View>
        </View>
        <ScreenHeader />
      </View>

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={feedQuery.isRefetching}
            onRefresh={() => {
              void feedQuery.refetch();
              void walletQuery.refetch();
            }}
            tintColor={colors.blue}
          />
        }
      >
        <Pressable style={styles.locationChip} onPress={() => router.push('/profile-pages/addresses')}>
          <Ionicons name="location" size={16} color={colors.blue} />
          <Text style={styles.locationText}>Portmore, Jamaica</Text>
          <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
        </Pressable>

        <Pressable style={styles.searchBar} onPress={() => router.push('/search')}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <Text style={styles.searchPlaceholder}>Search rides, food, stores, services...</Text>
          <Ionicons name="options-outline" size={20} color={colors.blue} />
        </Pressable>

        {/* Wallet card */}
        <LinearGradient colors={gradients.walletCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.walletCard}>
          <View style={styles.walletTop}>
            <Ionicons name="wallet-outline" size={20} color={colors.textOnBrand} />
            <Text style={styles.walletTitle}>Voryn Wallet</Text>
          </View>
          <Text style={styles.walletBalanceLabel}>Balance</Text>
          {walletQuery.isLoading ? (
            <Skeleton height={34} width={180} style={{ backgroundColor: 'rgba(255,255,255,0.25)' }} />
          ) : (
            <Text style={styles.walletBalance}>
              {walletQuery.data ? formatJmd(walletQuery.data.wallet.balanceMinor) : '—'}
            </Text>
          )}
          <View style={styles.walletActions}>
            <Pressable style={styles.walletAction} onPress={() => router.push('/wallet-actions/top-up')}>
              <Ionicons name="add-circle-outline" size={18} color={colors.textOnBrand} />
              <Text style={styles.walletActionText}>Top Up</Text>
            </Pressable>
            <View style={styles.walletDivider} />
            <Pressable style={styles.walletAction} onPress={() => router.push('/wallet-actions/scan-pay')}>
              <Ionicons name="qr-code-outline" size={18} color={colors.textOnBrand} />
              <Text style={styles.walletActionText}>Pay</Text>
            </Pressable>
            <View style={styles.walletDivider} />
            <Pressable style={styles.walletAction} onPress={() => router.push('/wallet-actions/transactions')}>
              <Ionicons name="time-outline" size={18} color={colors.textOnBrand} />
              <Text style={styles.walletActionText}>History</Text>
            </Pressable>
          </View>
        </LinearGradient>

        {/* Service tiles */}
        <View style={styles.tileRow}>
          {SERVICE_TILES.map((tile) => (
            <Pressable key={tile.label} style={styles.tile} onPress={() => router.push(tile.href)}>
              <View style={styles.tileImage}>
                <Ionicons name={tile.icon} size={38} color={colors.blue} />
              </View>
              <View style={styles.tileFooter}>
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {tile.label}
                </Text>
                <View style={styles.tileChevron}>
                  <Ionicons name="chevron-forward" size={14} color={colors.blue} />
                </View>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Quick icon grid */}
        <Card style={styles.quickGrid} padded={false}>
          {QUICK_ICONS.map((item) => (
            <Pressable key={item.label} style={styles.quickItem} onPress={() => router.push(item.href)}>
              <View style={styles.quickIcon}>
                <Ionicons name={item.icon} size={24} color={colors.blue} />
              </View>
              <Text style={styles.quickLabel} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </Card>

        {/* Deals banner */}
        <LinearGradient colors={gradients.banner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.dealsBanner}>
          <View style={styles.dealsLeft}>
            <Text style={styles.dealsKicker}>LIMITED TIME OFFER</Text>
            <Text style={styles.dealsTitle}>Deals near you</Text>
            <Text style={styles.dealsBody}>Save on food, rides, auto care, home services & more.</Text>
            <Pressable style={styles.dealsCta} onPress={() => router.push('/(tabs)/services')}>
              <Text style={styles.dealsCtaText}>Explore deals</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textOnBrand} />
            </Pressable>
          </View>
          <View style={styles.dealsBadge}>
            <Text style={styles.dealsBadgeTop}>Up to</Text>
            <Text style={styles.dealsBadgePercent}>25%</Text>
            <Text style={styles.dealsBadgeOff}>OFF</Text>
          </View>
        </LinearGradient>

        {/* Popular near you */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Popular near you</Text>
          <Pressable onPress={() => router.push('/(tabs)/services')}>
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
                  <View style={styles.popularHeadText}>
                    <Text style={styles.popularName} numberOfLines={1}>
                      {provider.name}
                    </Text>
                    <Text style={styles.popularCategory}>{categoryLabel(provider.categories)}</Text>
                  </View>
                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={13} color={colors.star} />
                    <Text style={styles.ratingText}>{provider.ratingAvg.toFixed(1)}</Text>
                  </View>
                </View>
                <Image source={{ uri: provider.coverUrl ?? undefined }} style={styles.popularCover} contentFit="cover" />
                <View style={styles.popularFooter}>
                  <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                  <Text style={styles.popularFooterText}>Portmore, Jamaica</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={styles.trustRow}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.blue} />
          <Text style={styles.trustText}>Trusted third-party providers</Text>
          <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
        </View>

        {/* Order again */}
        {(feedQuery.data?.orderAgain.length ?? 0) > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Order again</Text>
              <Pressable onPress={() => router.push('/(tabs)/orders')}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.popularRow}>
              {feedQuery.data!.orderAgain.map((order) => (
                <Pressable
                  key={order.id}
                  style={styles.againCard}
                  onPress={() => router.push({ pathname: '/provider/[id]', params: { id: order.provider.id } })}
                >
                  <Image source={{ uri: order.provider.logoUrl ?? undefined }} style={styles.againLogo} contentFit="cover" />
                  <View style={styles.againText}>
                    <Text style={styles.againName} numberOfLines={1}>
                      {order.provider.name}
                    </Text>
                    <Text style={styles.againMeta}>{categoryLabel(order.provider.categories)}</Text>
                  </View>
                  <Ionicons name="refresh" size={18} color={colors.blue} />
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {feedQuery.isLoading && !feedQuery.data ? <LoadingState label="Loading providers…" /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  headerBlock: { paddingTop: spacing['2xl'] },
  greetingRow: { position: 'absolute', top: spacing['2xl'] + 10, left: spacing.lg, zIndex: 2 },
  greeting: { color: colors.textSecondary, fontSize: fontSize.sm },
  name: { color: colors.textPrimary, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: 15,
    marginBottom: spacing.base,
    ...shadow.card,
  },
  searchPlaceholder: { flex: 1, color: colors.textMuted, fontSize: fontSize.base },
  walletCard: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.base,
    ...shadow.raised,
  },
  walletTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  walletTitle: { color: colors.textOnBrand, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  walletBalanceLabel: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.sm },
  walletBalance: { color: colors.textOnBrand, fontSize: 32, fontWeight: fontWeight.heavy, marginTop: 2 },
  walletActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.35)',
    paddingTop: spacing.md,
  },
  walletAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  walletActionText: { color: colors.textOnBrand, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  walletDivider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: 'rgba(255,255,255,0.35)' },
  tileRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.base },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.card,
  },
  tileImage: { height: 64, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.skyTint },
  tileFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tileLabel: { flex: 1, fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  tileChevron: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingVertical: spacing.base,
    marginBottom: spacing.base,
  },
  quickItem: { width: '25%', alignItems: 'center', paddingVertical: spacing.md },
  quickIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  quickLabel: { fontSize: fontSize.xs, color: colors.textPrimary, textAlign: 'center' },
  dealsBanner: {
    flexDirection: 'row',
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.raised,
  },
  dealsLeft: { flex: 1, paddingRight: spacing.md },
  dealsKicker: { color: colors.cyan, fontSize: fontSize.xs, fontWeight: fontWeight.bold, letterSpacing: 1 },
  dealsTitle: { color: colors.textOnBrand, fontSize: fontSize.xl, fontWeight: fontWeight.heavy, marginTop: 4 },
  dealsBody: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.sm, marginTop: 4, lineHeight: 19 },
  dealsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  dealsCtaText: { color: colors.textOnBrand, fontWeight: fontWeight.semibold, fontSize: fontSize.sm },
  dealsBadge: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: 44,
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dealsBadgeTop: { color: colors.textPrimary, fontSize: fontSize.xs },
  dealsBadgePercent: { color: colors.blue, fontSize: fontSize.xl, fontWeight: fontWeight.heavy },
  dealsBadgeOff: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary },
  seeAll: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  popularRow: { gap: spacing.md, paddingBottom: spacing.base },
  popularCard: {
    width: 168,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    ...shadow.card,
  },
  popularHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  popularLogo: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.skyTint },
  popularHeadText: { flex: 1 },
  popularName: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  popularCategory: { fontSize: fontSize.xs, color: colors.textSecondary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  popularCover: { height: 84, borderRadius: radius.sm, backgroundColor: colors.skyTint },
  popularFooter: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  popularFooterText: { fontSize: fontSize.xs, color: colors.textSecondary },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  trustText: { color: colors.textSecondary, fontSize: fontSize.sm },
  againCard: {
    width: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow.card,
  },
  againLogo: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.skyTint },
  againText: { flex: 1 },
  againName: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  againMeta: { fontSize: fontSize.xs, color: colors.textSecondary },
});
