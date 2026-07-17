import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { AmountInput } from '@/features/wallet/AmountInput';
import { ActionResult } from '@/features/wallet/ActionResult';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { PaymentMethod, WalletSnapshot, WalletTransaction } from '@/lib/types';

/** Top Up — fund the wallet from a card; credit lands only after capture. */
export default function TopUpScreen() {
  const queryClient = useQueryClient();
  const [amountMinor, setAmountMinor] = useState(0);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => `topup-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);

  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSnapshot>('/v1/wallet') });
  const methodsQuery = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api<{ methods: PaymentMethod[] }>('/v1/wallet/payment-methods'),
  });
  const cards = (methodsQuery.data?.methods ?? []).filter((m) => m.type === 'CARD');

  const topUpMutation = useMutation({
    mutationFn: () =>
      api<{ payment: { id: string }; transaction: WalletTransaction }>('/v1/wallet/top-up', {
        method: 'POST',
        body: { amountMinor, ...(methodId ? { paymentMethodId: methodId } : {}), idempotencyKey },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Top up failed. Please try again.'),
  });

  if (topUpMutation.isSuccess) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ScrollView contentContainerStyle={styles.container}>
          <ActionResult
            tone="success"
            title="Top up complete"
            body="Your Voryn Wallet has been credited."
            detailRows={[
              { label: 'Amount', value: formatJmd(amountMinor) },
              { label: 'New balance', value: formatJmd(topUpMutation.data.transaction.balanceAfterMinor ?? 0) },
            ]}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Top Up</Text>
        <Text style={styles.subtitle}>
          Current balance: {formatJmd(walletQuery.data?.wallet.balanceMinor ?? 0)}
        </Text>

        <AmountInput valueMinor={amountMinor} onChange={setAmountMinor} label="Amount to add" />

        <Text style={styles.sectionTitle}>Pay with</Text>
        <Card padded={false} style={styles.methodCard}>
          <Pressable style={[styles.methodRow, !methodId && styles.methodActive]} onPress={() => setMethodId(null)}>
            <View style={styles.methodIcon}>
              <Ionicons name="card-outline" size={20} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.methodTitle}>New card (sandbox)</Text>
              <Text style={styles.methodBody}>Secure card capture via the payment gateway</Text>
            </View>
            <View style={[styles.radio, !methodId && styles.radioActive]}>
              {!methodId ? <View style={styles.radioDot} /> : null}
            </View>
          </Pressable>
          {cards.map((card) => {
            const active = methodId === card.id;
            return (
              <Pressable key={card.id} style={[styles.methodRow, styles.methodBorder, active && styles.methodActive]} onPress={() => setMethodId(card.id)}>
                <View style={styles.methodIcon}>
                  <Ionicons name="card" size={20} color={colors.blue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.methodTitle}>
                    {(card.brand ?? 'Card').toUpperCase()} •••• {card.last4}
                  </Text>
                  <Text style={styles.methodBody}>
                    Expires {String(card.expMonth).padStart(2, '0')}/{String(card.expYear).slice(-2)}
                  </Text>
                </View>
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
              </Pressable>
            );
          })}
        </Card>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <GradientButton
          title="Top up"
          trailingText={amountMinor > 0 ? formatJmd(amountMinor) : undefined}
          icon="add-circle-outline"
          loading={topUpMutation.isPending}
          disabled={amountMinor <= 0}
          onPress={() => {
            setError(null);
            topUpMutation.mutate();
          }}
        />
        <View style={styles.secureRow}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.secureText}>Secure, encrypted and trusted</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  methodCard: { marginBottom: spacing.base },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  methodBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  methodActive: { backgroundColor: '#F4F9FF' },
  methodIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  methodBody: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
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
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md, textAlign: 'center' },
  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: spacing.base },
  secureText: { fontSize: fontSize.xs, color: colors.textSecondary },
});
