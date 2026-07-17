import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { ProviderSummary, ServiceListing } from '@/lib/types';

type SearchResults = {
  providers: ProviderSummary[];
  menuItems: Array<{ id: string; name: string; priceMinor: number; imageUrl: string | null }>;
  products: Array<{ id: string; name: string; priceMinor: number; imageUrl: string | null }>;
  serviceListings: ServiceListing[];
  rentalVehicles: Array<{ id: string; make: string; model: string; dailyRateMinor: number; imageUrl: string | null }>;
};

const FILTERS = ['All', 'Services', 'Stores', 'Delivery', 'Near Me'] as const;
const DEFAULT_RECENTS = ['car wash', 'jerk chicken', 'oil change', 'plumber'];

export default function GlobalSearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [recents, setRecents] = useState<string[]>(DEFAULT_RECENTS);

  const searchQuery = useQuery({
    queryKey: ['search', submitted],
    queryFn: () => api<SearchResults>(`/v1/discovery/search?q=${encodeURIComponent(submitted)}`),
    enabled: submitted.length > 0,
  });

  const submit = (value?: string) => {
    const q = (value ?? query).trim();
    if (!q) return;
    setQuery(q);
    setSubmitted(q);
    setRecents((prev) => [q, ...prev.filter((r) => r !== q)].slice(0, 6));
  };

  const results = searchQuery.data;
  const bestMatch = results?.serviceListings[0] ?? null;
  const totalResults = results
    ? results.providers.length +
      results.menuItems.length +
      results.products.length +
      results.serviceListings.length +
      results.rentalVehicles.length
    : 0;

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search rides, food, stores, services..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => submit()}
            returnKeyType="search"
            autoFocus
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <Pressable style={styles.locationChip}>
          <Ionicons name="location" size={16} color={colors.blue} />
          <Text style={styles.locationText}>Portmore, Jamaica</Text>
          <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {FILTERS.map((f) => (
            <Pressable key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
              <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {submitted ? (
          <View style={styles.resultsHeader}>
            <Text style={styles.resultsCount}>{totalResults} results near you</Text>
            <Text style={styles.sortText}>Sort by: Relevance</Text>
          </View>
        ) : null}

        {/* Recent searches */}
        <View style={styles.recentsHeader}>
          <Text style={styles.recentsTitle}>Recent searches</Text>
          <Pressable onPress={() => setRecents([])}>
            <Text style={styles.clearAll}>Clear all</Text>
          </Pressable>
        </View>
        <View style={styles.recentsRow}>
          {recents.map((r) => (
            <Pressable key={r} style={styles.recentChip} onPress={() => submit(r)}>
              <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.recentChipText}>{r}</Text>
            </Pressable>
          ))}
        </View>

        {searchQuery.isLoading ? <LoadingState label="Searching…" /> : null}
        {searchQuery.isError ? <ErrorState onRetry={() => searchQuery.refetch()} /> : null}
        {submitted && searchQuery.isSuccess && totalResults === 0 ? (
          <EmptyState title="No results found" body={`We couldn't find anything for “${submitted}” near you.`} />
        ) : null}

        {/* Best match */}
        {bestMatch ? (
          <Card padded={false} style={styles.bestMatch}>
            <View style={styles.bestBadge}>
              <Text style={styles.bestBadgeText}>Best match</Text>
            </View>
            <View style={styles.bestRow}>
              <Image source={{ uri: bestMatch.imageUrl ?? bestMatch.provider.logoUrl ?? undefined }} style={styles.bestImage} contentFit="cover" />
              <View style={styles.bestBody}>
                <Text style={styles.bestName}>{bestMatch.provider.name}</Text>
                <Text style={styles.bestMeta}>{bestMatch.title}</Text>
                <View style={styles.bestRating}>
                  <Ionicons name="star" size={13} color={colors.star} />
                  <Text style={styles.bestRatingText}>
                    {bestMatch.provider.ratingAvg.toFixed(1)} ({bestMatch.provider.ratingCount})
                  </Text>
                </View>
                {bestMatch.packages[0] ? (
                  <Text style={styles.bestPrice}>
                    From <Text style={styles.bestPriceStrong}>{formatJmd(bestMatch.packages[0].priceMinor)}</Text>
                  </Text>
                ) : null}
                <View style={styles.bestTags}>
                  <View style={styles.tag}>
                    <Ionicons name="star-outline" size={11} color={colors.blue} />
                    <Text style={styles.tagText}>Top rated</Text>
                  </View>
                  <View style={[styles.tag, { backgroundColor: colors.successTint }]}>
                    <View style={styles.openDot} />
                    <Text style={[styles.tagText, { color: colors.success }]}>Open now</Text>
                  </View>
                  {bestMatch.supportsMobile ? (
                    <View style={styles.tag}>
                      <Ionicons name="car-outline" size={11} color={colors.blue} />
                      <Text style={styles.tagText}>Mobile service</Text>
                    </View>
                  ) : null}
                </View>
                <GradientButton
                  title="Book now"
                  style={{ marginTop: spacing.md }}
                  onPress={() => router.push({ pathname: '/services/listing/[id]', params: { id: bestMatch.id } })}
                />
              </View>
            </View>
          </Card>
        ) : null}

        {/* Services results */}
        {(results?.serviceListings.length ?? 0) > 1 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Services</Text>
            </View>
            {results!.serviceListings.slice(1).map((listing) => (
              <Card key={listing.id} style={styles.resultRow} padded={false}>
                <Image source={{ uri: listing.imageUrl ?? undefined }} style={styles.resultImage} contentFit="cover" />
                <View style={styles.resultBody}>
                  <Text style={styles.resultName}>{listing.provider.name}</Text>
                  <Text style={styles.resultMeta}>{listing.title}</Text>
                  <View style={styles.bestRating}>
                    <Ionicons name="star" size={12} color={colors.star} />
                    <Text style={styles.bestRatingText}>
                      {listing.provider.ratingAvg.toFixed(1)} ({listing.provider.ratingCount})
                    </Text>
                  </View>
                </View>
                <View style={styles.resultRight}>
                  {listing.packages[0] ? (
                    <>
                      <Text style={styles.resultFromLabel}>From</Text>
                      <Text style={styles.resultPrice}>{formatJmd(listing.packages[0].priceMinor)}</Text>
                    </>
                  ) : null}
                  <Pressable
                    style={styles.viewButton}
                    onPress={() => router.push({ pathname: '/services/listing/[id]', params: { id: listing.id } })}
                  >
                    <Text style={styles.viewButtonText}>View</Text>
                  </Pressable>
                </View>
              </Card>
            ))}
          </>
        ) : null}

        {/* Providers */}
        {(results?.providers.length ?? 0) > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Providers</Text>
            </View>
            {results!.providers.map((provider) => (
              <Card key={provider.id} style={styles.resultRow} padded={false}>
                <Image source={{ uri: provider.coverUrl ?? undefined }} style={styles.resultImage} contentFit="cover" />
                <View style={styles.resultBody}>
                  <Text style={styles.resultName}>{provider.name}</Text>
                  <View style={styles.bestRating}>
                    <Ionicons name="star" size={12} color={colors.star} />
                    <Text style={styles.bestRatingText}>
                      {provider.ratingAvg.toFixed(1)} ({provider.ratingCount})
                    </Text>
                  </View>
                </View>
                <View style={styles.resultRight}>
                  <Pressable
                    style={styles.viewButton}
                    onPress={() => router.push({ pathname: '/provider/[id]', params: { id: provider.id } })}
                  >
                    <Text style={styles.viewButtonText}>View</Text>
                  </Pressable>
                </View>
              </Card>
            ))}
          </>
        ) : null}

        {/* Products related to search */}
        {(results?.products.length ?? 0) > 0 || (results?.menuItems.length ?? 0) > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>
                {results?.menuItems.length ? 'Popular items related to your search' : 'Products related to your search'}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productsRow}>
              {[...(results?.menuItems ?? []), ...(results?.products ?? [])].map((item) => (
                <Card key={item.id} style={styles.productCard} padded={false}>
                  <Image source={{ uri: item.imageUrl ?? undefined }} style={styles.productImage} contentFit="cover" />
                  <View style={styles.productBody}>
                    <Text style={styles.productName} numberOfLines={2}>
                      {item.name}
                    </Text>
                    <Text style={styles.productPrice}>{formatJmd(item.priceMinor)}</Text>
                  </View>
                </Card>
              ))}
            </ScrollView>
          </>
        ) : null}

        {submitted ? (
          <View style={styles.trustRow}>
            <Ionicons name="shield-checkmark" size={16} color={colors.blue} />
            <Text style={styles.trustText}>
              Trusted third-party providers. Quality, pricing and delivery are managed by each provider.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
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
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: fontSize.md, paddingVertical: spacing.md },
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipText: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.textOnBrand, fontWeight: fontWeight.bold },
  resultsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  resultsCount: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  sortText: { fontSize: fontSize.sm, color: colors.textSecondary },
  recentsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  recentsTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  clearAll: { color: colors.blue, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  recentsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.base },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  recentChipText: { color: colors.textPrimary, fontSize: fontSize.sm },
  bestMatch: { marginBottom: spacing.lg, overflow: 'hidden' },
  bestBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 2,
    backgroundColor: colors.blue,
    borderTopLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  bestBadgeText: { color: colors.textOnBrand, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  bestRow: { flexDirection: 'row' },
  bestImage: { width: '42%', minHeight: 220, backgroundColor: colors.skyTint },
  bestBody: { flex: 1, padding: spacing.base },
  bestName: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  bestMeta: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  bestRating: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  bestRatingText: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: fontWeight.semibold },
  bestPrice: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.sm },
  bestPriceStrong: { color: colors.blue, fontSize: fontSize.lg, fontWeight: fontWeight.heavy },
  bestTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  tagText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  openDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary },
  resultRow: { flexDirection: 'row', marginBottom: spacing.md, overflow: 'hidden' },
  resultImage: { width: 96, backgroundColor: colors.skyTint },
  resultBody: { flex: 1, padding: spacing.md },
  resultName: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  resultMeta: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  resultRight: { alignItems: 'flex-end', justifyContent: 'center', padding: spacing.md },
  resultFromLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  resultPrice: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.blue, marginBottom: spacing.sm },
  viewButton: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  viewButtonText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  productsRow: { gap: spacing.md, paddingBottom: spacing.base },
  productCard: { width: 150, overflow: 'hidden' },
  productImage: { height: 100, backgroundColor: colors.skyTint },
  productBody: { padding: spacing.md },
  productName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.textPrimary, minHeight: 36 },
  productPrice: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.blue, marginTop: 4 },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.skyTint,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  trustText: { flex: 1, color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 17 },
});
