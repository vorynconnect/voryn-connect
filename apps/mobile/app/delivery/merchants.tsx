import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { Restaurant } from '@/lib/types';

const FILTERS = [
  { key: 'fast', label: 'Fast delivery', icon: 'flash-outline' },
  { key: 'free', label: 'Free delivery', icon: 'bicycle-outline' },
  { key: 'top', label: 'Top rated', icon: 'star-outline' },
  { key: 'pickup', label: 'Pickup', icon: 'bag-handle-outline' },
] as const;

/** "Restaurants nearby" results list. */
export default function MerchantsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string | null>(null);

  const restaurantsQuery = useQuery({
    queryKey: ['restaurants', search],
    queryFn: () => api<{ restaurants: Restaurant[] }>(`/v1/discovery/restaurants${search ? `?q=${encodeURIComponent(search)}` : ''}`),
  });

  let restaurants = restaurantsQuery.data?.restaurants ?? [];
  if (filter === 'free') restaurants = restaurants.filter((r) => r.deliveryFeeMinor === 0);
  if (filter === 'fast') restaurants = [...restaurants].sort((a, b) => a.minDeliveryMinutes - b.minDeliveryMinutes);
  if (filter === 'top') restaurants = [...restaurants].sort((a, b) => b.provider.ratingAvg - a.provider.ratingAvg);

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={restaurantsQuery.isRefetching} onRefresh={() => restaurantsQuery.refetch()} tintColor={colors.blue} />
        }
      >
        <View style={styles.locationChip}>
          <Ionicons name="location" size={14} color={colors.blue} />
          <Text style={styles.locationText}>Portmore, Jamaica</Text>
          <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
        </View>

        <Text style={styles.title}>Restaurants nearby</Text>
        <Text style={styles.subtitle}>Choose from trusted third-party food partners.</Text>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search meals or restaurants"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          <Ionicons name="options-outline" size={20} color={colors.blue} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(active ? null : f.key)}
              >
                <Ionicons name={f.icon} size={15} color={active ? colors.textOnBrand : colors.textPrimary} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {restaurantsQuery.isLoading ? <LoadingState label="Finding restaurants…" /> : null}
        {restaurantsQuery.isError ? <ErrorState onRetry={() => restaurantsQuery.refetch()} /> : null}
        {restaurantsQuery.isSuccess && restaurants.length === 0 ? (
          <EmptyState icon="restaurant-outline" title="No restaurants available" body="Try a different search or filter." />
        ) : null}

        {restaurants.map((restaurant) => (
          <Pressable
            key={restaurant.id}
            onPress={() => router.push({ pathname: '/provider/[id]', params: { id: restaurant.providerId } })}
          >
            <Card padded={false} style={styles.resultCard}>
              <View style={styles.resultRow}>
                <View>
                  <Image source={{ uri: restaurant.imageUrl ?? undefined }} style={styles.resultImage} contentFit="cover" />
                  {restaurant.isPromoted ? (
                    <View style={styles.promotedBadge}>
                      <Ionicons name="star" size={10} color={colors.textOnBrand} />
                      <Text style={styles.promotedText}>Promoted</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.resultBody}>
                  <View style={styles.resultTitleRow}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {restaurant.name}
                    </Text>
                    <Ionicons name="heart-outline" size={20} color={colors.textSecondary} />
                  </View>
                  <View style={styles.tagsRow}>
                    {restaurant.cuisineTags.slice(0, 2).map((tag) => (
                      <View key={tag} style={styles.tag}>
                        <Text style={styles.tagText}>{tag}</Text>
                      </View>
                    ))}
                    {restaurant.provider.ratingAvg >= 4.7 ? (
                      <View style={[styles.tag, styles.topRatedTag]}>
                        <Text style={styles.topRatedText}>Top Rated</Text>
                      </View>
                    ) : null}
                  </View>
                  {restaurant.description ? (
                    <Text style={styles.resultDesc} numberOfLines={2}>
                      {restaurant.description}
                    </Text>
                  ) : null}
                  <View style={styles.metaRow}>
                    <Ionicons name="star" size={13} color={colors.star} />
                    <Text style={styles.metaStrong}>{restaurant.provider.ratingAvg.toFixed(1)}</Text>
                    <Text style={styles.metaText}>({restaurant.provider.ratingCount})</Text>
                    <Text style={styles.metaDot}>|</Text>
                    <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.metaText}>
                      {restaurant.minDeliveryMinutes}–{restaurant.maxDeliveryMinutes} min
                    </Text>
                    <Text style={styles.metaDot}>|</Text>
                    <Ionicons name="bicycle-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.metaText}>
                      {restaurant.deliveryFeeMinor === 0 ? 'Free' : `${formatJmd(restaurant.deliveryFeeMinor)} fee`}
                    </Text>
                  </View>
                </View>
              </View>
            </Card>
          </Pressable>
        ))}

        <Card style={styles.walletBanner}>
          <View style={styles.walletBannerIcon}>
            <Ionicons name="wallet" size={26} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.walletBannerTitle}>FREE DELIVERY with Voryn Wallet</Text>
            <Text style={styles.walletBannerBody}>Pay with your Voryn Wallet and get free delivery on eligible orders.</Text>
          </View>
          <Pressable style={styles.walletBannerCta} onPress={() => router.push('/(tabs)/wallet')}>
            <Text style={styles.walletBannerCtaText}>Learn more</Text>
            <Ionicons name="chevron-forward" size={13} color={colors.blue} />
          </Pressable>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  locationText: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: 4,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: fontSize.base, paddingVertical: spacing.md },
  chipsRow: { gap: spacing.sm, paddingBottom: spacing.base },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  chipActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipText: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.textOnBrand, fontWeight: fontWeight.bold },
  resultCard: { marginBottom: spacing.md, overflow: 'hidden' },
  resultRow: { flexDirection: 'row' },
  resultImage: { width: 118, height: '100%', minHeight: 130, backgroundColor: colors.skyTint },
  promotedBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  promotedText: { color: colors.textOnBrand, fontSize: 10, fontWeight: fontWeight.bold },
  resultBody: { flex: 1, padding: spacing.md },
  resultTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  resultName: { flex: 1, fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 },
  tag: { backgroundColor: colors.skyTint, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  topRatedTag: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.blue },
  topRatedText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  resultDesc: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 6, lineHeight: 19 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm, flexWrap: 'wrap' },
  metaStrong: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  metaText: { fontSize: fontSize.sm, color: colors.textSecondary },
  metaDot: { color: colors.textMuted },
  walletBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.skyTint,
    marginTop: spacing.sm,
  },
  walletBannerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletBannerTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  walletBannerBody: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
  walletBannerCta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  walletBannerCtaText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
});
