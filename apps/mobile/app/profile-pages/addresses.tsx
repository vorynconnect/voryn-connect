import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocationPick } from '@/stores/locationPick';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { GradientButton } from '@/components/GradientButton';
import { BrandTextField } from '@/components/BrandTextField';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';

type Address = {
  id: string;
  label: 'HOME' | 'WORK' | 'OTHER';
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  parish: string;
  instructions: string | null;
  isDefault: boolean;
};

const LABELS = [
  { key: 'HOME' as const, label: 'Home', icon: 'home-outline' as const },
  { key: 'WORK' as const, label: 'Work', icon: 'briefcase-outline' as const },
  { key: 'OTHER' as const, label: 'Other', icon: 'location-outline' as const },
];

// Portmore town centre — fallback when location permission is denied.
const FALLBACK_COORDS = { latitude: 17.9583, longitude: -76.8822 };

/** Saved addresses — Home, Work, Other. Used by delivery and mobile services. */
export default function AddressesScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [label, setLabel] = useState<'HOME' | 'WORK' | 'OTHER'>('HOME');
  const [name, setName] = useState('');
  const [line1, setLine1] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Exact position chosen on the map — beats GPS when set.
  const [pinned, setPinned] = useState<{ name: string; latitude: number; longitude: number } | null>(null);

  const picked = useLocationPick((s) => s.picked);
  const consumePicked = useLocationPick((s) => s.consume);
  useEffect(() => {
    if (picked?.token !== 'address-pin') return;
    const result = consumePicked('address-pin');
    if (result) {
      setPinned(result);
      setAdding(true);
      if (!line1.trim()) setLine1(result.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  const addressesQuery = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api<{ addresses: Address[] }>('/v1/users/me/addresses'),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      // Map pin wins; otherwise the device position when granted; else Portmore.
      let coords = pinned
        ? { latitude: pinned.latitude, longitude: pinned.longitude }
        : FALLBACK_COORDS;
      if (!pinned) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
          }
        } catch {
          // GPS unavailable — keep the Portmore fallback.
        }
      }
      return api('/v1/users/me/addresses', {
        method: 'POST',
        body: {
          label,
          name: name.trim() || LABELS.find((l) => l.key === label)!.label,
          line1: line1.trim(),
          ...coords,
          ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
          isDefault: (addressesQuery.data?.addresses ?? []).length === 0,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['addresses'] });
      setAdding(false);
      setName('');
      setLine1('');
      setInstructions('');
      setPinned(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save the address.'),
  });

  const defaultMutation = useMutation({
    mutationFn: (id: string) => api(`/v1/users/me/addresses/${id}`, { method: 'PATCH', body: { isDefault: true } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['addresses'] }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api(`/v1/users/me/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['addresses'] }),
  });

  const addresses = addressesQuery.data?.addresses ?? [];

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Saved Addresses</Text>
        <Text style={styles.subtitle}>Home, work, and other places you order to.</Text>

        {addressesQuery.isLoading ? <LoadingState label="Loading addresses…" /> : null}
        {addressesQuery.isError ? <ErrorState onRetry={() => addressesQuery.refetch()} /> : null}
        {addressesQuery.isSuccess && addresses.length === 0 && !adding ? (
          <EmptyState icon="location-outline" title="No addresses yet" body="Add your home or work address for faster checkout." />
        ) : null}

        {addresses.map((address) => {
          const meta = LABELS.find((l) => l.key === address.label) ?? LABELS[2]!;
          return (
            <Card key={address.id} style={styles.addressRow}>
              <View style={styles.addressIcon}>
                <Ionicons name={meta.icon} size={20} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.addressNameRow}>
                  <Text style={styles.addressName}>{address.name}</Text>
                  {address.isDefault ? (
                    <View style={styles.defaultBadge}>
                      <Text style={styles.defaultText}>Default</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.addressLine} numberOfLines={1}>
                  {address.line1}, {address.city}
                </Text>
                {address.instructions ? (
                  <Text style={styles.addressNote} numberOfLines={1}>
                    {address.instructions}
                  </Text>
                ) : null}
              </View>
              <View style={styles.addressActions}>
                {!address.isDefault ? (
                  <Pressable hitSlop={6} onPress={() => defaultMutation.mutate(address.id)}>
                    <Text style={styles.makeDefault}>Set default</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  hitSlop={6}
                  onPress={() =>
                    setDialog({
                      title: 'Remove address',
                      message: `Remove "${address.name}"?`,
                      confirmLabel: 'Remove',
                      destructive: true,
                      onConfirm: () => removeMutation.mutate(address.id),
                    })
                  }
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
            </Card>
          );
        })}

        {adding ? (
          <Card style={styles.addCard}>
            <Text style={styles.addTitle}>Add an address</Text>
            <View style={styles.labelRow}>
              {LABELS.map((option) => {
                const active = label === option.key;
                return (
                  <Pressable
                    key={option.key}
                    style={[styles.labelChip, active && styles.labelChipActive]}
                    onPress={() => setLabel(option.key)}
                  >
                    <Ionicons name={option.icon} size={15} color={active ? colors.textOnBrand : colors.textPrimary} />
                    <Text style={[styles.labelChipText, active && styles.labelChipTextActive]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <BrandTextField icon="bookmark-outline" placeholder="Name (e.g. Home)" value={name} onChangeText={setName} />
            <BrandTextField icon="location-outline" placeholder="Street address" value={line1} onChangeText={setLine1} />
            <BrandTextField
              icon="chatbubble-ellipses-outline"
              placeholder="Delivery instructions (optional)"
              value={instructions}
              onChangeText={setInstructions}
            />
            <Pressable
              style={styles.mapPinRow}
              onPress={() =>
                router.push({
                  pathname: '/location/pick',
                  params: {
                    token: 'address-pin',
                    title: 'Set address location',
                    ...(pinned ? { lat: String(pinned.latitude), lng: String(pinned.longitude) } : {}),
                  },
                })
              }
            >
              <Ionicons name="map-outline" size={18} color={colors.blue} />
              <Text style={styles.mapPinText}>{pinned ? `Pinned: ${pinned.name}` : 'Set exact location on map'}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>
            <Text style={styles.geoNote}>
              {pinned
                ? 'The map pin will be attached to this address so providers can find you.'
                : 'We’ll attach your current location to this address so providers can find you.'}
            </Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <GradientButton
              title="Save address"
              icon="checkmark"
              loading={addMutation.isPending}
              disabled={line1.trim().length < 3}
              onPress={() => {
                setError(null);
                addMutation.mutate();
              }}
            />
            <Pressable style={styles.cancelRow} onPress={() => setAdding(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </Card>
        ) : (
          <Pressable style={styles.addRow} onPress={() => setAdding(true)}>
            <View style={styles.addIcon}>
              <Ionicons name="add" size={22} color={colors.blue} />
            </View>
            <Text style={styles.addRowText}>Add new address</Text>
          </Pressable>
        )}
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
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  addressIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addressName: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  defaultBadge: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  defaultText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  addressLine: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  addressNote: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1 },
  addressActions: { alignItems: 'flex-end', gap: spacing.sm },
  makeDefault: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  addIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRowText: { color: colors.blue, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  addCard: { marginTop: spacing.sm },
  addTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  labelRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  labelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  labelChipActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  labelChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.textPrimary },
  labelChipTextActive: { color: colors.textOnBrand, fontWeight: fontWeight.bold },
  mapPinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  mapPinText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  geoNote: { fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: spacing.md },
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md },
  cancelRow: { alignItems: 'center', paddingVertical: spacing.md },
  cancelText: { color: colors.textSecondary, fontWeight: fontWeight.semibold },
});
