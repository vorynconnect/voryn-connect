import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LiveTripMap } from '@/features/map/LiveTripMap';
import { haversineKm } from '@/features/map/geo';
import type { VehicleFix } from '@/features/map/useSmoothVehicle';
import { vehicleKindForCourier, vehicleLabel } from '@/features/map/vehicle';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { RateProviderCard } from '@/features/reviews/RateProviderCard';
import { TipCard } from '@/features/tips/TipCard';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import { useTracking } from '@/lib/socket';

type OrderDetail = {
  order: {
    id: string;
    code: string;
    status: string;
    deliveryAddressName: string | null;
    deliveryLat: number | null;
    deliveryLng: number | null;
    subtotalMinor: number;
    deliveryFeeMinor: number;
    serviceFeeMinor: number;
    taxMinor: number;
    discountMinor: number;
    pointsRedeemed: number;
    pointsDiscountMinor: number;
    tipMinor: number;
    totalMinor: number;
    distanceKm: number | null;
    etaMinMinutes: number | null;
    etaMaxMinutes: number | null;
    provider: { id: string; name: string; logoUrl: string | null };
    courier: {
      vehicleType: string;
      vehicleDesc: string | null;
      ratingAvg: number;
      user: { fullName: string; customerProfile: { avatarUrl: string | null } | null };
    } | null;
    payment: { methodType: string } | null;
    items: Array<{ id: string; name: string; quantity: number; unitPriceMinor: number }>;
  };
  events: Array<{ id: string; status: string; label: string; createdAt: string }>;
  courierLocation: { latitude: number; longitude: number; heading: number | null } | null;
  merchantPoint: { latitude: number; longitude: number } | null;
  /** Live courier ETA from the backend (road route); null before assignment. */
  eta: { etaMinutes: number; stale: boolean } | null;
};

const STEPS = [
  { key: 'PLACED', label: 'Order confirmed' },
  { key: 'PREPARING', label: 'Preparing' },
  { key: 'PICKED_UP', label: 'Picked up' },
  { key: 'ON_THE_WAY', label: 'On the way' },
  { key: 'DELIVERED', label: 'Delivered' },
] as const;

const STATUS_TO_STEP: Record<string, number> = {
  PLACED: 0,
  CONFIRMED: 0,
  PREPARING: 1,
  READY_FOR_PICKUP: 1,
  COURIER_ASSIGNED: 1,
  PICKED_UP: 2,
  ON_THE_WAY: 3,
  DELIVERED: 4,
  COMPLETED: 4,
};

const MERCHANT_POINT = { latitude: 17.9712, longitude: -76.8898 };

export default function OrderTrackingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [liveLocation, setLiveLocation] = useState<VehicleFix | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  const orderQuery = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api<OrderDetail>(`/v1/orders/${orderId}`),
    refetchInterval: 8000,
  });

  useTracking('ORDER', orderId, {
    onEvent: () => void orderQuery.refetch(),
    onLocation: (loc) =>
      setLiveLocation({ latitude: loc.latitude, longitude: loc.longitude, heading: loc.heading ?? null }),
  });

  if (orderQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading your order…" />
      </View>
    );
  }
  if (orderQuery.isError || !orderQuery.data) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => orderQuery.refetch()} />
      </View>
    );
  }

  const { order, events, courierLocation, merchantPoint, eta } = orderQuery.data;
  const cancelled = order.status.startsWith('CANCELLED') || order.status === 'REFUNDED';
  const delivered = order.status === 'DELIVERED' || order.status === 'COMPLETED';
  const stepIndex = STATUS_TO_STEP[order.status] ?? 0;
  const destination =
    order.deliveryLat != null && order.deliveryLng != null
      ? { latitude: order.deliveryLat, longitude: order.deliveryLng }
      : { latitude: 17.9583, longitude: -76.8822 };
  const merchant = merchantPoint ?? MERCHANT_POINT;
  const courierFix = liveLocation ?? courierLocation ?? null;
  const courierVehicle = vehicleKindForCourier(order.courier?.vehicleType);
  // Courier heads to the merchant until pickup, then to the customer.
  const courierPhase = order.status === 'PICKED_UP' || order.status === 'ON_THE_WAY' ? 'toDropoff' : 'toPickup';
  const kmAway = courierFix ? haversineKm(courierFix, destination) : null;

  const eventTime = (key: string) => {
    const event = events.find((e) => e.status === key);
    return event
      ? new Date(event.createdAt).toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' })
      : null;
  };

  const cancelOrder = async () => {
    await api(`/v1/orders/${order.id}/cancel`, { method: 'POST', body: {} });
    await queryClient.invalidateQueries({ queryKey: ['orders-feed'] });
    void orderQuery.refetch();
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{delivered ? 'Order delivered' : cancelled ? 'Order cancelled' : 'Order tracking'}</Text>
        <Text style={styles.subtitle}>
          {delivered
            ? 'Enjoy! Your order has been delivered.'
            : cancelled
              ? 'This order was cancelled and refunded where applicable.'
              : 'Your order is on the way.'}
        </Text>

        {/* Live map */}
        {!cancelled && !delivered ? (
          <Card padded={false} style={styles.mapCard}>
            <LiveTripMap
              style={styles.map}
              pickup={merchant}
              dropoff={destination}
              pickupLabel={order.provider.name}
              pickupHint="Pickup"
              dropoffLabel={order.deliveryAddressName ?? 'You'}
              dropoffHint="Destination"
              dropoffIcon="home"
              pickupStyle="merchant"
              vehicleKind={courierVehicle}
              vehicleFix={courierFix}
              phase={courierPhase}
            />
            <View style={styles.etaStrip}>
              <View style={{ flex: 1 }}>
                <Text style={styles.etaLabel}>Estimated arrival</Text>
                <Text style={styles.etaValue}>
                  {eta && !eta.stale
                    ? `${eta.etaMinutes} min`
                    : order.etaMinMinutes != null && order.etaMaxMinutes != null
                      ? `${order.etaMinMinutes}–${order.etaMaxMinutes} min`
                      : eta
                        ? 'Updating…'
                        : '—'}
                </Text>
                {kmAway != null ? <Text style={styles.etaSub}>{kmAway.toFixed(1)} km away</Text> : null}
              </View>
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Live</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={styles.etaLabel}>Live tracking</Text>
                <Text style={styles.etaSub}>Updates in real time</Text>
              </View>
            </View>
          </Card>
        ) : null}

        {/* Steps */}
        <Card style={styles.stepsCard}>
          <View style={styles.stepsRow}>
            {STEPS.map((step, i) => {
              const done = i < stepIndex || delivered;
              const current = i === stepIndex && !delivered && !cancelled;
              const time = eventTime(step.key);
              return (
                <View key={step.key} style={styles.stepWrap}>
                  {i > 0 ? <View style={[styles.stepLine, (done || current) && styles.stepLineDone]} /> : null}
                  <View style={[styles.stepDot, done && styles.stepDone, current && styles.stepCurrent]}>
                    {done ? <Ionicons name="checkmark" size={13} color={colors.textOnBrand} /> : null}
                    {current ? <View style={styles.stepInner} /> : null}
                  </View>
                  <Text style={[styles.stepLabel, (done || current) && styles.stepLabelActive]} numberOfLines={2}>
                    {step.label}
                  </Text>
                  {time ? <Text style={styles.stepTime}>{time}</Text> : null}
                </View>
              );
            })}
          </View>
        </Card>

        {/* Courier */}
        {order.courier && !cancelled ? (
          <Card style={styles.courierCard}>
            <View style={styles.courierRow}>
              <Avatar uri={order.courier.user.customerProfile?.avatarUrl} name={order.courier.user.fullName} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={styles.courierName}>{order.courier.user.fullName}</Text>
                <Text style={styles.courierMeta}>Your courier</Text>
                <View style={styles.courierVehicleRow}>
                  <Ionicons
                    name={courierVehicle === 'car' ? 'car-outline' : 'bicycle-outline'}
                    size={13}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.courierMeta}>
                    {vehicleLabel(courierVehicle)}
                    {order.courier.vehicleDesc ? ` — ${order.courier.vehicleDesc}` : ''}
                  </Text>
                </View>
              </View>
              <Pressable style={styles.courierAction} onPress={() => router.push('/profile-pages/support')}>
                <Ionicons name="call-outline" size={17} color={colors.blue} />
                <Text style={styles.courierActionText}>Call</Text>
              </Pressable>
              <Pressable
                style={styles.courierAction}
                onPress={() =>
                  router.push({
                    pathname: '/chat',
                    params: {
                      context: 'ORDER',
                      referenceId: order.id,
                      title: order.courier!.user.fullName,
                      avatarUrl: order.courier!.user.customerProfile?.avatarUrl ?? '',
                    },
                  })
                }
              >
                <Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.blue} />
                <Text style={styles.courierActionText}>Chat</Text>
              </Pressable>
            </View>
          </Card>
        ) : null}

        {/* Order summary */}
        <Card style={styles.summaryCard}>
          <View style={styles.summaryHead}>
            <Image source={{ uri: order.provider.logoUrl ?? undefined }} style={styles.summaryLogo} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryProvider}>{order.provider.name}</Text>
              <Text style={styles.summaryMeta}>
                Order # {order.code} • {order.items.length} item{order.items.length > 1 ? 's' : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </View>
          {order.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.itemDot} />
              <Text style={styles.itemName}>
                {item.name} <Text style={styles.itemQty}>x{item.quantity}</Text>
              </Text>
              <Text style={styles.itemPrice}>{formatJmd(item.unitPriceMinor * item.quantity)}</Text>
            </View>
          ))}
          <View style={styles.feeBlock}>
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>
                Delivery Fee{order.distanceKm != null ? ` (${order.distanceKm.toFixed(1)} km)` : ''}
              </Text>
              <Text style={styles.feeValue}>{formatJmd(order.deliveryFeeMinor)}</Text>
            </View>
            {order.serviceFeeMinor > 0 ? (
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Service Fee</Text>
                <Text style={styles.feeValue}>{formatJmd(order.serviceFeeMinor)}</Text>
              </View>
            ) : null}
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>Tax</Text>
              <Text style={styles.feeValue}>{formatJmd(order.taxMinor)}</Text>
            </View>
            {order.discountMinor > 0 ? (
              <View style={styles.feeRow}>
                <Text style={[styles.feeLabel, { color: colors.success }]}>Discount</Text>
                <Text style={[styles.feeValue, { color: colors.success }]}>−{formatJmd(order.discountMinor)}</Text>
              </View>
            ) : null}
            {order.pointsDiscountMinor > 0 ? (
              <View style={styles.feeRow}>
                <Text style={[styles.feeLabel, { color: colors.success }]}>
                  Points redeemed ({order.pointsRedeemed.toLocaleString()} pts)
                </Text>
                <Text style={[styles.feeValue, { color: colors.success }]}>
                  −{formatJmd(order.pointsDiscountMinor)}
                </Text>
              </View>
            ) : null}
            {order.tipMinor > 0 ? (
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Tip</Text>
                <Text style={styles.feeValue}>{formatJmd(order.tipMinor)}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatJmd(order.totalMinor)}</Text>
          </View>
        </Card>

        {/* Address + payment */}
        {order.deliveryAddressName ? (
          <Card style={styles.rowCard}>
            <View style={styles.rowCardIcon}>
              <Ionicons name="location" size={19} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowCardLabel}>Deliver to</Text>
              <Text style={styles.rowCardValue}>{order.deliveryAddressName}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Card>
        ) : null}
        <Card style={styles.rowCard}>
          <View style={styles.rowCardIcon}>
            <Ionicons name="wallet-outline" size={19} color={colors.blue} />
          </View>
          <Text style={[styles.rowCardValue, { flex: 1 }]}>
            Paid with {order.payment?.methodType === 'VORYN_WALLET' ? 'Voryn Wallet' : order.payment?.methodType ?? '—'}
          </Text>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
        </Card>

        {delivered && order.courier && order.tipMinor === 0 ? (
          <TipCard
            title={`Tip ${order.courier.user.fullName.split(' ')[0]}?`}
            subtitle="Show your appreciation — 100% of the tip goes to your delivery person."
            onSubmit={async (tipMinor) => {
              await api(`/v1/orders/${order.id}/tip`, { method: 'POST', body: { tipMinor } });
              await orderQuery.refetch();
            }}
          />
        ) : null}

        {delivered ? (
          <RateProviderCard
            providerId={order.provider.id}
            subjectType="ORDER"
            subjectId={order.id}
            title="How was your order?"
          />
        ) : null}

        {/* Actions */}
        <View style={styles.actionsRow}>
          <Pressable style={styles.supportButton} onPress={() => router.push('/profile-pages/support')}>
            <Ionicons name="headset-outline" size={18} color={colors.blue} />
            <Text style={styles.supportButtonText}>Support</Text>
          </Pressable>
          <GradientButton
            title="View receipt"
            icon="receipt-outline"
            style={{ flex: 1 }}
            onPress={() => router.push('/(tabs)/orders')}
          />
        </View>

        {!delivered && !cancelled && ['PLACED', 'CONFIRMED', 'PREPARING'].includes(order.status) ? (
          <Pressable
            style={styles.cancelButton}
            onPress={() =>
              setDialog({
                title: 'Cancel this order?',
                message: 'The provider will stop preparing it and your payment will be refunded to your wallet.',
                confirmLabel: 'Cancel order',
                destructive: true,
                onConfirm: () => void cancelOrder(),
              })
            }
          >
            <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
            <Text style={styles.cancelText}>Cancel order</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  mapCard: { overflow: 'hidden', marginBottom: spacing.md },
  map: { height: 280 },
  etaStrip: { flexDirection: 'row', alignItems: 'center', padding: spacing.base },
  etaLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  etaValue: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 1 },
  etaSub: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.successTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  liveText: { color: colors.success, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  stepsCard: { marginBottom: spacing.md },
  stepsRow: { flexDirection: 'row' },
  stepWrap: { flex: 1, alignItems: 'center' },
  stepLine: { position: 'absolute', top: 12, left: '-50%', right: '50%', height: 3, backgroundColor: colors.border },
  stepLineDone: { backgroundColor: colors.blue },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  stepDone: { backgroundColor: colors.blue, borderColor: colors.blue },
  stepCurrent: { borderColor: colors.blue },
  stepInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  stepLabel: { fontSize: 10, color: colors.textSecondary, textAlign: 'center', marginTop: 5 },
  stepLabelActive: { color: colors.textPrimary, fontWeight: fontWeight.semibold },
  stepTime: { fontSize: 9, color: colors.textMuted, marginTop: 1 },
  courierCard: { marginBottom: spacing.md },
  courierRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  courierName: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  courierMeta: { fontSize: fontSize.sm, color: colors.textSecondary },
  courierVehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  courierAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  courierActionText: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.sm },
  summaryCard: { marginBottom: spacing.md },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingBottom: spacing.md,
  },
  summaryLogo: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.skyTint },
  summaryProvider: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  summaryMeta: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  itemDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.blue },
  itemName: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary },
  itemQty: { color: colors.textSecondary, fontSize: fontSize.sm },
  itemPrice: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: fontWeight.medium },
  feeBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
  },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  feeLabel: { fontSize: fontSize.base, color: colors.textSecondary },
  feeValue: { fontSize: fontSize.base, color: colors.textPrimary },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  totalLabel: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  totalValue: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  rowCardIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCardLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  rowCardValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 1 },
  actionsRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginBottom: spacing.md },
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  supportButtonText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: spacing.base,
  },
  cancelText: { color: colors.danger, fontWeight: fontWeight.bold, fontSize: fontSize.base },
});
