import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { GradientButton } from '@/components/GradientButton';
import { BrandTextField } from '@/components/BrandTextField';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { colors, fontSize, fontWeight, gradients, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import type { PaymentMethod } from '@/lib/types';

/**
 * Payment methods — list, add, and remove saved cards. Card entry is
 * tokenized: only brand + last4 + expiry reach the API, never a full PAN.
 */
export default function PaymentMethodsScreen() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  const methodsQuery = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api<{ methods: PaymentMethod[] }>('/v1/wallet/payment-methods'),
  });

  const addMutation = useMutation({
    mutationFn: () => {
      const digits = cardNumber.replace(/\s/g, '');
      const [mm, yy] = expiry.split('/');
      // Sandbox tokenization — production swaps in the gateway SDK's token.
      return api('/v1/wallet/payment-methods', {
        method: 'POST',
        body: {
          providerRef: `sandbox-tok-${Date.now()}`,
          brand: digits.startsWith('4') ? 'Visa' : digits.startsWith('5') ? 'Mastercard' : 'Card',
          last4: digits.slice(-4),
          expMonth: Number(mm),
          expYear: 2000 + Number(yy),
          isDefault: (methodsQuery.data?.methods ?? []).length === 0,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
      setAdding(false);
      setCardNumber('');
      setExpiry('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save the card.'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api(`/v1/wallet/payment-methods/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payment-methods'] }),
  });

  const digits = cardNumber.replace(/\s/g, '');
  const expiryValid = /^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry);
  const canSave = digits.length >= 13 && digits.length <= 19 && expiryValid;

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Payment Methods</Text>
        <Text style={styles.subtitle}>Manage the cards linked to your account.</Text>

        {/* Wallet is always the primary method */}
        <Card style={styles.walletRow}>
          <View style={styles.walletIcon}>
            <Ionicons name="wallet" size={22} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.methodTitle}>Voryn Wallet</Text>
            <Text style={styles.methodBody}>Primary account</Text>
          </View>
          <View style={styles.defaultBadge}>
            <Text style={styles.defaultBadgeText}>Default</Text>
          </View>
        </Card>

        {methodsQuery.isLoading ? <LoadingState label="Loading payment methods…" /> : null}
        {methodsQuery.isError ? <ErrorState onRetry={() => methodsQuery.refetch()} /> : null}
        {methodsQuery.isSuccess && (methodsQuery.data.methods ?? []).length === 0 && !adding ? (
          <EmptyState icon="card-outline" title="No cards yet" body="Add a card to top up faster." />
        ) : null}

        {(methodsQuery.data?.methods ?? []).map((method) => (
          <LinearGradient key={method.id} colors={gradients.banner} style={styles.cardTile}>
            <View style={styles.cardTop}>
              <Text style={styles.cardBrand}>{(method.brand ?? 'CARD').toUpperCase()}</Text>
              <Pressable
                hitSlop={8}
                onPress={() =>
                  setDialog({
                    title: 'Remove card',
                    message: `Remove ${method.brand} •••• ${method.last4}?`,
                    confirmLabel: 'Remove',
                    destructive: true,
                    onConfirm: () => removeMutation.mutate(method.id),
                  })
                }
              >
                <Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.85)" />
              </Pressable>
            </View>
            <Text style={styles.cardNumber}>•••• •••• •••• {method.last4}</Text>
            <View style={styles.cardBottom}>
              <Text style={styles.cardExpiry}>
                Expires {String(method.expMonth).padStart(2, '0')}/{String(method.expYear).slice(-2)}
              </Text>
              {method.isDefault ? <Text style={styles.cardDefault}>Default card</Text> : null}
            </View>
          </LinearGradient>
        ))}

        {adding ? (
          <Card style={styles.addCard}>
            <Text style={styles.addTitle}>Add a card</Text>
            <BrandTextField
              icon="card-outline"
              placeholder="Card number"
              keyboardType="number-pad"
              value={cardNumber}
              maxLength={23}
              onChangeText={(text) =>
                setCardNumber(
                  text
                    .replace(/[^0-9]/g, '')
                    .replace(/(.{4})/g, '$1 ')
                    .trim(),
                )
              }
            />
            <BrandTextField
              icon="calendar-outline"
              placeholder="Expiry (MM/YY)"
              keyboardType="number-pad"
              value={expiry}
              maxLength={5}
              onChangeText={(text) => {
                const raw = text.replace(/[^0-9]/g, '');
                setExpiry(raw.length > 2 ? `${raw.slice(0, 2)}/${raw.slice(2, 4)}` : raw);
              }}
            />
            <Text style={styles.tokenNote}>
              Card details are tokenized by the payment gateway — Voryn never stores your full card number.
            </Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <GradientButton
              title="Save card"
              icon="checkmark"
              loading={addMutation.isPending}
              disabled={!canSave}
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
            <Text style={styles.addRowText}>Add new method</Text>
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
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  walletIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  methodBody: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  defaultBadge: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  defaultBadgeText: { color: colors.blue, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  cardTile: { borderRadius: radius.lg, padding: spacing.base, marginBottom: spacing.md },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardBrand: { color: '#FFFFFF', fontWeight: fontWeight.heavy, fontSize: fontSize.md, letterSpacing: 1 },
  cardNumber: { color: '#FFFFFF', fontSize: fontSize.lg, fontWeight: fontWeight.bold, letterSpacing: 2, marginVertical: spacing.md },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  cardExpiry: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.sm },
  cardDefault: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.sm, fontWeight: fontWeight.bold },
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
  tokenNote: { fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: spacing.md },
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md },
  cancelRow: { alignItems: 'center', paddingVertical: spacing.md },
  cancelText: { color: colors.textSecondary, fontWeight: fontWeight.semibold },
});
