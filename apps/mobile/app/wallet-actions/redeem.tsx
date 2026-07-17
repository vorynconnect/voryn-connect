import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { ActionResult } from '@/features/wallet/ActionResult';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { formatJmd, formatPoints } from '@/lib/format';
import type { WalletSnapshot } from '@/lib/types';

/** Mirrors the backend conversion: 500 pts = JMD 250 (1 pt = 50 minor). */
const MINOR_PER_POINT = 50;
const REDEEM_OPTIONS = [500, 1000, 2000, 5000];

/** Redeem points — convert loyalty points into Voryn Wallet credit. */
export default function RedeemScreen() {
  const queryClient = useQueryClient();
  const [points, setPoints] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => `redeem-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);

  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSnapshot>('/v1/wallet') });
  const pointsBalance = walletQuery.data?.loyalty.pointsBalance ?? 0;

  const redeemMutation = useMutation({
    mutationFn: (redeemPoints: number) =>
      api('/v1/wallet/redeem-points', { method: 'POST', body: { points: redeemPoints, idempotencyKey } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not redeem your points.'),
  });

  if (redeemMutation.isSuccess && points) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ScrollView contentContainerStyle={styles.container}>
          <ActionResult
            tone="success"
            title="Points redeemed"
            body="Your wallet has been credited."
            detailRows={[
              { label: 'Points used', value: formatPoints(points) },
              { label: 'Wallet credit', value: formatJmd(points * MINOR_PER_POINT) },
            ]}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Redeem Points</Text>
        <Text style={styles.subtitle}>500 pts = JMD 250 in wallet credit</Text>

        <Card style={styles.balanceCard}>
          <View style={styles.balanceIcon}>
            <Ionicons name="star" size={22} color={colors.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.balanceLabel}>Your rewards balance</Text>
            <Text style={styles.balanceValue}>{formatPoints(pointsBalance)}</Text>
          </View>
        </Card>

        <Text style={styles.sectionTitle}>Choose an amount</Text>
        <View style={styles.optionsGrid}>
          {REDEEM_OPTIONS.map((option) => {
            const affordable = pointsBalance >= option;
            const active = points === option;
            return (
              <Pressable
                key={option}
                style={[styles.option, active && styles.optionActive, !affordable && styles.optionDisabled]}
                disabled={!affordable}
                onPress={() => setPoints(option)}
              >
                <Text style={[styles.optionPoints, active && styles.optionTextActive]}>{formatPoints(option)}</Text>
                <Text style={[styles.optionValue, active && styles.optionTextActive]}>
                  {formatJmd(option * MINOR_PER_POINT)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {pointsBalance < REDEEM_OPTIONS[0]! ? (
          <Text style={styles.hintText}>
            You need at least {formatPoints(REDEEM_OPTIONS[0]!)} to redeem. Earn points on every order.
          </Text>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <GradientButton
          title="Redeem now"
          trailingText={points ? formatJmd(points * MINOR_PER_POINT) : undefined}
          icon="gift-outline"
          loading={redeemMutation.isPending}
          disabled={!points}
          onPress={() => {
            if (!points) return;
            setError(null);
            redeemMutation.mutate(points);
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
  balanceCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  balanceIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.warningTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  balanceValue: { fontSize: fontSize.xl, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.base },
  option: {
    width: '47%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.base,
  },
  optionActive: { borderColor: colors.blue, backgroundColor: '#F4F9FF' },
  optionDisabled: { opacity: 0.45 },
  optionPoints: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  optionValue: { fontSize: fontSize.sm, color: colors.textSecondary },
  optionTextActive: { color: colors.blue },
  hintText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md, textAlign: 'center' },
});
