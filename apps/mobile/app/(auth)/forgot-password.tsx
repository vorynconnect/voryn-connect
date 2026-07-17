import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { BrandTextField } from '@/components/BrandTextField';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, shadow, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (identifier.trim().length < 3) {
      setError('Enter your email or phone number');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/v1/auth/forgot-password', {
        method: 'POST',
        auth: false,
        body: { identifier: identifier.trim() },
      });
      router.push({ pathname: '/(auth)/reset-password', params: { identifier: identifier.trim() } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the reset code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <AuthBackdrop />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <BrandLogo height={54} />
        <Text style={styles.title}>Forgot password</Text>
        <Text style={styles.subtitle}>
          Enter your email or phone number and we’ll send you a reset code
        </Text>

        <BrandTextField
          icon="person-outline"
          placeholder="Email or phone number"
          autoCapitalize="none"
          keyboardType="email-address"
          value={identifier}
          onChangeText={setIdentifier}
          error={error ?? undefined}
        />

        <GradientButton title="Send Reset Code" onPress={submit} loading={busy} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: 108, paddingBottom: spacing['2xl'] },
  backButton: {
    position: 'absolute',
    top: 58,
    left: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
    zIndex: 2,
  },
  title: {
    fontSize: 34,
    fontWeight: fontWeight.heavy,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing['2xl'],
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing['2xl'],
    lineHeight: 24,
  },
});
