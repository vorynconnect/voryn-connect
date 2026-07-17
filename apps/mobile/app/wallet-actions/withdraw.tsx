import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { AmountInput } from '@/features/wallet/AmountInput';
import { ActionResult } from '@/features/wallet/ActionResult';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { WalletSnapshot, WalletTransaction } from '@/lib/types';

/** Withdraw — move wallet funds out to the customer's bank. */
export default function WithdrawScreen() {
  const queryClient = useQueryClient();
  const [amountMinor, setAmountMinor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => `withdraw-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);

  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSnapshot>('/v1/wallet') });
  const balance = walletQuery.data?.wallet.balanceMinor ?? 0;
  const insufficient = amountMinor > balance;

  const withdrawMutation = useMutation({
    mutationFn: () =>
      api<{ transaction: WalletTransaction }>('/v1/wallet/withdraw', {
        method: 'POST',
        body: { amountMinor, idempotencyKey },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Withdrawal failed. Please try again.'),
  });

  if (withdrawMutation.isSuccess) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ScrollView contentContainerStyle={styles.container}>
          <ActionResult
            tone="pending"
            title="Withdrawal requested"
            body="Your withdrawal is being processed. Bank transfers usually arrive within 1–2 business days."
            detailRows={[
              { label: 'Amount', value: formatJmd(amountMinor) },
              { label: 'Remaining balance', value: formatJmd(withdrawMutation.data.transaction.balanceAfterMinor ?? 0) },
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
        <Text style={styles.title}>Withdraw</Text>
        <Text style={styles.subtitle}>Available balance: {formatJmd(balance)}</Text>

        <AmountInput valueMinor={amountMinor} onChange={setAmountMinor} label="Amount to withdraw" />

        <Card style={styles.bankCard}>
          <View style={styles.bankRow}>
            <View style={styles.bankIcon}>
              <Ionicons name="business-outline" size={20} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bankTitle}>Bank transfer</Text>
              <Text style={styles.bankBody}>Sent to your linked bank account • 1–2 business days</Text>
            </View>
          </View>
        </Card>

        {insufficient ? <Text style={styles.errorText}>Amount exceeds your wallet balance.</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <GradientButton
          title="Withdraw"
          trailingText={amountMinor > 0 ? formatJmd(amountMinor) : undefined}
          icon="arrow-up-outline"
          loading={withdrawMutation.isPending}
          disabled={amountMinor <= 0 || insufficient}
          onPress={() => {
            setError(null);
            withdrawMutation.mutate();
          }}
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
  bankCard: { marginBottom: spacing.base },
  bankRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bankIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  bankBody: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md, textAlign: 'center' },
});
