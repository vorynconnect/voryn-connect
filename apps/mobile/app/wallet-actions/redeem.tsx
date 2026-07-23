import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';
import { formatJmd, formatPoints } from '@/lib/format';
import type { WalletSnapshot } from '@/lib/types';

/**
 * Voryn Points explainer. Points are loyalty rewards redeemed at checkout as
 * discounts — they are not stored money and cannot be converted to wallet
 * cash, used for tips, or withdrawn.
 */
export default function RedeemScreen() {
  const router = useRouter();
  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSnapshot>('/v1/wallet') });
  const loyalty = walletQuery.data?.loyalty;
  const pointsBalance = loyalty?.pointsBalance ?? 0;
  const valueMinor = loyalty?.pointValueMinor ?? 100;
  const maxPercent = loyalty?.maxRedeemPercent ?? 20;
  const minOrder = loyalty?.minOrderMinor ?? 150000;
  const tier = loyalty?.tier ?? 'BRONZE';
  const tierMultiplier = loyalty?.tierMultiplier ?? 1;
  const expiringPoints = loyalty?.expiringPoints ?? 0;
  const expiringAt = loyalty?.expiringAt ? new Date(loyalty.expiringAt) : null;
  const tierLabel = tier.charAt(0) + tier.slice(1).toLowerCase();

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Voryn Points</Text>
        <Text style={styles.subtitle}>Earn on every order. Redeem at checkout.</Text>

        <Card style={styles.balanceCard}>
          <View style={styles.balanceIcon}>
            <Ionicons name="star" size={22} color={colors.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.balanceLabel}>Your points balance</Text>
            <Text style={styles.balanceValue}>{formatPoints(pointsBalance)}</Text>
            <Text style={styles.balanceWorth}>
              Worth up to {formatJmd(pointsBalance * valueMinor)} in discounts
            </Text>
          </View>
          <View style={styles.tierBadge}>
            <Text style={styles.tierBadgeText}>{tierLabel}</Text>
          </View>
        </Card>

        {expiringPoints > 0 && expiringAt ? (
          <View style={styles.expiryRow}>
            <Ionicons name="alert-circle" size={17} color={colors.warning} />
            <Text style={styles.expiryText}>
              {formatPoints(expiringPoints)} expire on{' '}
              {expiringAt.toLocaleDateString('en-JM', { day: 'numeric', month: 'long' })}. Use them
              on your next order.
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>How points work</Text>
        <Card padded={false} style={styles.rulesCard}>
          {[
            {
              icon: 'cart' as const,
              title: `Earn ${tierMultiplier === 1 ? '1 point' : `${tierMultiplier}x points`} per JMD 100 spent`,
              body:
                tierMultiplier === 1
                  ? 'You earn on the items in your orders, bookings and rides. Taxes, fees and tips do not earn points. Home services and rentals earn faster.'
                  : `Your ${tierLabel} tier earns ${tierMultiplier}x on every eligible purchase. Taxes, fees and tips do not earn points.`,
            },
            {
              icon: 'pricetag' as const,
              title: '1 point = JMD 1 off at checkout',
              body: `Flip the "Redeem points" switch when you pay. You can cover up to ${maxPercent}% of an eligible order over ${formatJmd(minOrder)}.`,
            },
            {
              icon: 'heart' as const,
              title: 'Tips always go through in full',
              body: 'Points never reduce a tip. 100% of what you tip reaches the person who earned it.',
            },
            {
              icon: 'time' as const,
              title: 'Points last 12 months',
              body: 'Stay active and they never expire. We will remind you 30 days before any points lapse.',
            },
          ].map((rule, i, arr) => (
            <View key={rule.title} style={[styles.ruleRow, i < arr.length - 1 && styles.ruleBorder]}>
              <View style={styles.ruleIcon}>
                <Ionicons name={rule.icon} size={19} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ruleTitle}>{rule.title}</Text>
                <Text style={styles.ruleBody}>{rule.body}</Text>
              </View>
            </View>
          ))}
        </Card>

        <View style={styles.noteRow}>
          <Ionicons name="information-circle-outline" size={17} color={colors.textSecondary} />
          <Text style={styles.noteText}>
            Points are loyalty rewards, not money. They cannot be converted to wallet cash or withdrawn.
          </Text>
        </View>

        <GradientButton
          title="Start an order and save"
          icon="restaurant-outline"
          onPress={() => router.push('/delivery')}
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
  balanceWorth: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  tierBadge: {
    backgroundColor: colors.skyTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tierBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.blue },
  expiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningTint,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.base,
  },
  expiryText: { flex: 1, fontSize: fontSize.xs, color: colors.textPrimary, lineHeight: 17 },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  rulesCard: { marginBottom: spacing.base },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.base },
  ruleBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  ruleIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  ruleBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, lineHeight: 19 },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.base,
  },
  noteText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
});
