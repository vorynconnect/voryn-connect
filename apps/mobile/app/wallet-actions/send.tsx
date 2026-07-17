import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { BrandTextField } from '@/components/BrandTextField';
import { GradientButton } from '@/components/GradientButton';
import { AmountInput } from '@/features/wallet/AmountInput';
import { ActionResult } from '@/features/wallet/ActionResult';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmd } from '@/lib/format';
import type { WalletSnapshot } from '@/lib/types';

/**
 * Send / Transfer — wallet-to-wallet by phone number. Also the confirm step
 * for Scan to Pay, which pre-fills the recipient from the scanned QR code.
 */
export default function SendScreen() {
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ to?: string; name?: string }>();
  const [phone, setPhone] = useState(params.to ?? '');
  const [amountMinor, setAmountMinor] = useState(0);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => `send-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);

  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSnapshot>('/v1/wallet') });
  const balance = walletQuery.data?.wallet.balanceMinor ?? 0;
  const insufficient = amountMinor > balance;

  const sendMutation = useMutation({
    mutationFn: () =>
      api('/v1/wallet/transfer', {
        method: 'POST',
        body: { recipientPhone: phone.trim(), amountMinor, ...(note.trim() ? { note: note.trim() } : {}), idempotencyKey },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Transfer failed. Please try again.'),
  });

  if (sendMutation.isSuccess) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ScrollView contentContainerStyle={styles.container}>
          <ActionResult
            tone="success"
            title="Money sent"
            body={`Your transfer is on its way${params.name ? ` to ${params.name}` : ''}.`}
            detailRows={[
              { label: 'Recipient', value: params.name ?? phone.trim() },
              { label: 'Amount', value: formatJmd(amountMinor) },
              ...(note.trim() ? [{ label: 'Note', value: note.trim() }] : []),
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
        <Text style={styles.title}>{params.name ? `Pay ${params.name}` : 'Send Money'}</Text>
        <Text style={styles.subtitle}>Available balance: {formatJmd(balance)}</Text>

        <Text style={styles.sectionTitle}>Recipient</Text>
        <BrandTextField
          icon="call-outline"
          placeholder="Recipient phone number"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          editable={!params.to}
        />

        <AmountInput valueMinor={amountMinor} onChange={setAmountMinor} label="Amount to send" />

        <BrandTextField
          icon="chatbubble-ellipses-outline"
          placeholder="Add a note (optional)"
          value={note}
          onChangeText={setNote}
          maxLength={200}
        />

        {insufficient ? (
          <Text style={styles.errorText}>Insufficient wallet balance. Top up to send this amount.</Text>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <GradientButton
          title="Send now"
          trailingText={amountMinor > 0 ? formatJmd(amountMinor) : undefined}
          icon="paper-plane-outline"
          loading={sendMutation.isPending}
          disabled={amountMinor <= 0 || phone.trim().length < 7 || insufficient}
          onPress={() => {
            setError(null);
            sendMutation.mutate();
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
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md, textAlign: 'center' },
});
