import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ErrorState, Skeleton } from '@/components/States';
import { colors, fontSize, fontWeight, gradients, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { ServiceListing } from '@/lib/types';
import { VERTICALS, type Vertical } from './config';

/** Shared landing screen for Auto Care / Technicians / Home Services. */
export function VerticalLanding({ vertical }: { vertical: Vertical }) {
  const router = useRouter();
  const config = VERTICALS[vertical];

  const listingsQuery = useQuery({
    queryKey: ['listings', vertical],
    queryFn: () => api<{ listings: ServiceListing[] }>(`/v1/discovery/service-listings?vertical=${vertical}&limit=12`),
  });

  const listings = listingsQuery.data?.listings ?? [];
  // Group by provider for the "Top providers" rail.
  const providers = Array.from(new Map(listings.map((l) => [l.provider.id, l.provider])).values());

  const openResults = (categorySlug?: string, categoryLabel?: string) =>
    router.push({
      pathname: '/services/results',
      params: { vertical, ...(categorySlug ? { categorySlug, categoryLabel } : {}) },
    });

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={listingsQuery.isRefetching} onRefresh={() => listingsQuery.refetch()} tintColor={colors.blue} />
        }
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{config.title}</Text>
            <Text style={styles.subtitle}>{config.subtitle}</Text>
          </View>
          <View style={styles.locationChip}>
            <Ionicons name="location" size={14} color={colors.blue} />
            <Text style={styles.locationText}>Portmore, Jamaica</Text>
            <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
          </View>
        </View>

        <Pressable style={styles.searchBar} onPress={() => openResults()}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <Text style={styles.searchPlaceholder}>Search services, shops, or providers</Text>
          <Ionicons name="options-outline" size={20} color={colors.blue} />
        </Pressable>

        <LinearGradient colors={gradients.walletCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
          <Text style={styles.bannerTitle}>{config.bannerTitle}</Text>
          <Text style={styles.bannerBody}>{config.bannerBody}</Text>
          <Pressable style={styles.bannerCta} onPress={() => openResults()}>
            <Text style={styles.bannerCtaText}>{config.bannerCta}</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.blue} />
          </Pressable>
        </LinearGradient>

        {/* Category chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesRow}>
          {config.categories.map((cat) => (
            <Pressable key={cat.slug} style={styles.categoryTile} onPress={() => openResults(cat.slug, cat.label)}>
              <View style={styles.categoryIcon}>
                <Ionicons name={cat.icon} size={24} color={colors.blue} />
              </View>
              <Text style={styles.categoryLabel} numberOfLines={2}>
                {cat.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Popular services */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Popular services</Text>
          <Pressable onPress={() => openResults()}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        {listingsQuery.isError ? <ErrorState onRetry={() => listingsQuery.refetch()} /> : null}
        {listingsQuery.isLoading ? (
          <View style={styles.popularRow}>
            <Skeleton height={190} width={170} />
            <Skeleton height={190} width={170} />
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.popularRow}>
            {listings.map((listing) => (
              <Card key={listing.id} style={styles.popularCard} padded={false}>
                <Image source={{ uri: listing.imageUrl ?? undefined }} style={styles.popularImage} contentFit="cover" />
                <View style={styles.popularBody}>
                  <Text style={styles.popularTitle} numberOfLines={1}>
                    {listing.title}
                  </Text>
                  <View style={styles.popularProviderRow}>
                    <Text style={styles.popularProvider} numberOfLines={1}>
                      {listing.provider.name}
                    </Text>
                    {listing.provider.isVerified ? (
                      <Ionicons name="checkmark-circle" size={13} color={colors.blue} />
                    ) : null}
                  </View>
                  <View style={styles.popularFooter}>
                    {listing.packages[0] ? (
                      <Text style={styles.popularPrice}>
                        From <Text style={styles.popularPriceStrong}>{formatJmd(listing.packages[0].priceMinor)}</Text>
                      </Text>
                    ) : (
                      <View />
                    )}
                    <Pressable
                      style={styles.addButton}
                      onPress={() => router.push({ pathname: '/services/listing/[id]', params: { id: listing.id } })}
                    >
                      <Ionicons name="add" size={18} color={colors.blue} />
                    </Pressable>
                  </View>
                </View>
              </Card>
            ))}
          </ScrollView>
        )}

        {/* Top providers */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Top {config.resultsNoun}</Text>
          <Pressable onPress={() => openResults()}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.popularRow}>
          {providers.map((provider) => (
            <Pressable
              key={provider.id}
              style={styles.providerCard}
              onPress={() => router.push({ pathname: '/provider/[id]', params: { id: provider.id } })}
            >
              <Image source={{ uri: provider.coverUrl ?? provider.logoUrl ?? undefined }} style={styles.providerCover} contentFit="cover" />
              <View style={styles.providerRating}>
                <Ionicons name="star" size={11} color={colors.textOnBrand} />
                <Text style={styles.providerRatingText}>{provider.ratingAvg.toFixed(1)}</Text>
              </View>
              <View style={styles.providerBody}>
                <View style={styles.popularProviderRow}>
                  <Text style={styles.providerName} numberOfLines={1}>
                    {provider.name}
                  </Text>
                  {provider.isVerified ? <Ionicons name="checkmark-circle" size={14} color={colors.blue} /> : null}
                </View>
                <Text style={styles.providerMeta}>Portmore, Jamaica</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        {/* Trust footer */}
        <Card style={styles.trustCard} padded={false}>
          {(
            [
              { icon: 'shield-checkmark-outline', title: 'Verified providers', body: 'All providers are vetted for quality and reliability.' },
              { icon: 'pricetag-outline', title: 'Transparent pricing', body: 'Upfront quotes with no hidden fees.' },
              { icon: 'calendar-outline', title: 'Book on your schedule', body: 'Choose a time that works for you.' },
            ] as const
          ).map((item) => (
            <View key={item.title} style={styles.trustItem}>
              <Ionicons name={item.icon} size={22} color={colors.blue} />
              <Text style={styles.trustTitle}>{item.title}</Text>
              <Text style={styles.trustBody}>{item.body}</Text>
            </View>
          ))}
        </Card>
        <View style={styles.trustRow}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.blue} />
          <Text style={styles.trustFootnote}>Services provided by trusted third-party providers</Text>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.base },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadow.card,
  },
  locationText: { color: colors.textPrimary, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
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
  bannerTitle: { color: colors.textOnBrand, fontSize: fontSize.xl, fontWeight: fontWeight.heavy, maxWidth: '75%' },
  bannerBody: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.sm, marginTop: 4, maxWidth: '70%' },
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
  categoryTile: {
    width: 92,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: 4,
    ...shadow.card,
  },
  categoryIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  categoryLabel: { fontSize: fontSize.xs, color: colors.textPrimary, fontWeight: fontWeight.medium, textAlign: 'center' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary },
  seeAll: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  popularRow: { gap: spacing.md, paddingBottom: spacing.lg },
  popularCard: { width: 175, overflow: 'hidden' },
  popularImage: { height: 96, backgroundColor: colors.skyTint },
  popularBody: { padding: spacing.md },
  popularTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  popularProviderRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  popularProvider: { fontSize: fontSize.xs, color: colors.textSecondary, flexShrink: 1 },
  popularFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  popularPrice: { fontSize: fontSize.xs, color: colors.textSecondary },
  popularPriceStrong: { color: colors.blue, fontWeight: fontWeight.heavy, fontSize: fontSize.sm },
  addButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerCard: {
    width: 175,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.card,
  },
  providerCover: { height: 96, backgroundColor: colors.skyTint },
  providerRating: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(22,48,93,0.8)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  providerRatingText: { color: colors.textOnBrand, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  providerBody: { padding: spacing.md },
  providerName: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary, flexShrink: 1 },
  providerMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  trustCard: { flexDirection: 'row', padding: spacing.base, gap: spacing.sm, marginBottom: spacing.md },
  trustItem: { flex: 1, alignItems: 'center', gap: 4 },
  trustTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textPrimary, textAlign: 'center' },
  trustBody: { fontSize: 10, color: colors.textSecondary, textAlign: 'center', lineHeight: 14 },
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  trustFootnote: { color: colors.textSecondary, fontSize: fontSize.xs },
});
