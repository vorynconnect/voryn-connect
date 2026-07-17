import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';

const TIPS = [
  {
    icon: 'pin-outline' as const,
    title: 'Share your trip',
    body: 'Every active trip has trip sharing so someone you trust can follow along.',
  },
  {
    icon: 'keypad-outline' as const,
    title: 'Verify the trip PIN',
    body: 'Confirm the PIN with your rider before starting — it proves you have the right person.',
  },
  {
    icon: 'call-outline' as const,
    title: 'Keep contact in the app',
    body: 'Use in-app chat and calls so your personal number stays private.',
  },
  {
    icon: 'moon-outline' as const,
    title: 'Take breaks',
    body: 'Go offline any time from the dashboard — requests pause until you return.',
  },
];

/** Safety center — emergency contacts and partner safety guidance. */
export default function SafetyCenterScreen() {
  const router = useRouter();

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Safety center</Text>
        <Text style={styles.subtitle}>Help is available 24/7, on and off trips.</Text>

        {/* Emergency */}
        <Pressable style={styles.emergencyCard} onPress={() => Linking.openURL('tel:119')}>
          <View style={styles.emergencyIcon}>
            <Ionicons name="call" size={24} color={colors.textOnBrand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.emergencyTitle}>Emergency — call 119</Text>
            <Text style={styles.emergencyBody}>Jamaica police & emergency services</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.danger} />
        </Pressable>

        <Card style={styles.supportCard}>
          <View style={styles.supportIcon}>
            <Ionicons name="headset-outline" size={22} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.supportTitle}>Voryn partner support</Text>
            <Text style={styles.supportBody}>Report an incident or get help with a trip.</Text>
          </View>
          <Pressable style={styles.supportButton} onPress={() => router.push('/profile-pages/support')}>
            <Text style={styles.supportButtonText}>Get help</Text>
          </Pressable>
        </Card>

        <Text style={styles.sectionTitle}>Staying safe on the road</Text>
        <Card padded={false} style={styles.tipsCard}>
          {TIPS.map((tip, i) => (
            <View key={tip.title} style={[styles.tipRow, i < TIPS.length - 1 && styles.tipBorder]}>
              <View style={styles.tipIcon}>
                <Ionicons name={tip.icon} size={19} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.tipTitle}>{tip.title}</Text>
                <Text style={styles.tipBody}>{tip.body}</Text>
              </View>
            </View>
          ))}
        </Card>

        <Card style={styles.protectedCard}>
          <Ionicons name="shield-checkmark" size={22} color={colors.blue} />
          <Text style={styles.protectedText}>
            Every trip is tracked end-to-end and covered by Voryn partner protection.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: 26, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 3, marginBottom: spacing.base },
  emergencyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.dangerTint,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  emergencyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyTitle: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.danger },
  emergencyBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  supportCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.base },
  supportIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportTitle: { fontSize: fontSize.base, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  supportBody: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  supportButton: {
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm + 2,
  },
  supportButtonText: { color: colors.textOnBrand, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.heavy,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  tipsCard: { marginBottom: spacing.md },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.base },
  tipBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tipIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  tipBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, lineHeight: 19 },
  protectedCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.skyTint },
  protectedText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
});
