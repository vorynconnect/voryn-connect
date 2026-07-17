import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { ServiceListing } from '@/lib/types';

/** Builds the "Available times" slots shown on the mockups (today + tomorrow). */
function buildSlots(): Array<{ day: string; times: string[] }> {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-JM', { month: 'short', day: 'numeric' });
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
  return [
    { day: `Today, ${fmt(today)}`, times: ['11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM'] },
    { day: `Tomorrow, ${fmt(tomorrow)}`, times: ['10:00 AM', '12:00 PM', '2:00 PM', '4:00 PM'] },
  ];
}

const TAG_ICONS: Array<keyof typeof Ionicons.glyphMap> = [
  'water-outline',
  'shield-checkmark-outline',
  'time-outline',
  'car-outline',
];

export default function ServiceListingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const listingQuery = useQuery({
    queryKey: ['listing', id],
    // Listing detail comes via the vertical listings endpoint filtered client-side;
    // a provider's full profile also embeds it, but this keeps one source.
    queryFn: async () => {
      const all = await api<{ listings: ServiceListing[] }>('/v1/discovery/service-listings?limit=50');
      const listing = all.listings.find((l) => l.id === id);
      if (!listing) throw new Error('Listing not found');
      return listing;
    },
  });

  const listing = listingQuery.data;
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ day: string; time: string } | null>(null);
  const slots = useMemo(buildSlots, []);

  if (listingQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading service…" />
      </View>
    );
  }
  if (listingQuery.isError || !listing) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => listingQuery.refetch()} />
      </View>
    );
  }

  const pkg =
    listing.packages.find((p) => p.id === selectedPackage) ??
    listing.packages.find((p) => p.isPopular) ??
    listing.packages[0];

  const durationTag = `${listing.durationMinutes} min`;
  const tags = [...listing.tags.slice(0, 2), durationTag, ...(listing.supportsMobile ? ['Mobile Available'] : [])];

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        {/* Provider header */}
        <Card padded={false} style={styles.providerCard}>
          <Image source={{ uri: listing.provider.coverUrl ?? listing.imageUrl ?? undefined }} style={styles.cover} contentFit="cover" />
          <View style={styles.providerRow}>
            <Image source={{ uri: listing.provider.logoUrl ?? undefined }} style={styles.logo} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.providerName}>{listing.provider.name}</Text>
                {listing.provider.isVerified ? (
                  <View style={styles.verifiedBadge}>
                    <Ionicons name="shield-checkmark" size={11} color={colors.blue} />
                    <Text style={styles.verifiedText}>Verified Provider</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.metaRow}>
                <Ionicons name="star" size={13} color={colors.star} />
                <Text style={styles.metaStrong}>{listing.provider.ratingAvg.toFixed(1)}</Text>
                <Text style={styles.metaText}>({listing.provider.ratingCount} reviews)</Text>
                <Text style={styles.metaDot}>|</Text>
                <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                <Text style={styles.metaText}>Portmore, Jamaica</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Listing title */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>{listing.title}</Text>
          <View style={styles.reviewChip}>
            <Ionicons name="star" size={13} color={colors.star} />
            <Text style={styles.reviewChipText}>
              {listing.provider.ratingAvg.toFixed(1)} ({listing.provider.ratingCount} reviews)
            </Text>
          </View>
        </View>
        {listing.description ? <Text style={styles.description}>{listing.description}</Text> : null}

        <View style={styles.tagsRow}>
          {tags.map((tag, i) => (
            <View key={tag} style={styles.tagPill}>
              <Ionicons name={TAG_ICONS[i % TAG_ICONS.length]!} size={14} color={colors.blue} />
              <Text style={styles.tagPillText}>{tag}</Text>
            </View>
          ))}
        </View>

        {/* Packages */}
        <Text style={styles.sectionTitle}>Choose a package</Text>
        {listing.packages.map((p) => {
          const active = p.id === pkg?.id;
          return (
            <Pressable
              key={p.id}
              style={[styles.packageCard, active && styles.packageActive]}
              onPress={() => setSelectedPackage(p.id)}
            >
              <View style={styles.packageIcon}>
                <Ionicons name={active ? 'water' : 'water-outline'} size={22} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.packageName}>{p.name}</Text>
                {p.description ? <Text style={styles.packageDesc}>{p.description}</Text> : null}
                {p.isPopular ? (
                  <View style={styles.popularBadge}>
                    <Text style={styles.popularBadgeText}>Most popular</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.packagePrice}>{formatJmd(p.priceMinor)}</Text>
              <View style={[styles.radio, active && styles.radioActive]}>
                {active ? <View style={styles.radioDot} /> : null}
              </View>
            </Pressable>
          );
        })}

        {/* Included + times */}
        <View style={styles.splitRow}>
          <Card style={styles.includedCard}>
            <Text style={styles.splitTitle}>What’s included</Text>
            {(pkg?.includedItems ?? []).map((item) => (
              <View key={item} style={styles.includedRow}>
                <Ionicons name="checkmark-circle" size={17} color={colors.blue} />
                <Text style={styles.includedText}>{item}</Text>
              </View>
            ))}
          </Card>
          <Card style={styles.timesCard}>
            <Text style={styles.splitTitle}>Available times</Text>
            {slots.map((slot) => (
              <View key={slot.day} style={{ marginBottom: spacing.sm }}>
                <View style={styles.dayRow}>
                  <Ionicons name="calendar-outline" size={14} color={colors.textPrimary} />
                  <Text style={styles.dayLabel}>{slot.day}</Text>
                </View>
                <View style={styles.timesRow}>
                  {slot.times.map((time) => {
                    const active = selectedSlot?.day === slot.day && selectedSlot.time === time;
                    return (
                      <Pressable
                        key={time}
                        style={[styles.timePill, active && styles.timePillActive]}
                        onPress={() => setSelectedSlot({ day: slot.day, time })}
                      >
                        <Text style={[styles.timeText, active && styles.timeTextActive]}>{time}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </Card>
        </View>

        <View style={styles.noticeRow}>
          <Ionicons name="information-circle-outline" size={18} color={colors.blue} />
          <Text style={styles.noticeText}>This is a third-party provider. Services and pricing are set by the provider.</Text>
        </View>

        <GradientButton
          title="Continue booking"
          icon="calendar-outline"
          disabled={!pkg || !selectedSlot}
          onPress={() =>
            pkg && selectedSlot
              ? router.push({
                  pathname: '/services/book',
                  params: {
                    listingId: listing.id,
                    packageId: pkg.id,
                    day: selectedSlot.day,
                    time: selectedSlot.time,
                  },
                })
              : undefined
          }
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  providerCard: { overflow: 'hidden', marginBottom: spacing.base },
  cover: { height: 150, backgroundColor: colors.skyTint },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  logo: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.skyTint },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  providerName: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  verifiedText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  metaStrong: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  metaText: { fontSize: fontSize.sm, color: colors.textSecondary },
  metaDot: { color: colors.textMuted },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  reviewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadow.card,
  },
  reviewChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  description: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 21 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.base },
  tagPill: {
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
  tagPillText: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  packageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  packageActive: { borderColor: colors.blue, backgroundColor: '#F4F9FF' },
  packageIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  packageName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  packageDesc: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  popularBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: 4,
  },
  popularBadgeText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  packagePrice: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.blue },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.blue },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.blue },
  splitRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, marginBottom: spacing.base },
  includedCard: { flex: 1 },
  timesCard: { flex: 1.2 },
  splitTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  includedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: spacing.sm },
  includedText: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 19 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  dayLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  timesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  timePill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  timePillActive: { borderColor: colors.blue, backgroundColor: colors.skyTint },
  timeText: { fontSize: fontSize.sm, color: colors.textPrimary },
  timeTextActive: { color: colors.blue, fontWeight: fontWeight.bold },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.skyTint,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.base,
  },
  noticeText: { flex: 1, color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 },
});
