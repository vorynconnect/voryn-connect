import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { colors, fontSize, spacing } from '@/theme/tokens';
import { useAuth } from '@/stores/auth';

/**
 * Splash / session-restore screen (mockup: auth/splash).
 * Shows the official logo + tagline + spinner while the session restores,
 * then routes to the tabs or the login screen.
 */
export default function SplashScreen() {
  const status = useAuth((s) => s.status);
  const router = useRouter();

  useEffect(() => {
    if (status === 'signedIn') router.replace('/(tabs)/home');
    if (status === 'signedOut') router.replace('/(auth)/login');
  }, [status, router]);

  return (
    <View style={styles.container}>
      <AuthBackdrop />
      <View style={styles.center}>
        <BrandLogo height={92} />
      </View>
      <View style={styles.footer}>
        <Text style={styles.tagline}>One app. Every need.</Text>
        <ActivityIndicator color={colors.blue} style={{ marginTop: spacing.xl }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { alignItems: 'center', paddingBottom: 96 },
  tagline: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
  },
});
