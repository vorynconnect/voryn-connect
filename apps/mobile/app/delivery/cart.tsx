import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmd } from '@/lib/format';

type CartItem = {
  id: string;
  name: string;
  imageUrl: string | null;
  unitPriceMinor: number;
  quantity: number;
  optionsJson: Array<{ group: string; name: string }>;
  notes: string | null;
};

type CartData = {
  cart: {
    id: string;
    restaurantId: string | null;
    storeId: string | null;
    items: CartItem[];
    promoCode: { code: string; type: string; value: number } | null;
    deliveryFeeMinor: number | null;
    distanceKm: number | null;
  } | null;
};

const FALLBACK_DELIVERY_FEE_MINOR = 20000;

const SERVICE_FEE_MINOR = 15000;
const TAX_PERCENT = 10;

export default function CartScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [promoInput, setPromoInput] = useState('');
  const [promoError, setPromoError] = useState<string | null>(null);

  const cartQuery = useQuery({ queryKey: ['cart'], queryFn: () => api<CartData>('/v1/carts') });

  const updateQuantity = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      api(`/v1/carts/items/${itemId}`, { method: 'PATCH', body: { quantity } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart'] }),
  });
  const removeItem = useMutation({
    mutationFn: (itemId: string) => api(`/v1/carts/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart'] }),
  });
  const applyPromo = useMutation({
    mutationFn: (code: string) => api('/v1/carts/promo-code', { method: 'POST', body: { code } }),
    onSuccess: () => {
      setPromoError(null);
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
    onError: (err) => setPromoError(err instanceof ApiError ? err.message : 'Invalid promo code'),
  });

  if (cartQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading your cart…" />
      </View>
    );
  }
  if (cartQuery.isError) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => cartQuery.refetch()} />
      </View>
    );
  }

  const cart = cartQuery.data?.cart;
  const items = cart?.items ?? [];

  if (!cart || items.length === 0) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <Text style={styles.title}>Your cart</Text>
        <EmptyState
          icon="cart-outline"
          title="Your cart is empty"
          body="Browse nearby restaurants and stores to add items."
        />
        <View style={{ paddingHorizontal: spacing.lg }}>
          <GradientButton title="Explore delivery" onPress={() => router.replace('/delivery')} />
        </View>
      </View>
    );
  }

  const subtotalMinor = items.reduce((sum, i) => sum + i.unitPriceMinor * i.quantity, 0);
  // Real provider fee from the cart API; fall back only if it's somehow missing.
  const deliveryFeeMinor = cart.deliveryFeeMinor ?? FALLBACK_DELIVERY_FEE_MINOR;
  const taxMinor = Math.round((subtotalMinor * TAX_PERCENT) / 100);
  let discountMinor = 0;
  if (cart.promoCode) {
    if (cart.promoCode.type === 'PERCENT_OFF') discountMinor = Math.round((subtotalMinor * cart.promoCode.value) / 100);
    else if (cart.promoCode.type === 'AMOUNT_OFF') discountMinor = cart.promoCode.value;
    else if (cart.promoCode.type === 'FREE_DELIVERY') discountMinor = deliveryFeeMinor;
  }
  const totalMinor = Math.max(0, subtotalMinor + deliveryFeeMinor + SERVICE_FEE_MINOR + taxMinor - discountMinor);

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Your cart</Text>
        <View style={styles.merchantRow}>
          <Ionicons name="shield-checkmark-outline" size={15} color={colors.blue} />
          <Text style={styles.merchantNote}>Delivery from a third-party provider</Text>
        </View>

        {items.map((item) => (
          <Card key={item.id} padded={false} style={styles.itemCard}>
            <View style={styles.itemRow}>
              <Image source={{ uri: item.imageUrl ?? undefined }} style={styles.itemImage} contentFit="cover" />
              <View style={styles.itemBody}>
                <View style={styles.itemTitleRow}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Pressable onPress={() => removeItem.mutate(item.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={19} color={colors.textSecondary} />
                  </Pressable>
                </View>
                {item.optionsJson.length > 0 ? (
                  <View style={styles.optionBadge}>
                    <Text style={styles.optionBadgeText}>
                      {item.optionsJson.map((o) => `${o.group}: ${o.name}`).join(' • ')}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.itemFooter}>
                  <View style={styles.qtyControl}>
                    <Pressable
                      style={styles.qtyButton}
                      onPress={() => updateQuantity.mutate({ itemId: item.id, quantity: item.quantity - 1 })}
                    >
                      <Ionicons name="remove" size={17} color={colors.blue} />
                    </Pressable>
                    <Text style={styles.qtyText}>{item.quantity}</Text>
                    <Pressable
                      style={styles.qtyButton}
                      onPress={() => updateQuantity.mutate({ itemId: item.id, quantity: item.quantity + 1 })}
                    >
                      <Ionicons name="add" size={17} color={colors.blue} />
                    </Pressable>
                  </View>
                  <Text style={styles.itemPrice}>{formatJmd(item.unitPriceMinor * item.quantity)}</Text>
                </View>
              </View>
            </View>
          </Card>
        ))}

        {/* Promo code */}
        <View style={styles.promoRow}>
          <View style={styles.promoInputWrap}>
            <Ionicons name="pricetag-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.promoInput}
              placeholder="Enter promo code"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              value={promoInput}
              onChangeText={setPromoInput}
            />
          </View>
          <Pressable
            style={styles.promoApply}
            onPress={() => promoInput.trim() && applyPromo.mutate(promoInput.trim())}
          >
            <Text style={styles.promoApplyText}>Apply</Text>
          </Pressable>
        </View>
        {promoError ? <Text style={styles.promoError}>{promoError}</Text> : null}
        {cart.promoCode ? (
          <View style={styles.promoApplied}>
            <Ionicons name="checkmark-circle" size={15} color={colors.success} />
            <Text style={styles.promoAppliedText}>Promo {cart.promoCode.code} applied</Text>
          </View>
        ) : null}

        {/* Order summary */}
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Order summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal ({items.length} item{items.length > 1 ? 's' : ''})</Text>
            <Text style={styles.summaryValue}>{formatJmd(subtotalMinor)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              Delivery fee{cart.distanceKm != null ? ` (${cart.distanceKm.toFixed(1)} km)` : ''}
            </Text>
            <Text style={styles.summaryValue}>{formatJmd(deliveryFeeMinor)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Service fee</Text>
            <Text style={styles.summaryValue}>{formatJmd(SERVICE_FEE_MINOR)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Estimated taxes</Text>
            <Text style={styles.summaryValue}>{formatJmd(taxMinor)}</Text>
          </View>
          {discountMinor > 0 ? (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.success }]}>Discount</Text>
              <Text style={[styles.summaryValue, { color: colors.success }]}>−{formatJmd(discountMinor)}</Text>
            </View>
          ) : null}
          <View style={styles.summaryTotalRow}>
            <Text style={styles.summaryTotalLabel}>Total</Text>
            <Text style={styles.summaryTotal}>{formatJmd(totalMinor)}</Text>
          </View>
          {cart.distanceKm != null ? (
            <Text style={styles.summaryHint}>
              Delivery fee is based on the {cart.distanceKm.toFixed(1)} km trip to your default address — final fee
              confirmed at checkout.
            </Text>
          ) : null}
        </Card>

        <GradientButton title="Proceed to checkout" onPress={() => router.push('/delivery/checkout')} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary, paddingHorizontal: 0 },
  merchantRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, marginBottom: spacing.base },
  merchantNote: { fontSize: fontSize.sm, color: colors.textSecondary },
  itemCard: { marginBottom: spacing.md, overflow: 'hidden' },
  itemRow: { flexDirection: 'row' },
  itemImage: { width: 100, minHeight: 100, backgroundColor: colors.skyTint },
  itemBody: { flex: 1, padding: spacing.md },
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  itemName: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  optionBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: 4,
  },
  optionBadgeText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  qtyControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  qtyButton: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  qtyText: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary, minWidth: 18, textAlign: 'center' },
  itemPrice: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  promoRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  promoInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
  },
  promoInput: { flex: 1, color: colors.textPrimary, fontSize: fontSize.base, paddingVertical: spacing.md },
  promoApply: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  promoApplyText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  promoError: { color: colors.danger, fontSize: fontSize.sm, marginTop: spacing.sm },
  promoApplied: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  promoAppliedText: { color: colors.success, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  summaryCard: { marginTop: spacing.base, marginBottom: spacing.base },
  summaryTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
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
  summaryHint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.md },
});
