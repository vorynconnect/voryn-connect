import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ErrorState, Skeleton } from '@/components/States';
import { colors, fontSize, fontWeight, gradients, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { Restaurant } from '@/lib/types';

const CATEGORIES = [
  { label: 'Restaurants', icon: 'restaurant-outline', category: 'RESTAURANT' },
  { label: 'Grocery', icon: 'basket-outline', category: 'GROCERY' },
  { label: 'Pharmacy', icon: 'medkit-outline', category: 'PHARMACY' },
  { label: 'Convenience', icon: 'storefront-outline', category: 'CONVENIENCE' },
  { label: 'Drinks', icon: 'wine-outline', category: 'DRINKS' },
] as const;

type TrendingItem = { id: string; name: string; priceMinor: number; imageUrl: string | null; merchant: string; menuItemId?: string; productId?: string };

/** Delivery landing — categories, popular merchants, trending items. */
export default function DeliveryLandingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const restaurantsQuery = useQuery({
    queryKey: ['restaurants'],
    queryFn: () => api<{ restaurants: Restaurant[] }>('/v1/discovery/restaurants'),
  });
  const providersQuery = useQuery({
    queryKey: ['delivery-providers'],
    queryFn: async () => {
      const [grocery, convenience, pharmacy] = await Promise.all([
        api<{ providers: Array<{ id: string; name: string; logoUrl: string | null; coverUrl: string | null; ratingAvg: number; ratingCount: number; categories: string[] }> }>(
          '/v1/discovery/providers?category=GROCERY',
        ),
        api<{ providers: Array<{ id: string; name: string; logoUrl: string | null; coverUrl: string | null; ratingAvg: number; ratingCount: number; categories: string[] }> }>(
          '/v1/discovery/providers?category=CONVENIENCE',
        ),
        api<{ providers: Array<{ id: string; name: string; logoUrl: string | null; coverUrl: string | null; ratingAvg: number; ratingCount: number; categories: string[] }> }>(
          '/v1/discovery/providers?category=PHARMACY',
        ),
      ]);
      return [...grocery.providers, ...convenience.providers, ...pharmacy.providers];
    },
  });

  const restaurants = restaurantsQuery.data?.restaurants ?? [];
  const stores = providersQuery.data ?? [];

  // Trending = first popular menu items across seeded restaurants.
  const trendingQuery = useQuery({
    queryKey: ['trending-items'],
    queryFn: async () => {
      const res = await api<{
        menuItems: Array<{ id: string; name: string; priceMinor: number; imageUrl: string | null; category: { menu: { restaurant: { name: string } } } }>;
        products: Array<{ id: string; name: string; priceMinor: number; imageUrl: string | null; store: { name: string } }>;
      }>('/v1/discovery/search?q=a');
      const items: TrendingItem[] = [
        ...res.menuItems.slice(0, 3).map((m) => ({
          id: m.id,
          menuItemId: m.id,
          name: m.name,
          priceMinor: m.priceMinor,
          imageUrl: m.imageUrl,
          merchant: m.category.menu.restaurant.name,
        })),
        ...res.products.slice(0, 2).map((p) => ({
          id: p.id,
          productId: p.id,
          name: p.name,
          priceMinor: p.priceMinor,
          imageUrl: p.imageUrl,
          merchant: p.store.name,
        })),
      ];
      return items;
    },
  });

  const addToCart = async (item: TrendingItem) => {
    await api('/v1/carts/items', {
      method: 'POST',
      body: { menuItemId: item.menuItemId, productId: item.productId, quantity: 1 },
    });
    await queryClient.invalidateQueries({ queryKey: ['cart'] });
    router.push('/delivery/cart');
  };

  const merchantLabel = (categories: string[]) => {
    if (categories.includes('GROCERY')) return { tags: ['Grocery', 'Produce'] };
    if (categories.includes('PHARMACY')) return { tags: ['Pharmacy', 'Health'] };
    if (categories.includes('CONVENIENCE')) return { tags: ['Convenience', 'Snacks'] };
    return { tags: ['Store'] };
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={restaurantsQuery.isRefetching} onRefresh={() => restaurantsQuery.refetch()} tintColor={colors.blue} />
        }
      >
        <Text style={styles.title}>Delivery</Text>
        <Text style={styles.subtitle}>Order food, groceries, and essentials from nearby providers.</Text>

        <Pressable style={styles.searchBar} onPress={() => router.push('/search')}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <Text style={styles.searchPlaceholder}>Search food, groceries, or stores</Text>
          <Ionicons name="options-outline" size={20} color={colors.blue} />
        </Pressable>

        <LinearGradient colors={gradients.walletCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
          <Text style={styles.bannerKicker}>⚡ FAST. RELIABLE. LOCAL.</Text>
          <Text style={styles.bannerTitle}>Get it fast with Voryn Connect</Text>
          <Text style={styles.bannerBody}>Save more with Voryn Wallet on every order.</Text>
          <Pressable style={styles.bannerCta} onPress={() => router.push('/delivery/merchants')}>
            <Text style={styles.bannerCtaText}>Learn more</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.blue} />
          </Pressable>
        </LinearGradient>

        {/* Category chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesRow}>
          {CATEGORIES.map((cat) => (
            <Pressable
              key={cat.label}
              style={styles.categoryChip}
              onPress={() => router.push({ pathname: '/delivery/merchants', params: { category: cat.category } })}
            >
              <Ionicons name={cat.icon} size={17} color={colors.blue} />
              <Text style={styles.categoryChipText}>{cat.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Popular near you */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Popular near you</Text>
          <Pressable onPress={() => router.push('/delivery/merchants')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        {restaurantsQuery.isError ? <ErrorState onRetry={() => restaurantsQuery.refetch()} /> : null}
        {restaurantsQuery.isLoading ? (
          <View style={styles.merchantsRow}>
            <Skeleton height={200} width={170} />
            <Skeleton height={200} width={170} />
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.merchantsRow}>
            {restaurants.map((restaurant) => (
              <Pressable
                key={restaurant.id}
                style={styles.merchantCard}
                onPress={() => router.push({ pathname: '/provider/[id]', params: { id: restaurant.providerId } })}
              >
                <View>
                  <Image source={{ uri: restaurant.imageUrl ?? undefined }} style={styles.merchantImage} contentFit="cover" />
                  <View style={styles.etaBadge}>
                    <Text style={styles.etaBadgeText}>
                      {restaurant.minDeliveryMinutes}–{restaurant.maxDeliveryMinutes} min
                    </Text>
                  </View>
                  <Pressable style={styles.heartButton} hitSlop={6}>
                    <Ionicons name="heart-outline" size={16} color={colors.textPrimary} />
                  </Pressable>
                </View>
                <View style={styles.merchantBody}>
                  <Text style={styles.merchantName} numberOfLines={1}>
                    {restaurant.name}
                  </Text>
                  <View style={styles.merchantTags}>
                    {restaurant.cuisineTags.slice(0, 2).map((tag) => (
                      <View key={tag} style={styles.merchantTag}>
                        <Text style={styles.merchantTagText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.merchantMetaRow}>
                    <Ionicons name="star" size={12} color={colors.star} />
                    <Text style={styles.merchantMetaStrong}>{restaurant.provider.ratingAvg.toFixed(1)}</Text>
                    <Text style={styles.merchantMeta}>({restaurant.provider.ratingCount})</Text>
                  </View>
                  <View style={styles.merchantFeeRow}>
                    <Ionicons name="bicycle-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.merchantMeta}>
                      {restaurant.deliveryFeeMinor === 0 ? 'Free delivery' : `${formatJmd(restaurant.deliveryFeeMinor)} fee`}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
            {stores.map((store) => {
              const labels = merchantLabel(store.categories);
              return (
                <Pressable
                  key={store.id}
                  style={styles.merchantCard}
                  onPress={() => router.push({ pathname: '/provider/[id]', params: { id: store.id } })}
                >
                  <Image source={{ uri: store.coverUrl ?? undefined }} style={styles.merchantImage} contentFit="cover" />
                  <View style={styles.merchantBody}>
                    <Text style={styles.merchantName} numberOfLines={1}>
                      {store.name}
                    </Text>
                    <View style={styles.merchantTags}>
                      {labels.tags.map((tag) => (
                        <View key={tag} style={styles.merchantTag}>
                          <Text style={styles.merchantTagText}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.merchantMetaRow}>
                      <Ionicons name="star" size={12} color={colors.star} />
                      <Text style={styles.merchantMetaStrong}>{store.ratingAvg.toFixed(1)}</Text>
                      <Text style={styles.merchantMeta}>({store.ratingCount})</Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Trending items */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Trending items</Text>
          <Pressable onPress={() => router.push('/search')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.merchantsRow}>
          {(trendingQuery.data ?? []).map((item) => (
            <Card key={item.id} style={styles.trendingCard} padded={false}>
              <Image source={{ uri: item.imageUrl ?? undefined }} style={styles.trendingImage} contentFit="cover" />
              <View style={styles.trendingBody}>
                <Text style={styles.trendingName} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.merchantTag}>
                  <Text style={styles.merchantTagText}>{item.merchant}</Text>
                </View>
                <View style={styles.trendingFooter}>
                  <Text style={styles.trendingPrice}>{formatJmd(item.priceMinor)}</Text>
                  <Pressable style={styles.trendingAdd} onPress={() => addToCart(item)}>
                    <Ionicons name="add" size={18} color={colors.textOnBrand} />
                  </Pressable>
                </View>
              </View>
            </Card>
          ))}
        </ScrollView>

        {/* Footer trust strip */}
        <Card style={styles.trustCard} padded={false}>
          {(
            [
              { icon: 'shield-checkmark-outline', title: 'Verified providers', body: 'Trusted third-party merchants' },
              { icon: 'wallet-outline', title: 'Save with Voryn Wallet', body: 'Unlock exclusive discounts' },
              { icon: 'navigate-circle-outline', title: 'Real-time tracking', body: 'Track your order live' },
            ] as const
          ).map((item) => (
            <View key={item.title} style={styles.trustItem}>
              <Ionicons name={item.icon} size={20} color={colors.blue} />
              <Text style={styles.trustTitle}>{item.title}</Text>
              <Text style={styles.trustBody}>{item.body}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
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
  banner: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.base, ...shadow.raised },
  bannerKicker: { color: colors.cyan, fontSize: fontSize.xs, fontWeight: fontWeight.bold, letterSpacing: 0.5 },
  bannerTitle: { color: colors.textOnBrand, fontSize: fontSize.xl, fontWeight: fontWeight.heavy, marginTop: 4, maxWidth: '80%' },
  bannerBody: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.sm, marginTop: 4 },
  bannerCta: {
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
  bannerCtaText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  categoriesRow: { gap: spacing.sm, paddingBottom: spacing.lg },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    ...shadow.card,
  },
  categoryChipText: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary },
  seeAll: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  merchantsRow: { gap: spacing.md, paddingBottom: spacing.lg },
  merchantCard: {
    width: 175,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.card,
  },
  merchantImage: { height: 100, backgroundColor: colors.skyTint },
  etaBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  etaBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textPrimary },
  heartButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  merchantBody: { padding: spacing.md },
  merchantName: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  merchantTags: { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  merchantTag: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  merchantTagText: { color: colors.blue, fontSize: 10, fontWeight: fontWeight.semibold },
  merchantMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
  merchantMetaStrong: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textPrimary },
  merchantMeta: { fontSize: fontSize.xs, color: colors.textSecondary },
  merchantFeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  trendingCard: { width: 160, overflow: 'hidden' },
  trendingImage: { height: 96, backgroundColor: colors.skyTint },
  trendingBody: { padding: spacing.md },
  trendingName: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: 4 },
  trendingFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  trendingPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  trendingAdd: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustCard: { flexDirection: 'row', padding: spacing.base, gap: spacing.sm },
  trustItem: { flex: 1, alignItems: 'center', gap: 3 },
  trustTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textPrimary, textAlign: 'center' },
  trustBody: { fontSize: 10, color: colors.textSecondary, textAlign: 'center' },
});
