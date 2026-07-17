import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, gradients, radius, shadow, spacing } from '@/theme/tokens';

const FEATURES = [
  { icon: 'car-outline', label: 'Book rides' },
  { icon: 'bag-handle-outline', label: 'Order delivery' },
  { icon: 'shield-checkmark-outline', label: 'Access trusted local services' },
] as const;

/** Onboarding completion — "You're all set". */
export default function AllSetScreen() {
  const router = useRouter();

  return (
    <View style={styles.flex}>
      <AuthBackdrop />
      <ScrollView contentContainerStyle={styles.container}>
        <BrandLogo height={54} />

        <Text style={styles.title}>You’re all set</Text>
        <Text style={styles.subtitle}>Welcome to Voryn Connect</Text>

        <View style={styles.heroCard}>
          <LinearGradient colors={gradients.primary} style={styles.checkCircle}>
            <Ionicons name="checkmark" size={72} color={colors.textOnBrand} />
          </LinearGradient>
        </View>

        {FEATURES.map((feature) => (
          <View key={feature.label} style={styles.featureRow}>
            <View style={styles.featureIcon}>
              <Ionicons name={feature.icon} size={22} color={colors.blue} />
            </View>
            <Text style={styles.featureLabel}>{feature.label}</Text>
          </View>
        ))}

        <GradientButton
          title="Get Started"
          onPress={() => router.replace('/(tabs)/home')}
          style={styles.cta}
        />

        <Pressable onPress={() => router.replace('/(tabs)/services')} style={styles.exploreWrap}>
          <Text style={styles.explore}>Explore app features</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: 88, paddingBottom: spacing['2xl'] },
  title: {
    fontSize: 40,
    fontWeight: fontWeight.heavy,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  subtitle: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    ...shadow.card,
  },
  checkCircle: {
    width: 168,
    height: 168,
    borderRadius: 84,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.cta,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  featureLabel: { fontSize: fontSize.md, color: colors.textPrimary, fontWeight: fontWeight.medium },
  cta: { marginTop: spacing.lg },
  exploreWrap: { alignItems: 'center', marginTop: spacing.lg },
  explore: { color: colors.blue, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
