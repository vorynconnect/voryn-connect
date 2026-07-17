import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';

const BILLERS = [
  { name: 'JPS', body: 'Electricity', icon: 'flash-outline' as const },
  { name: 'NWC', body: 'Water', icon: 'water-outline' as const },
  { name: 'Flow', body: 'Internet & cable', icon: 'wifi-outline' as const },
  { name: 'Digicel', body: 'Mobile top-up', icon: 'phone-portrait-outline' as const },
];

/**
 * Bills & utilities — biller integrations are not live yet, so this screen
 * is honest about that instead of simulating payments.
 */
export default function BillsScreen() {
  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <View style={styles.container}>
        <Text style={styles.title}>Bills & Utilities</Text>
        <Text style={styles.subtitle}>Pay your household bills straight from your Voryn Wallet.</Text>

        <Card style={styles.comingCard}>
          <View style={styles.comingIcon}>
            <Ionicons name="construct-outline" size={26} color={colors.blue} />
          </View>
          <Text style={styles.comingTitle}>Coming soon</Text>
          <Text style={styles.comingBody}>
            We’re connecting with Jamaica’s billers now. You’ll be able to pay these providers directly from your
            wallet:
          </Text>
        </Card>

        {BILLERS.map((biller) => (
          <Card key={biller.name} style={styles.billerRow}>
            <View style={styles.billerIcon}>
              <Ionicons name={biller.icon} size={20} color={colors.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.billerName}>{biller.name}</Text>
              <Text style={styles.billerBody}>{biller.body}</Text>
            </View>
            <View style={styles.soonBadge}>
              <Text style={styles.soonText}>Soon</Text>
            </View>
          </Card>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg },
  comingCard: { alignItems: 'center', paddingVertical: spacing.lg, marginBottom: spacing.base },
  comingIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  comingTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  comingBody: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  billerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  billerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  billerName: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  billerBody: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  soonBadge: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  soonText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
});
