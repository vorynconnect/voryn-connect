import { useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, gradients, radius, shadow, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmdCompact } from '@/lib/format';
import type { RentalReservation, RentalReservationDetail } from '@/lib/types';

const STATUS_PILL: Record<string, { label: string; color: string; tint: string }> = {
  CONFIRMED: { label: 'Ready for pickup', color: colors.blue, tint: colors.skyTint },
  ACTIVE: { label: 'Active rental', color: colors.success, tint: colors.successTint },
  EXTENDED: { label: 'Active rental', color: colors.success, tint: colors.successTint },
  RETURN_PENDING: { label: 'Return pending', color: colors.warning, tint: colors.warningTint },
  CANCELLED: { label: 'Cancelled', color: colors.danger, tint: colors.dangerTint },
  PENDING_PAYMENT: { label: 'Payment pending', color: colors.warning, tint: colors.warningTint },
};

function timeRemaining(returnAt: string, now: Date): string {
  const ms = new Date(returnAt).getTime() - now.getTime();
  if (ms <= 0) return 'Return due';
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes.toString().padStart(2, '0')}m`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const tomorrow = new Date(Date.now() + 86400000).toDateString() === d.toDateString();
  const day = today ? 'Today' : tomorrow ? 'Tomorrow' : d.toLocaleDateString('en-JM', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day}, ${d.toLocaleTimeString('en-JM', { hour: 'numeric', minute: '2-digit' })}`;
}

const PROTECTION_LABEL: Record<string, string> = {
  basic_protection: 'Basic cover',
  full_protection: 'Full cover',
};

/** "Your rental" — manage the vehicle during the rental period. */
export default function ActiveRentalScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [now, setNow] = useState(() => new Date());
  const [extendVisible, setExtendVisible] = useState(false);
  const [extendDays, setExtendDays] = useState(1);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  // Tick every 30s so "Time remaining" stays live.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const detailQuery = useQuery({
    queryKey: ['rental', id],
    queryFn: () => api<RentalReservationDetail>(`/v1/rentals/${id}`),
  });
  const reservation = detailQuery.data?.reservation;

  const refresh = (updated?: RentalReservation) => {
    if (updated) {
      queryClient.setQueryData<RentalReservationDetail>(['rental', id], (prev) =>
        prev ? { ...prev, reservation: { ...prev.reservation, ...updated } } : prev,
      );
    }
    queryClient.invalidateQueries({ queryKey: ['rental', id] });
    queryClient.invalidateQueries({ queryKey: ['orders-feed'] });
  };

  const activateMutation = useMutation({
    mutationFn: () => api<{ reservation: RentalReservation }>(`/v1/rentals/${id}/activate`, { method: 'POST' }),
    onSuccess: (data) => refresh(data.reservation),
    onError: (err) =>
      setDialog({ title: 'Could not unlock', message: err instanceof ApiError ? err.message : 'Please try again.' }),
  });

  const extendKey = useMemo(() => `extend-${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`, [id, extendVisible]);
  const extendMutation = useMutation({
    mutationFn: (newReturnAt: string) =>
      api<{ reservation: RentalReservation }>(`/v1/rentals/${id}/extend`, {
        method: 'POST',
        body: { newReturnAt, idempotencyKey: extendKey },
      }),
    onSuccess: (data) => {
      refresh(data.reservation);
      setExtendVisible(false);
      setDialog({ title: 'Rental extended', message: `Your return time is now ${fmtDateTime(data.reservation.returnAt)}.` });
    },
    onError: (err) => setExtendError(err instanceof ApiError ? err.message : 'Could not extend your rental.'),
  });

  const completeMutation = useMutation({
    mutationFn: () => api<{ reservation: RentalReservation }>(`/v1/rentals/${id}/complete`, { method: 'POST' }),
    onSuccess: (data) => {
      refresh(data.reservation);
      router.replace({ pathname: '/rentals/complete/[id]', params: { id: id! } });
    },
    onError: (err) =>
      setDialog({ title: 'Could not complete return', message: err instanceof ApiError ? err.message : 'Please try again.' }),
  });

  if (detailQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading your rental…" />
      </View>
    );
  }
  if (detailQuery.isError || !reservation) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => detailQuery.refetch()} />
      </View>
    );
  }

  // Completed rentals live on the completion screen instead.
  if (reservation.status === 'COMPLETED') {
    router.replace({ pathname: '/rentals/complete/[id]', params: { id: id! } });
    return null;
  }

  const pill = STATUS_PILL[reservation.status] ?? STATUS_PILL.CONFIRMED!;
  const isConfirmed = reservation.status === 'CONFIRMED';
  const isInactive = reservation.status === 'CANCELLED' || reservation.status === 'PENDING_PAYMENT';
  const protection =
    reservation.addOns.map((a) => PROTECTION_LABEL[a.key]).find(Boolean) ?? 'Not added';
  const paymentLabel =
    reservation.payment?.methodType === 'VORYN_WALLET'
      ? 'Voryn Wallet'
      : reservation.payment?.methodType === 'CARD'
        ? 'Card'
        : 'Cash';
  const extendCostMinor = reservation.vehicle.dailyRateMinor * extendDays;
  const providerPhone = reservation.provider.phone ?? null;

  const callNumber = (phone: string | null, missingLabel: string) => {
    if (phone) {
      Linking.openURL(`tel:${phone.replace(/[^+\d]/g, '')}`);
    } else {
      setDialog({ title: missingLabel, message: 'No phone number is available right now. Reach us through Support.' });
    }
  };

  const onUnlock = () => {
    if (isInactive) {
      setDialog({ title: 'Reservation unavailable', message: 'This reservation is no longer active.' });
      return;
    }
    if (isConfirmed) {
      setDialog({
        title: 'Start your rental?',
        message: `Unlock the ${reservation.vehicle.make} ${reservation.vehicle.model} and start your rental period.`,
        confirmLabel: 'Unlock vehicle',
        onConfirm: () => activateMutation.mutate(),
      });
    } else {
      setDialog({ title: 'Vehicle unlocked', message: 'Your vehicle is already unlocked. Enjoy your trip!' });
    }
  };

  const onReturn = () => {
    if (isInactive) {
      setDialog({ title: 'Reservation unavailable', message: 'This reservation is no longer active.' });
      return;
    }
    setDialog({
      title: 'Complete your return?',
      message: `Confirm that you have returned the vehicle to ${reservation.returnLocation}. The provider will inspect it and release your deposit.`,
      confirmLabel: 'Complete return',
      onConfirm: () => completeMutation.mutate(),
    });
  };

  const statusTiles = [
    {
      icon: 'speedometer-outline' as const,
      label: 'Fuel',
      value: reservation.vehicle.fuelPercent != null ? `${reservation.vehicle.fuelPercent}%` : '—',
      bar: reservation.vehicle.fuelPercent,
    },
    {
      icon: 'navigate-circle-outline' as const,
      label: 'Odometer',
      value: reservation.vehicle.odometerKm != null ? `${reservation.vehicle.odometerKm.toLocaleString('en-JM')} km` : '—',
      bar: null,
    },
    { icon: 'options-outline' as const, label: 'Transmission', value: reservation.vehicle.transmission, bar: null },
    { icon: 'headset-outline' as const, label: 'Support', value: '24/7', bar: null },
  ];

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        {/* Title + status pill */}
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Your rental</Text>
            <Text style={styles.subtitle}>Manage your vehicle during the rental period</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: pill.tint }]}>
            <View style={[styles.statusDot, { backgroundColor: pill.color }]} />
            <Text style={[styles.statusPillText, { color: pill.color }]}>{pill.label}</Text>
          </View>
        </View>

        {/* Vehicle card */}
        <Card style={styles.vehicleCard}>
          <View style={styles.vehicleRow}>
            <Image source={{ uri: reservation.vehicle.imageUrl ?? undefined }} style={styles.vehicleImage} contentFit="cover" />
            <View style={styles.vehicleInfo}>
              <View style={styles.providerRow}>
                <Image source={{ uri: reservation.provider.logoUrl ?? undefined }} style={styles.providerLogo} contentFit="cover" />
                <Text style={styles.providerName} numberOfLines={1}>
                  {reservation.provider.name}
                </Text>
                {reservation.provider.isVerified ? (
                  <Ionicons name="checkmark-circle" size={15} color={colors.blue} />
                ) : null}
              </View>
              <Text style={styles.vehicleName}>
                {reservation.vehicle.make} {reservation.vehicle.model}
              </Text>
              {reservation.vehicle.plateNo ? (
                <View style={styles.plateBadge}>
                  <Text style={styles.plateText}>{reservation.vehicle.plateNo}</Text>
                </View>
              ) : null}
              <Text style={styles.timeLabel}>{isConfirmed ? 'Pickup at' : 'Time remaining'}</Text>
              <View style={styles.timeRow}>
                <Ionicons name="time-outline" size={22} color={colors.blue} />
                <Text style={styles.timeValue}>
                  {isConfirmed ? fmtDateTime(reservation.pickupAt) : timeRemaining(reservation.returnAt, now)}
                </Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Locations */}
        <Card style={styles.locationsCard}>
          <View style={styles.locationRow}>
            <View style={styles.locationIcon}>
              <Ionicons name="location" size={19} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.locationLabel}>Pickup / current location</Text>
              <Text style={styles.locationValue}>{reservation.pickupLocation}</Text>
            </View>
            <Pressable
              style={styles.mapButton}
              onPress={() => Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(reservation.pickupLocation)}`)}
            >
              <Ionicons name="map-outline" size={15} color={colors.blue} />
              <Text style={styles.mapButtonText}>View on map</Text>
            </Pressable>
          </View>
          <View style={styles.locationDivider} />
          <Pressable style={styles.locationRow} onPress={onReturn} disabled={completeMutation.isPending}>
            <View style={[styles.locationIcon, { backgroundColor: colors.surfaceMuted }]}>
              <Ionicons name="flag-outline" size={19} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.locationLabel}>Return location</Text>
              <Text style={styles.locationValue}>Return to {reservation.returnLocation}</Text>
              <Text style={styles.locationHint}>by {fmtDateTime(reservation.returnAt)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        </Card>

        {/* Vehicle status */}
        <Card style={styles.statusCard}>
          <Text style={styles.sectionTitle}>Vehicle status</Text>
          <View style={styles.statusGrid}>
            {statusTiles.map((tile) => (
              <View key={tile.label} style={styles.statusItem}>
                <View style={styles.statusIcon}>
                  <Ionicons name={tile.icon} size={20} color={colors.blue} />
                </View>
                <Text style={styles.statusItemLabel}>{tile.label}</Text>
                <Text style={styles.statusItemValue}>{tile.value}</Text>
                {tile.bar != null ? (
                  <View style={styles.fuelTrack}>
                    <View style={[styles.fuelFill, { width: `${Math.min(100, Math.max(0, tile.bar))}%` }]} />
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </Card>

        {/* Quick actions */}
        <View style={styles.actionsRow}>
          {(
            [
              {
                icon: isConfirmed ? ('lock-open-outline' as const) : ('lock-closed-outline' as const),
                label: 'Unlock vehicle',
                onPress: onUnlock,
              },
              { icon: 'calendar-outline' as const, label: 'Extend rental', onPress: () => { setExtendDays(1); setExtendError(null); setExtendVisible(true); } },
              { icon: 'call-outline' as const, label: 'Call provider', onPress: () => callNumber(providerPhone, 'Provider unavailable') },
              {
                icon: 'headset-outline' as const,
                label: 'Support',
                onPress: () =>
                  setDialog({
                    title: 'Voryn Support',
                    message: 'Our team is available 24/7 to help with your rental.',
                    confirmLabel: 'Call support',
                    onConfirm: () => callNumber('+18765550000', 'Support unavailable'),
                  }),
              },
            ] as const
          ).map((action) => (
            <Pressable key={action.label} style={styles.actionTile} onPress={action.onPress}>
              <View style={styles.actionIcon}>
                <Ionicons name={action.icon} size={21} color={colors.blue} />
              </View>
              <Text style={styles.actionLabel}>{action.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Rental details */}
        <Card style={styles.detailsCard}>
          <View style={styles.detailsHeader}>
            <Text style={styles.sectionTitle}>Rental details</Text>
            <Text style={styles.codeText}>#{reservation.code}</Text>
          </View>
          <View style={styles.detailsGrid}>
            <View style={styles.detailItem}>
              <Ionicons name="wallet-outline" size={18} color={colors.blue} />
              <View>
                <Text style={styles.detailLabel}>Payment method</Text>
                <Text style={styles.detailValue}>{paymentLabel}</Text>
              </View>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="pricetag-outline" size={18} color={colors.blue} />
              <View>
                <Text style={styles.detailLabel}>Daily rate</Text>
                <Text style={styles.detailValue}>{formatJmdCompact(reservation.vehicle.dailyRateMinor)}</Text>
              </View>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.blue} />
              <View>
                <Text style={styles.detailLabel}>Protection</Text>
                <Text style={styles.detailValue}>{protection}</Text>
              </View>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="calendar-outline" size={18} color={colors.blue} />
              <View>
                <Text style={styles.detailLabel}>Rental period</Text>
                <Text style={styles.detailValue}>
                  {fmtDateTime(reservation.pickupAt)} → {fmtDateTime(reservation.returnAt)}
                </Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Roadside help banner */}
        <LinearGradient colors={gradients.walletCard} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.helpBanner}>
          <View style={styles.helpIcon}>
            <Ionicons name="help-buoy-outline" size={24} color={colors.textOnBrand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.helpTitle}>Need roadside help?</Text>
            <Text style={styles.helpBody}>We’re here 24/7.</Text>
          </View>
          <Pressable style={styles.helpButton} onPress={() => callNumber('+18765550000', 'Support unavailable')}>
            <Text style={styles.helpButtonText}>Get help now</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.blue} />
          </Pressable>
        </LinearGradient>
      </ScrollView>

      {/* Extend rental sheet */}
      <Modal visible={extendVisible} transparent animationType="fade" onRequestClose={() => setExtendVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setExtendVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Extend rental</Text>
            <Text style={styles.modalSubtitle}>
              Current return: {fmtDateTime(reservation.returnAt)} • {formatJmdCompact(reservation.vehicle.dailyRateMinor)} / day
            </Text>
            <View style={styles.extendOptions}>
              {[1, 2, 3].map((days) => {
                const active = extendDays === days;
                return (
                  <Pressable
                    key={days}
                    style={[styles.extendOption, active && styles.extendOptionActive]}
                    onPress={() => setExtendDays(days)}
                  >
                    <Text style={[styles.extendDays, active && styles.extendTextActive]}>
                      +{days} day{days > 1 ? 's' : ''}
                    </Text>
                    <Text style={[styles.extendCost, active && styles.extendTextActive]}>
                      {formatJmdCompact(reservation.vehicle.dailyRateMinor * days)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {extendError ? <Text style={styles.extendErrorText}>{extendError}</Text> : null}
            <GradientButton
              title={`Extend • ${formatJmdCompact(extendCostMinor)}`}
              icon="calendar-outline"
              loading={extendMutation.isPending}
              onPress={() => {
                const newReturnAt = new Date(new Date(reservation.returnAt).getTime() + extendDays * 86400000).toISOString();
                extendMutation.mutate(newReturnAt);
              }}
            />
            <Pressable style={styles.modalCancel} onPress={() => setExtendVisible(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.base },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPillText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  vehicleCard: { marginBottom: spacing.md },
  vehicleRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  vehicleImage: { width: '42%', height: 120, borderRadius: radius.md, backgroundColor: colors.skyTint },
  vehicleInfo: { flex: 1 },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  providerLogo: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.skyTint },
  providerName: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: fontWeight.semibold, flexShrink: 1 },
  vehicleName: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary, marginTop: 4 },
  plateBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.skyTint,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    marginTop: 6,
  },
  plateText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.md, letterSpacing: 1 },
  timeLabel: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.md },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  timeValue: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.blue },
  locationsCard: { marginBottom: spacing.md },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  locationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  locationValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  locationHint: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  locationDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  mapButtonText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  statusCard: { marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
  statusGrid: { flexDirection: 'row', marginTop: spacing.base },
  statusItem: { flex: 1, alignItems: 'center', gap: 4 },
  statusIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusItemLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  statusItemValue: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  fuelTrack: { width: 52, height: 4, borderRadius: 2, backgroundColor: colors.skyTint, overflow: 'hidden' },
  fuelFill: { height: 4, borderRadius: 2, backgroundColor: colors.blue },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionTile: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.base,
    paddingHorizontal: 4,
    ...shadow.card,
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.textPrimary, textAlign: 'center' },
  detailsCard: { marginBottom: spacing.md },
  detailsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.base },
  codeText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.base },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, width: '46%', flexGrow: 1 },
  detailLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  detailValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textPrimary },
  helpBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.base,
    ...shadow.cta,
  },
  helpIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpTitle: { color: colors.textOnBrand, fontSize: fontSize.md, fontWeight: fontWeight.heavy },
  helpBody: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.sm },
  helpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  helpButtonText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(22,48,93,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  modalSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.base },
  extendOptions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.base },
  extendOption: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.base,
  },
  extendOptionActive: { borderColor: colors.blue, backgroundColor: colors.skyTint },
  extendDays: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  extendCost: { fontSize: fontSize.sm, color: colors.textSecondary },
  extendTextActive: { color: colors.blue },
  extendErrorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md },
  modalCancel: { alignItems: 'center', paddingVertical: spacing.base },
  modalCancelText: { color: colors.textSecondary, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
});
