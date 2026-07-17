import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { ServiceListing, WalletSnapshot } from '@/lib/types';
import { VERTICALS, type Vertical } from '@/features/services/config';
import { BookingDetailsSection, type BookingDetails } from '@/features/services/BookingDetailsSection';

const CONVENIENCE_FEE_MINOR = 15000;
const GCT_PERCENT = 15;

function nextDateForSlot(day: string, time: string): Date {
  const base = new Date();
  if (day.startsWith('Tomorrow')) base.setDate(base.getDate() + 1);
  const match = /(\d+):(\d+)\s*(AM|PM)/i.exec(time);
  if (match) {
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (/pm/i.test(match[3]!) && hours < 12) hours += 12;
    if (/am/i.test(match[3]!) && hours === 12) hours = 0;
    base.setHours(hours, minutes, 0, 0);
  }
  return base;
}

/** Booking checkout — "Book Auto Care / Book Technician / Book Home Service". */
export default function BookServiceScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ listingId: string; packageId: string; day: string; time: string }>();

  const listingQuery = useQuery({
    queryKey: ['listing', params.listingId],
    queryFn: async () => {
      const all = await api<{ listings: ServiceListing[] }>('/v1/discovery/service-listings?limit=50');
      const listing = all.listings.find((l) => l.id === params.listingId);
      if (!listing) throw new Error('Listing not found');
      return listing;
    },
  });
  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSnapshot>('/v1/wallet') });
  const addressesQuery = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api<{ addresses: Array<{ id: string; name: string; line1: string }> }>('/v1/users/me/addresses'),
  });

  const [locationType, setLocationType] = useState<'AT_PROVIDER' | 'MOBILE'>('AT_PROVIDER');
  const [payment, setPayment] = useState<'VORYN_WALLET' | 'CARD' | 'CASH'>('VORYN_WALLET');
  const [details, setDetails] = useState<BookingDetails>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => `booking-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);

  const listing = listingQuery.data;
  const pkg = listing?.packages.find((p) => p.id === params.packageId);
  const config = listing ? VERTICALS[listing.category.vertical as Vertical] : null;

  // Home services default to "At your home" per the mockup.
  useEffect(() => {
    if (listing?.category.vertical === 'HOME_SERVICES' && listing.supportsMobile) {
      setLocationType('MOBILE');
    }
  }, [listing?.id]);

  if (listingQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Preparing your booking…" />
      </View>
    );
  }
  if (listingQuery.isError || !listing || !pkg || !config) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => listingQuery.refetch()} />
      </View>
    );
  }

  const mobileFee = locationType === 'MOBILE' ? listing.mobileFeeMinor : 0;
  const taxMinor = Math.round(((pkg.priceMinor + CONVENIENCE_FEE_MINOR + mobileFee) * GCT_PERCENT) / 100);
  const totalMinor = pkg.priceMinor + CONVENIENCE_FEE_MINOR + mobileFee + taxMinor;
  const walletBalance = walletQuery.data?.wallet.balanceMinor ?? 0;
  const insufficientWallet = payment === 'VORYN_WALLET' && walletBalance < totalMinor;
  const defaultAddress = addressesQuery.data?.addresses[0];

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const scheduledAt = nextDateForSlot(params.day ?? 'Today', params.time ?? '10:00 AM');
      const result = await api<{ booking: { id: string } }>('/v1/bookings', {
        method: 'POST',
        body: {
          packageId: pkg.id,
          locationType,
          scheduledAt: scheduledAt.toISOString(),
          paymentMethodType: payment,
          ...(locationType === 'MOBILE' && defaultAddress ? { addressId: defaultAddress.id } : {}),
          ...(details.customerVehicleId ? { customerVehicleId: details.customerVehicleId } : {}),
          ...(details.deviceDescription?.trim() ? { deviceDescription: details.deviceDescription.trim() } : {}),
          ...(details.issueDescription?.trim() ? { issueDescription: details.issueDescription.trim() } : {}),
          idempotencyKey,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['orders-feed'] });
      await queryClient.invalidateQueries({ queryKey: ['wallet'] });
      router.replace({ pathname: '/bookings/tracking/[bookingId]', params: { bookingId: result.booking.id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete your booking.');
    } finally {
      setSubmitting(false);
    }
  };

  const isHome = listing.category.vertical === 'HOME_SERVICES';
  const heading =
    listing.category.vertical === 'AUTO_CARE'
      ? 'Book Auto Care'
      : listing.category.vertical === 'TECHNICIAN'
        ? 'Book Technician'
        : 'Book Home Service';

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{heading}</Text>
        <Text style={styles.subtitle}>Review your booking details and confirm.</Text>

        {/* Summary card */}
        <Card style={styles.summaryCard}>
          <View style={styles.summaryHead}>
            <Image source={{ uri: listing.provider.logoUrl ?? undefined }} style={styles.summaryLogo} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <View style={styles.summaryNameRow}>
                <Text style={styles.summaryProvider}>{listing.provider.name}</Text>
                <Ionicons name="checkmark-circle" size={16} color={colors.blue} />
                <View style={styles.topRatedBadge}>
                  <Text style={styles.topRatedText}>Top Rated Provider</Text>
                </View>
              </View>
              <Text style={styles.summaryPackage}>{pkg.name}</Text>
              <View style={styles.summaryMetaRow}>
                <Ionicons name="calendar-outline" size={14} color={colors.blue} />
                <Text style={styles.summaryMeta}>
                  {params.day} • {params.time}
                </Text>
              </View>
              <View style={styles.summaryMetaRow}>
                <Ionicons name="timer-outline" size={14} color={colors.blue} />
                <Text style={styles.summaryMeta}>Estimated duration: {listing.durationMinutes} min</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Vertical-specific details: vehicle for auto care, device + issue for technicians */}
        <BookingDetailsSection vertical={listing.category.vertical as Vertical} value={details} onChange={setDetails} />

        {/* Service location */}
        <Text style={styles.sectionTitle}>
          {listing.category.vertical === 'HOME_SERVICES' ? 'Where should we provide the service?' : 'Service location'}
        </Text>
        <View style={[styles.locationRow, isHome && { flexDirection: 'row-reverse' }]}>
          {listing.supportsAtShop ? (
            <Pressable
              style={[styles.locationOption, locationType === 'AT_PROVIDER' && styles.locationActive]}
              onPress={() => setLocationType('AT_PROVIDER')}
            >
              <View style={[styles.radio, locationType === 'AT_PROVIDER' && styles.radioActive]}>
                {locationType === 'AT_PROVIDER' ? <View style={styles.radioDot} /> : null}
              </View>
              <View style={styles.locationIcon}>
                <Ionicons name="storefront-outline" size={20} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.locationTitle}>At provider shop</Text>
                <Text style={styles.locationBody}>{isHome ? 'Visit their location' : `Visit ${listing.provider.name}`}</Text>
              </View>
            </Pressable>
          ) : null}
          {listing.supportsMobile ? (
            <Pressable
              style={[styles.locationOption, locationType === 'MOBILE' && styles.locationActive]}
              onPress={() => setLocationType('MOBILE')}
            >
              <View style={[styles.radio, locationType === 'MOBILE' && styles.radioActive]}>
                {locationType === 'MOBILE' ? <View style={styles.radioDot} /> : null}
              </View>
              <View style={styles.locationIcon}>
                <Ionicons name={isHome ? 'home-outline' : 'car-outline'} size={20} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.locationTitle}>{isHome ? 'At your home' : 'Mobile service'}</Text>
                <Text style={styles.locationBody}>
                  We come to you{listing.mobileFeeMinor > 0 ? ` • +${formatJmd(listing.mobileFeeMinor)}` : ''}
                </Text>
              </View>
            </Pressable>
          ) : null}
        </View>
        {locationType === 'MOBILE' ? (
          <Pressable style={styles.addressRow} onPress={() => router.push('/profile-pages/addresses')}>
            <Ionicons name="location-outline" size={18} color={colors.blue} />
            <Text style={styles.addressText}>
              {defaultAddress ? `${defaultAddress.name} • ${defaultAddress.line1}` : 'Add a service address'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>
        ) : null}

        {/* Payment method */}
        <Text style={styles.sectionTitle}>Payment method</Text>
        <View style={styles.paymentRow}>
          {(
            [
              { key: 'VORYN_WALLET', title: 'Voryn Wallet', body: `Balance: ${formatJmd(walletBalance)}`, icon: 'wallet-outline' },
              { key: 'CARD', title: 'Credit/Debit Card', body: 'Visa, Mastercard', icon: 'card-outline' },
              { key: 'CASH', title: 'Cash at shop', body: 'Pay on arrival', icon: 'cash-outline' },
            ] as const
          ).map((method) => {
            const active = payment === method.key;
            return (
              <Pressable
                key={method.key}
                style={[styles.paymentOption, active && styles.locationActive]}
                onPress={() => setPayment(method.key)}
              >
                <Ionicons name={method.icon} size={20} color={colors.blue} />
                <Text style={styles.paymentTitle} numberOfLines={1}>
                  {method.title}
                </Text>
                <Text style={styles.paymentBody} numberOfLines={1}>
                  {method.body}
                </Text>
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        {insufficientWallet ? (
          <View style={styles.warnRow}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.warnText}>
              Insufficient wallet balance. Top up or choose another payment method.
            </Text>
          </View>
        ) : null}

        {/* Fare breakdown */}
        <Card style={styles.fareCard}>
          <Text style={styles.fareTitle}>Fare breakdown</Text>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>{pkg.name}</Text>
            <Text style={styles.fareValue}>{formatJmd(pkg.priceMinor)}</Text>
          </View>
          {mobileFee > 0 ? (
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Mobile service fee</Text>
              <Text style={styles.fareValue}>{formatJmd(mobileFee)}</Text>
            </View>
          ) : null}
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Convenience fee</Text>
            <Text style={styles.fareValue}>{formatJmd(CONVENIENCE_FEE_MINOR)}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Tax (GCT {GCT_PERCENT}%)</Text>
            <Text style={styles.fareValue}>{formatJmd(taxMinor)}</Text>
          </View>
          <View style={styles.fareTotalRow}>
            <View style={styles.fareTotalLabelRow}>
              <Text style={styles.fareTotalLabel}>Total</Text>
              <Ionicons name="shield-checkmark-outline" size={15} color={colors.blue} />
              <Text style={styles.fareCurrency}>Prices in JMD</Text>
            </View>
            <Text style={styles.fareTotal}>{formatJmd(totalMinor)}</Text>
          </View>
        </Card>

        <View style={styles.secureRow}>
          <View style={styles.secureItem}>
            <Ionicons name="lock-closed-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.secureText}>Secure payments</Text>
          </View>
          <View style={styles.secureItem}>
            <Ionicons name="shield-checkmark-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.secureText}>Trusted third-party provider</Text>
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <GradientButton
          title="Confirm booking"
          trailingText={formatJmd(totalMinor)}
          icon="lock-closed-outline"
          loading={submitting}
          disabled={insufficientWallet}
          onPress={confirm}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  summaryCard: { marginBottom: spacing.lg },
  summaryHead: { flexDirection: 'row', gap: spacing.md },
  summaryLogo: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.skyTint },
  summaryNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  summaryProvider: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  topRatedBadge: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  topRatedText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  summaryPackage: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 2 },
  summaryMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  summaryMeta: { fontSize: fontSize.sm, color: colors.textSecondary },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  locationRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  locationOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  locationActive: { borderColor: colors.blue, backgroundColor: '#F4F9FF' },
  locationIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  locationBody: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  addressText: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
  paymentRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  paymentOption: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  paymentTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  paymentBody: { fontSize: fontSize.xs, color: colors.textSecondary },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.dangerTint,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  warnText: { flex: 1, color: colors.danger, fontSize: fontSize.sm },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.blue },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  fareCard: { marginTop: spacing.sm, marginBottom: spacing.base },
  fareTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  fareLabel: { fontSize: fontSize.base, color: colors.textSecondary },
  fareValue: { fontSize: fontSize.base, color: colors.textPrimary },
  fareTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
  },
  fareTotalLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fareTotalLabel: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  fareCurrency: { fontSize: fontSize.xs, color: colors.textSecondary },
  fareTotal: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.blue },
  secureRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginBottom: spacing.base },
  secureItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  secureText: { fontSize: fontSize.xs, color: colors.textSecondary },
  errorText: { color: colors.danger, textAlign: 'center', marginBottom: spacing.md, fontSize: fontSize.sm },
});
