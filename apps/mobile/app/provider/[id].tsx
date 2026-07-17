import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  imageUrl: string | null;
  options: Array<{ id: string; groupName: string; name: string; priceDeltaMinor: number; isDefault: boolean }>;
};

type ProviderDetail = {
  provider: {
    id: string;
    name: string;
    description: string | null;
    categories: string[];
    logoUrl: string | null;
    coverUrl: string | null;
    ratingAvg: number;
    ratingCount: number;
    isVerified: boolean;
    restaurants: Array<{
      id: string;
      name: string;
      cuisineTags: string[];
      deliveryFeeMinor: number;
      minDeliveryMinutes: number;
      maxDeliveryMinutes: number;
      imageUrl: string | null;
      menus: Array<{ id: string; categories: Array<{ id: string; name: string; items: MenuItem[] }> }>;
    }>;
    stores: Array<{
      id: string;
      name: string;
      categories: Array<{ id: string; name: string; products: Array<{ id: string; name: string; description: string | null; priceMinor: number; imageUrl: string | null }> }>;
    }>;
    serviceListings: Array<{
      id: string;
      title: string;
      imageUrl: string | null;
      category: { name: string };
      packages: Array<{ priceMinor: number }>;
    }>;
    rentalVehicles: Array<{ id: string; make: string; model: string; dailyRateMinor: number; imageUrl: string | null }>;
  };
};

type CartResponse = { cart: { id: string; items: Array<{ id: string; quantity: number }> } | null };

/**
 * Provider detail — merchant storefront with menu categories for restaurants,
 * product shelves for stores, service listings, and rental vehicles.
 */
export default function ProviderDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState('');

  const detailQuery = useQuery({
    queryKey: ['provider', id],
    queryFn: () => api<ProviderDetail>(`/v1/discovery/providers/${id}`),
  });
  const cartQuery = useQuery({ queryKey: ['cart'], queryFn: () => api<CartResponse>('/v1/carts') });

  const addItem = useMutation({
    mutationFn: (input: { menuItemId?: string; productId?: string }) =>
      api('/v1/carts/items', { method: 'POST', body: { ...input, quantity: 1 } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart'] }),
  });

  const toggleFavorite = useMutation({
    mutationFn: () =>
      api<{ favorited: boolean }>('/v1/favorites/toggle', {
        method: 'POST',
        body: { subjectType: 'PROVIDER', subjectId: id },
      }),
  });

  const provider = detailQuery.data?.provider;
  const restaurant = provider?.restaurants[0];
  const menuCategories = useMemo(() => restaurant?.menus[0]?.categories ?? [], [restaurant]);
  const currentCategory = menuCategories.find((c) => c.id === activeCategory) ?? menuCategories[0];

  if (detailQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading provider…" />
      </View>
    );
  }
  if (detailQuery.isError || !provider) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => detailQuery.refetch()} />
      </View>
    );
  }

  const cartCount = cartQuery.data?.cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
  const filteredItems = (currentCategory?.items ?? []).filter(
    (item) => !menuSearch.trim() || item.name.toLowerCase().includes(menuSearch.trim().toLowerCase()),
  );

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        {/* Hero */}
        <Card padded={false} style={styles.heroCard}>
          <Image source={{ uri: restaurant?.imageUrl ?? provider.coverUrl ?? undefined }} style={styles.heroImage} contentFit="cover" />
          <Pressable style={styles.heartButton} onPress={() => toggleFavorite.mutate()}>
            <Ionicons name={toggleFavorite.data?.favorited ? 'heart' : 'heart-outline'} size={20} color={toggleFavorite.data?.favorited ? colors.danger : colors.textPrimary} />
          </Pressable>
        </Card>

        <Text style={styles.name}>{provider.name}</Text>
        <View style={styles.tagsRow}>
          {(restaurant?.cuisineTags ?? provider.categories.slice(0, 2)).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
          <View style={[styles.tag, styles.localTag]}>
            <Text style={styles.localTagText}>Local Favourites</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Ionicons name="star" size={14} color={colors.star} />
          <Text style={styles.metaStrong}>{provider.ratingAvg.toFixed(1)}</Text>
          <Text style={styles.metaText}>({provider.ratingCount})</Text>
          {restaurant ? (
            <>
              <Text style={styles.metaDot}>|</Text>
              <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.metaText}>
                {restaurant.minDeliveryMinutes}–{restaurant.maxDeliveryMinutes} min
              </Text>
              <Text style={styles.metaDot}>|</Text>
              <Ionicons name="bicycle-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.metaText}>
                {restaurant.deliveryFeeMinor === 0 ? 'Free delivery' : `${formatJmd(restaurant.deliveryFeeMinor)} fee`}
              </Text>
            </>
          ) : null}
          <Text style={styles.metaDot}>|</Text>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.blue} />
          <Text style={[styles.metaText, { color: colors.blue }]}>Third-party provider</Text>
        </View>

        {/* Restaurant menu */}
        {restaurant && menuCategories.length > 0 ? (
          <>
            <View style={styles.menuSearchBar}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.menuSearchInput}
                placeholder={`Search in ${provider.name}...`}
                placeholderTextColor={colors.textMuted}
                value={menuSearch}
                onChangeText={setMenuSearch}
              />
              <Ionicons name="options-outline" size={18} color={colors.blue} />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.menuTabs}>
              {menuCategories.map((category) => {
                const active = category.id === currentCategory?.id;
                return (
                  <Pressable key={category.id} style={styles.menuTab} onPress={() => setActiveCategory(category.id)}>
                    <Text style={[styles.menuTabText, active && styles.menuTabTextActive]}>{category.name}</Text>
                    {active ? <View style={styles.menuTabUnderline} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            {filteredItems.map((item) => (
              <Card key={item.id} padded={false} style={styles.itemCard}>
                <View style={styles.itemRow}>
                  <Image source={{ uri: item.imageUrl ?? undefined }} style={styles.itemImage} contentFit="cover" />
                  <View style={styles.itemBody}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    {item.description ? (
                      <Text style={styles.itemDesc} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}
                    <Text style={styles.itemPrice}>{formatJmd(item.priceMinor)}</Text>
                  </View>
                  <Pressable
                    style={styles.itemAdd}
                    onPress={() => addItem.mutate({ menuItemId: item.id })}
                    disabled={addItem.isPending}
                  >
                    <Ionicons name="add" size={22} color={colors.textOnBrand} />
                  </Pressable>
                </View>
              </Card>
            ))}
          </>
        ) : null}

        {/* Store products */}
        {provider.stores.map((store) =>
          store.categories.map((category) => (
            <View key={category.id}>
              <Text style={styles.sectionTitle}>{category.name}</Text>
              {category.products.map((product) => (
                <Card key={product.id} padded={false} style={styles.itemCard}>
                  <View style={styles.itemRow}>
                    <Image source={{ uri: product.imageUrl ?? undefined }} style={styles.itemImage} contentFit="cover" />
                    <View style={styles.itemBody}>
                      <Text style={styles.itemName}>{product.name}</Text>
                      <Text style={styles.itemPrice}>{formatJmd(product.priceMinor)}</Text>
                    </View>
                    <Pressable style={styles.itemAdd} onPress={() => addItem.mutate({ productId: product.id })}>
                      <Ionicons name="add" size={22} color={colors.textOnBrand} />
                    </Pressable>
                  </View>
                </Card>
              ))}
            </View>
          )),
        )}

        {/* Service listings */}
        {provider.serviceListings.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Services</Text>
            {provider.serviceListings.map((listing) => (
              <Pressable
                key={listing.id}
                onPress={() => router.push({ pathname: '/services/listing/[id]', params: { id: listing.id } })}
              >
                <Card padded={false} style={styles.itemCard}>
                  <View style={styles.itemRow}>
                    <Image source={{ uri: listing.imageUrl ?? undefined }} style={styles.itemImage} contentFit="cover" />
                    <View style={styles.itemBody}>
                      <Text style={styles.itemName}>{listing.title}</Text>
                      <Text style={styles.itemDesc}>{listing.category.name}</Text>
                      {listing.packages[0] ? (
                        <Text style={styles.itemPrice}>From {formatJmd(listing.packages[0].priceMinor)}</Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} style={{ alignSelf: 'center', marginRight: spacing.md }} />
                  </View>
                </Card>
              </Pressable>
            ))}
          </>
        ) : null}

        {/* Rental vehicles */}
        {provider.rentalVehicles.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Rental vehicles</Text>
            {provider.rentalVehicles.map((vehicle) => (
              <Pressable
                key={vehicle.id}
                onPress={() => router.push({ pathname: '/rentals/vehicle/[id]', params: { id: vehicle.id } })}
              >
                <Card padded={false} style={styles.itemCard}>
                  <View style={styles.itemRow}>
                    <Image source={{ uri: vehicle.imageUrl ?? undefined }} style={styles.itemImage} contentFit="cover" />
                    <View style={styles.itemBody}>
                      <Text style={styles.itemName}>
                        {vehicle.make} {vehicle.model}
                      </Text>
                      <Text style={styles.itemPrice}>{formatJmd(vehicle.dailyRateMinor)} / day</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} style={{ alignSelf: 'center', marginRight: spacing.md }} />
                  </View>
                </Card>
              </Pressable>
            ))}
          </>
        ) : null}

        <View style={{ height: cartCount > 0 ? 80 : 0 }} />
      </ScrollView>

      {/* View cart bar */}
      {cartCount > 0 ? (
        <Pressable style={styles.cartBar} onPress={() => router.push('/delivery/cart')}>
          <View style={styles.cartBadge}>
            <Ionicons name="cart" size={18} color={colors.blue} />
            <View style={styles.cartCount}>
              <Text style={styles.cartCountText}>{cartCount}</Text>
            </View>
          </View>
          <Text style={styles.cartBarText}>
            {cartCount} item{cartCount > 1 ? 's' : ''} • View cart
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textOnBrand} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  heroCard: { overflow: 'hidden', marginBottom: spacing.base },
  heroImage: { height: 200, backgroundColor: colors.skyTint },
  heartButton: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  tag: { backgroundColor: colors.skyTint, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  tagText: { color: colors.blue, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  localTag: { backgroundColor: colors.successTint },
  localTagText: { color: colors.success, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: spacing.md, marginBottom: spacing.base },
  metaStrong: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  metaText: { fontSize: fontSize.sm, color: colors.textSecondary },
  metaDot: { color: colors.textMuted, marginHorizontal: 2 },
  menuSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: 4,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  menuSearchInput: { flex: 1, color: colors.textPrimary, fontSize: fontSize.base, paddingVertical: spacing.sm + 2 },
  menuTabs: { gap: spacing.lg, paddingBottom: spacing.md },
  menuTab: { alignItems: 'center' },
  menuTabText: { fontSize: fontSize.md, color: colors.textSecondary, fontWeight: fontWeight.medium },
  menuTabTextActive: { color: colors.blue, fontWeight: fontWeight.bold },
  menuTabUnderline: { height: 3, alignSelf: 'stretch', backgroundColor: colors.blue, borderRadius: 2, marginTop: 5 },
  itemCard: { marginBottom: spacing.md, overflow: 'hidden' },
  itemRow: { flexDirection: 'row' },
  itemImage: { width: 104, minHeight: 104, backgroundColor: colors.skyTint },
  itemBody: { flex: 1, padding: spacing.md },
  itemName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  itemDesc: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  itemPrice: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 6 },
  itemAdd: {
    alignSelf: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    ...shadow.cta,
  },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: spacing.sm, marginBottom: spacing.md },
  cartBar: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.xl,
    right: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    ...shadow.cta,
  },
  cartBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartCount: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  cartCountText: { color: colors.textOnBrand, fontSize: 10, fontWeight: fontWeight.bold },
  cartBarText: { flex: 1, color: colors.textOnBrand, fontSize: fontSize.md, fontWeight: fontWeight.bold, textAlign: 'center' },
});
