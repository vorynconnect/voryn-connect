import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import { MIN_TIP_MINOR, TipSelector } from '@/features/tips/TipSelector';
import type { WalletSnapshot } from '@/lib/types';

type Address = { id: string; name: string; line1: string; instructions: string | null; isDefault: boolean };

type DeliveryQuote = {
  quote: {
    // Signed quote id — passed back at checkout so the fee the customer
    // confirmed is exactly the fee charged (the app never recomputes it).
    deliveryQuoteId: string | null;
    deliveryQuoteExpiresAt: string | null;
    addressId: string | null;
    merchantName: string;
    distanceKm: number | null;
    baseFeeMinor: number;
    distanceFeeMinor: number;
    deliveryFeeMinor: number;
    subtotalMinor: number;
    serviceFeeMinor: number;
    taxMinor: number;
    discountMinor: number;
    totalBeforeTipMinor: number;
    etaMinMinutes: number;
    etaMaxMinutes: number;
    outOfZone: boolean;
    maxDeliveryKm: number;
    courierPayMinor: number;
    points: {
      pointsBalance: number;
      pointsValueMinor: number;
      maxPoints: number;
      maxMinor: number;
      pointValueMinor: number;
      maxPercent: number;
      minOrderMinor: number;
      minRedemptionPoints: number;
      incrementPoints: number;
      /** Which rule held the redemption down, so we can explain it. */
      limitedBy: string;
      reason: string;
      tier: string;
      earnRateLabel: string;
    };
  };
};

const OUT_OF_ZONE_MESSAGE =
  'This location is currently outside the delivery area. Choose pickup or another address.';

export default function CheckoutScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [payment, setPayment] = useState<'VORYN_WALLET' | 'CARD' | 'CASH'>('VORYN_WALLET');
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [tipMinor, setTipMinor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);

  const addressesQuery = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api<{ addresses: Address[] }>('/v1/users/me/addresses'),
  });
  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSnapshot>('/v1/wallet') });

  const addresses = addressesQuery.data?.addresses ?? [];
  const selectedAddress = addresses.find((a) => a.id === addressId) ?? addresses.find((a) => a.isDefault) ?? addresses[0];

  // Distance-priced quote for the selected address — the same math checkout charges.
  const quoteQuery = useQuery({
    queryKey: ['delivery-quote', selectedAddress?.id],
    queryFn: () => api<DeliveryQuote>(`/v1/orders/quote?addressId=${selectedAddress!.id}`),
    enabled: Boolean(selectedAddress),
  });

  if (addressesQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Preparing checkout…" />
      </View>
    );
  }
  if (addressesQuery.isError) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => addressesQuery.refetch()} />
      </View>
    );
  }

  const walletBalance = walletQuery.data?.wallet.balanceMinor ?? 0;
  const quote = quoteQuery.data?.quote;
  // The rewards engine decides the cap for this specific order and tells us
  // which rule bound it, so we can say why rather than silently offering less.
  const points = quote?.points.pointsBalance ?? walletQuery.data?.loyalty.pointsBalance ?? 0;
  const redeemablePoints = quote?.points.maxPoints ?? 0;
  const pointsDiscountMinor = redeemPoints ? (quote?.points.maxMinor ?? 0) : 0;
  const totalMinor = quote ? Math.max(0, quote.totalBeforeTipMinor - pointsDiscountMinor) + tipMinor : null;

  const placeOrder = async () => {
    if (!selectedAddress) {
      setError('Add a delivery address first.');
      return;
    }
    if (quote?.outOfZone) {
      setError(OUT_OF_ZONE_MESSAGE);
      return;
    }
    if (tipMinor > 0 && tipMinor < MIN_TIP_MINOR) {
      setError('Tips start at JMD 10 — bump it up or choose “No tip”.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api<{ order: { id: string } }>('/v1/orders/checkout', {
        method: 'POST',
        body: {
          addressId: selectedAddress.id,
          paymentMethodType: payment,
          tipMinor,
          pointsToRedeem: redeemPoints ? redeemablePoints : 0,
          deliveryQuoteId: quote?.deliveryQuoteId ?? undefined,
          idempotencyKey,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cart'] }),
        queryClient.invalidateQueries({ queryKey: ['orders-feed'] }),
        queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      ]);
      router.replace({ pathname: '/delivery/tracking/[orderId]', params: { orderId: result.order.id } });
    } catch (err) {
      // The signed fee is only good for ~10 minutes; if it lapsed, refresh the
      // quote so the customer confirms the current price.
      if (err instanceof ApiError && err.code === 'QUOTE_EXPIRED') {
        await quoteQuery.refetch();
        setError('The delivery price was refreshed. Please review and place your order again.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not place your order.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Checkout</Text>
        <Text style={styles.subtitle}>Review your order and delivery details.</Text>

        {/* Delivery address */}
        <Card style={styles.addressCard}>
          <View style={styles.addressRow}>
            <View style={styles.addressIcon}>
              <Ionicons name="home" size={22} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.addressLabel}>Delivery address</Text>
              {selectedAddress ? (
                <Text style={styles.addressValue}>
                  {selectedAddress.name} • {selectedAddress.line1}
                </Text>
              ) : (
                <Text style={styles.addressValue}>No address yet</Text>
              )}
              {selectedAddress?.instructions ? (
                <View style={styles.instructionsBadge}>
                  <Text style={styles.instructionsText}>Drop-off instructions: {selectedAddress.instructions}</Text>
                </View>
              ) : null}
            </View>
            <Pressable style={styles.changeButton} onPress={() => router.push('/profile-pages/addresses')}>
              <Text style={styles.changeButtonText}>Change</Text>
            </Pressable>
          </View>
        </Card>

        {quote?.outOfZone ? (
          <Card style={styles.zoneCard}>
            <Ionicons name="alert-circle" size={20} color={colors.danger} />
            <Text style={styles.zoneText}>{OUT_OF_ZONE_MESSAGE}</Text>
          </Card>
        ) : null}

        {/* ETA + distance-based delivery fee */}
        <Card style={styles.etaCard}>
          <View style={styles.addressIcon}>
            <Ionicons name="time-outline" size={22} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.addressLabel}>Estimated arrival</Text>
            <Text style={styles.etaValue}>
              {quote ? `${quote.etaMinMinutes}–${quote.etaMaxMinutes} min` : '20–30 min'}
            </Text>
            <Text style={styles.etaSub}>
              {quote?.distanceKm != null
                ? `${quote.distanceKm.toFixed(1)} km from ${quote.merchantName} • delivery fee ${formatJmd(quote.deliveryFeeMinor)}`
                : 'Final ETA confirmed once the provider accepts your order.'}
            </Text>
          </View>
        </Card>

        {/* Payment methods */}
        <Text style={styles.sectionTitle}>Payment method</Text>
        <Card padded={false} style={styles.paymentCard}>
          {(
            [
              {
                key: 'VORYN_WALLET',
                title: 'Voryn Wallet',
                body: `Available balance: ${formatJmd(walletBalance)}`,
                icon: 'wallet',
                recommended: true,
              },
              { key: 'CARD', title: 'Credit / Debit Card', body: 'Sandbox card', icon: 'card' },
              { key: 'CASH', title: 'Cash on Delivery', body: 'Pay with cash when your order arrives', icon: 'cash' },
            ] as const
          ).map((method, i, arr) => {
            const active = payment === method.key;
            return (
              <Pressable
                key={method.key}
                style={[
                  styles.paymentRow,
                  i < arr.length - 1 && styles.paymentBorder,
                  active && styles.paymentActive,
                ]}
                onPress={() => setPayment(method.key)}
              >
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
                <View style={styles.paymentIcon}>
                  <Ionicons name={method.icon} size={20} color={colors.blue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentTitle}>{method.title}</Text>
                  <Text style={styles.paymentBody}>{method.body}</Text>
                </View>
                {'recommended' in method && method.recommended ? (
                  <View style={styles.recommendedBadge}>
                    <Text style={styles.recommendedText}>Recommended</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </Card>

        {/* Points + promo */}
        <Card padded={false} style={styles.paymentCard}>
          <View style={[styles.paymentRow, styles.paymentBorder]}>
            <View style={styles.paymentIcon}>
              <Ionicons name="star" size={19} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentTitle}>Voryn Points</Text>
              {quote ? (
                <>
                  <View style={styles.pointsLine}>
                    <Text style={styles.paymentBody}>Available</Text>
                    <Text style={styles.pointsLineValue}>
                      {points.toLocaleString()} pts · {formatJmd(quote.points.pointsValueMinor)}
                    </Text>
                  </View>
                  {redeemablePoints > 0 ? (
                    <>
                      <View style={styles.pointsLine}>
                        <Text style={styles.paymentBody}>Usable on this order</Text>
                        <Text style={styles.pointsLineValue}>
                          {redeemablePoints.toLocaleString()} pts
                        </Text>
                      </View>
                      <View style={styles.pointsLine}>
                        <Text style={styles.paymentBody}>Discount</Text>
                        <Text style={[styles.pointsLineValue, { color: colors.success }]}>
                          {formatJmd(quote.points.maxMinor)}
                        </Text>
                      </View>
                    </>
                  ) : null}
                  {quote.points.reason && quote.points.limitedBy !== 'BALANCE' ? (
                    <Text style={styles.pointsNote}>{quote.points.reason}</Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.paymentBody}>{points.toLocaleString()} points</Text>
              )}
            </View>
            <Switch
              value={redeemPoints}
              onValueChange={setRedeemPoints}
              disabled={redeemablePoints <= 0}
              trackColor={{ true: colors.blue, false: colors.border }}
            />
          </View>
          <Pressable style={styles.paymentRow} onPress={() => router.push('/delivery/cart')}>
            <View style={styles.paymentIcon}>
              <Ionicons name="pricetag" size={19} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentTitle}>Promo code</Text>
              <Text style={styles.paymentBody}>Enter code to get discounts</Text>
            </View>
            <Text style={styles.addCode}>Add code</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>
        </Card>

        {/* Tip the delivery person */}
        <Text style={styles.sectionTitle}>Tip your delivery person</Text>
        <Card style={styles.tipCard}>
          <View style={styles.tipHeadRow}>
            <View style={styles.paymentIcon}>
              <Ionicons name="heart" size={19} color={colors.blue} />
            </View>
            <Text style={styles.tipNote}>100% of your tip goes to the person delivering your order.</Text>
          </View>
          <TipSelector valueMinor={tipMinor} onChange={setTipMinor} />
        </Card>

        {/* Order summary */}
        <Text style={styles.sectionTitle}>Order summary</Text>
        <Card style={styles.summaryCard}>
          {quote ? (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal</Text>
                <Text style={styles.summaryValue}>{formatJmd(quote.subtotalMinor)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  Delivery fee{quote.distanceKm != null ? ` (${quote.distanceKm.toFixed(1)} km)` : ''}
                </Text>
                <Text style={styles.summaryValue}>{formatJmd(quote.deliveryFeeMinor)}</Text>
              </View>
              {quote.serviceFeeMinor > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Service fee</Text>
                  <Text style={styles.summaryValue}>{formatJmd(quote.serviceFeeMinor)}</Text>
                </View>
              ) : null}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Estimated taxes</Text>
                <Text style={styles.summaryValue}>{formatJmd(quote.taxMinor)}</Text>
              </View>
              {quote.discountMinor > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.success }]}>Promo discount</Text>
                  <Text style={[styles.summaryValue, { color: colors.success }]}>
                    −{formatJmd(quote.discountMinor)}
                  </Text>
                </View>
              ) : null}
              {pointsDiscountMinor > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.success }]}>Points redeemed</Text>
                  <Text style={[styles.summaryValue, { color: colors.success }]}>
                    −{formatJmd(pointsDiscountMinor)}
                  </Text>
                </View>
              ) : null}
              {tipMinor > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Tip</Text>
                  <Text style={styles.summaryValue}>{formatJmd(tipMinor)}</Text>
                </View>
              ) : null}
              <View style={styles.summaryTotalRow}>
                <Text style={styles.summaryTotalLabel}>Total</Text>
                <Text style={styles.summaryTotal}>{totalMinor != null ? formatJmd(totalMinor) : '—'}</Text>
              </View>
            </>
          ) : (
            <Text style={styles.summaryLabel}>
              {quoteQuery.isLoading ? 'Calculating your total…' : 'Select a delivery address to see your total.'}
            </Text>
          )}
        </Card>

        <View style={styles.secureRows}>
          <View style={styles.secureRow}>
            <Ionicons name="shield-checkmark" size={17} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.secureTitle}>Secure payments</Text>
              <Text style={styles.secureBody}>Your payment is protected with 256-bit encryption.</Text>
            </View>
          </View>
          <View style={styles.secureRow}>
            <Ionicons name="shield-checkmark-outline" size={17} color={colors.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.secureTitle}>Trusted third-party providers</Text>
              <Text style={styles.secureBody}>Your order will be fulfilled by trusted providers in your area.</Text>
            </View>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GradientButton
          title="Place order"
          trailingText={totalMinor != null ? formatJmd(totalMinor) : undefined}
          onPress={placeOrder}
          loading={submitting}
          disabled={quote?.outOfZone === true}
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
  addressCard: { marginBottom: spacing.md },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  addressIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  addressValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 2 },
  instructionsBadge: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  instructionsText: { fontSize: fontSize.xs, color: colors.textSecondary },
  changeButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  changeButtonText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  zoneCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.base,
    backgroundColor: '#FFF3F2',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  zoneText: { flex: 1, color: colors.danger, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  etaCard: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', marginBottom: spacing.base },
  etaValue: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 2 },
  etaSub: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  paymentCard: { marginBottom: spacing.md },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  paymentBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  paymentActive: { backgroundColor: '#F4F9FF' },
  paymentIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  paymentBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  pointsNote: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 3, fontStyle: 'italic' },
  pointsLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  pointsLineValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  recommendedBadge: {
    backgroundColor: colors.successTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  recommendedText: { color: colors.success, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  addCode: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  tipCard: { marginBottom: spacing.md },
  tipHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  tipNote: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  summaryCard: { marginBottom: spacing.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  summaryLabel: { fontSize: fontSize.base, color: colors.textSecondary },
  summaryValue: { fontSize: fontSize.base, color: colors.textPrimary },
  summaryTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
  },
  summaryTotalLabel: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  summaryTotal: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.blue },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.blue },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.blue },
  secureRows: { gap: spacing.sm, marginBottom: spacing.base },
  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.skyTint,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  secureTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  secureBody: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  error: { color: colors.danger, textAlign: 'center', marginBottom: spacing.md },
});
