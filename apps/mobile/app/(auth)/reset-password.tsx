import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { BrandTextField } from '@/components/BrandTextField';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, shadow, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { identifier } = useLocalSearchParams<{ identifier: string }>();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  const submit = async () => {
    if (code.length !== 6) return setError('Enter the 6-digit code');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    setError(null);
    try {
      await api('/v1/auth/reset-password', {
        method: 'POST',
        auth: false,
        body: { identifier, code, newPassword: password },
      });
      setDialog({ title: 'Password updated', message: 'Log in with your new password.' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password.');
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
        <Text style={styles.title}>Reset password</Text>
        <Text style={styles.subtitle}>Enter the code we sent and choose a new password</Text>

        <BrandTextField
          icon="keypad-outline"
          placeholder="6-digit code"
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={setCode}
        />
        <BrandTextField
          icon="lock-closed-outline"
          placeholder="New password"
          isPassword
          value={password}
          onChangeText={setPassword}
        />
        <BrandTextField
          icon="lock-closed-outline"
          placeholder="Confirm new password"
          isPassword
          value={confirm}
          onChangeText={setConfirm}
          error={error ?? undefined}
        />

        <GradientButton title="Reset Password" onPress={submit} loading={busy} />
      </ScrollView>
      <ConfirmDialog
        spec={dialog}
        onClose={() => {
          setDialog(null);
          router.replace('/(auth)/login');
        }}
      />
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
  },
});
