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
import type { ServiceListing } from '@/lib/types';
import { VERTICALS, type Vertical } from '@/features/services/config';

const FILTERS = [
  { key: 'nearest', label: 'Nearest', icon: 'navigate-outline' },
  { key: 'mobile', label: 'Mobile Service', icon: 'car-outline' },
  { key: 'top', label: 'Top Rated', icon: 'star-outline' },
  { key: 'open', label: 'Open Now', icon: 'time-outline' },
] as const;

/** Provider results for a vertical/category (e.g. "Oil Change near you"). */
export default function ServiceResultsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ vertical: Vertical; categorySlug?: string; categoryLabel?: string }>();
  const vertical = (params.vertical ?? 'AUTO_CARE') as Vertical;
  const config = VERTICALS[vertical];
  const [search, setSearch] = useState(params.categoryLabel ?? '');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('nearest');

  const listingsQuery = useQuery({
    queryKey: ['service-results', vertical, params.categorySlug, search],
    queryFn: () => {
      const qs = new URLSearchParams({ vertical, limit: '30' });
      if (params.categorySlug) qs.set('categorySlug', params.categorySlug);
      else if (search.trim()) qs.set('q', search.trim());
      return api<{ listings: ServiceListing[] }>(`/v1/discovery/service-listings?${qs}`);
    },
  });

  let listings = listingsQuery.data?.listings ?? [];
  if (filter === 'mobile') listings = listings.filter((l) => l.supportsMobile);
  if (filter === 'top') listings = [...listings].sort((a, b) => b.provider.ratingAvg - a.provider.ratingAvg);

  const heading = params.categoryLabel ? `${params.categoryLabel} near you` : `${config.title} near you`;

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={listingsQuery.isRefetching} onRefresh={() => listingsQuery.refetch()} tintColor={colors.blue} />
        }
      >
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={`Search ${config.resultsNoun}...`}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          <Ionicons name="options-outline" size={20} color={colors.blue} />
        </View>

        <View style={styles.locationChip}>
          <Ionicons name="location" size={14} color={colors.blue} />
          <Text style={styles.locationText}>Portmore, Jamaica</Text>
          <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
        </View>

        <Text style={styles.heading}>{heading}</Text>
        <Text style={styles.subheading}>
          Trusted third-party {config.resultsNoun} offering quality services in your area.
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              style={[styles.chip, filter === f.key && styles.chipActive]}
              onPress={() => setFilter(f.key)}
            >
              <Ionicons name={f.icon} size={15} color={filter === f.key ? colors.textOnBrand : colors.textPrimary} />
              <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {listingsQuery.isLoading ? <LoadingState label="Finding providers near you…" /> : null}
        {listingsQuery.isError ? <ErrorState onRetry={() => listingsQuery.refetch()} /> : null}
        {listingsQuery.isSuccess && listings.length === 0 ? (
          <EmptyState
            icon="business-outline"
            title="No providers nearby"
            body="Try a different category or check back soon — new providers join every week."
          />
        ) : null}

        {listings.map((listing) => {
          const fromPrice = listing.packages[0]?.priceMinor;
          return (
            <Card key={listing.id} padded={false} style={styles.resultCard}>
              <View style={styles.resultRow}>
                <View style={styles.resultImageWrap}>
                  <Image source={{ uri: listing.provider.coverUrl ?? listing.imageUrl ?? undefined }} style={styles.resultImage} contentFit="cover" />
                  <Image source={{ uri: listing.provider.logoUrl ?? undefined }} style={styles.resultLogo} contentFit="cover" />
                </View>
                <View style={styles.resultBody}>
                  <View style={styles.resultTitleRow}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {listing.provider.name}
                    </Text>
                    <Pressable hitSlop={8}>
                      <Ionicons name="heart-outline" size={20} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                  <View style={styles.metaRow}>
                    <Ionicons name="star" size={13} color={colors.star} />
                    <Text style={styles.metaStrong}>{listing.provider.ratingAvg.toFixed(1)}</Text>
                    <Text style={styles.metaDot}>•</Text>
                    <Text style={styles.metaText}>{listing.durationMinutes} min</Text>
                    <Text style={styles.metaDot}>•</Text>
                    <Text style={[styles.metaText, { color: colors.success }]}>Open now</Text>
                  </View>
                  <View style={styles.tagsRow}>
                    {listing.tags.slice(0, 3).map((tag) => (
                      <View key={tag} style={styles.tag}>
                        <Text style={styles.tagText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                  {listing.description ? (
                    <Text style={styles.resultDesc} numberOfLines={2}>
                      {listing.description}
                    </Text>
                  ) : null}
                  <View style={styles.resultFooter}>
                    {fromPrice !== undefined ? (
                      <Text style={styles.fromPrice}>
                        From <Text style={styles.fromPriceStrong}>{formatJmd(fromPrice)}</Text>
                      </Text>
                    ) : (
                      <View />
                    )}
                    <Pressable
                      style={styles.viewButton}
                      onPress={() => router.push({ pathname: '/services/listing/[id]', params: { id: listing.id } })}
                    >
                      <Text style={styles.viewButtonText}>View services</Text>
                      <Ionicons name="chevron-forward" size={15} color={colors.blue} />
                    </Pressable>
                  </View>
                </View>
              </View>
            </Card>
          );
        })}

        <Card style={styles.footerCard}>
          <View style={styles.footerItem}>
            <Ionicons name="shield-checkmark-outline" size={22} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.footerTitle}>Verified providers</Text>
              <Text style={styles.footerBody}>All providers are vetted for quality and reliability.</Text>
            </View>
          </View>
          <View style={styles.footerDivider} />
          <View style={styles.footerItem}>
            <Ionicons name="pricetag-outline" size={22} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.footerTitle}>Transparent pricing</Text>
              <Text style={styles.footerBody}>Upfront quotes with no hidden fees.</Text>
            </View>
          </View>
        </Card>
        <View style={styles.trustRow}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.blue} />
          <Text style={styles.trustFootnote}>Services provided by trusted third-party {config.resultsNoun}</Text>
        </View>
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
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.base,
    ...shadow.card,
  },
  locationText: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  heading: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subheading: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.base, lineHeight: 20 },
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
  resultImageWrap: { width: 110 },
  resultImage: { flex: 1, minHeight: 150, backgroundColor: colors.skyTint },
  resultLogo: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.skyTint,
  },
  resultBody: { flex: 1, padding: spacing.md },
  resultTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultName: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  metaStrong: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  metaText: { fontSize: fontSize.sm, color: colors.textSecondary },
  metaDot: { color: colors.textMuted, fontSize: fontSize.sm },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: spacing.sm },
  tag: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  tagText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  resultDesc: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 19 },
  resultFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  fromPrice: { fontSize: fontSize.sm, color: colors.textSecondary },
  fromPriceStrong: { color: colors.blue, fontWeight: fontWeight.heavy, fontSize: fontSize.md },
  viewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  viewButtonText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  footerCard: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  footerItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footerDivider: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: colors.border, marginHorizontal: spacing.md },
  footerTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textPrimary },
  footerBody: { fontSize: 10, color: colors.textSecondary, lineHeight: 14 },
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  trustFootnote: { color: colors.textSecondary, fontSize: fontSize.xs },
});
