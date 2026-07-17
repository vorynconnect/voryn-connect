import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { Card } from '@/components/Card';
import { BrandTextField } from '@/components/BrandTextField';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import type { WalletSnapshot } from '@/lib/types';

/** Privacy & security — password, wallet PIN, and account controls. */
export default function SecurityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = useAuth((s) => s.signOut);

  const walletQuery = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletSnapshot>('/v1/wallet') });
  const hasPin = walletQuery.data?.wallet.hasPin ?? false;

  const [section, setSection] = useState<'none' | 'password' | 'pin'>('none');
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const passwordMutation = useMutation({
    mutationFn: () =>
      api('/v1/users/me/password', { method: 'POST', body: { currentPassword, newPassword } }),
    onSuccess: () => {
      setSection('none');
      setCurrentPassword('');
      setNewPassword('');
      setDialog({ title: 'Password updated', message: 'Other devices have been signed out for your security.' });
    },
    onError: (err) =>
      setPasswordError(err instanceof ApiError ? err.message : 'Could not update your password.'),
  });

  // PIN form
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const pinMutation = useMutation({
    mutationFn: () =>
      api('/v1/wallet/pin', {
        method: 'POST',
        body: { ...(hasPin ? { currentPin } : {}), newPin },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      setSection('none');
      setCurrentPin('');
      setNewPin('');
      setDialog({ title: 'Wallet PIN saved', message: 'Your PIN now protects wallet payments.' });
    },
    onError: (err) => setPinError(err instanceof ApiError ? err.message : 'Could not save your PIN.'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api('/v1/users/me', { method: 'DELETE' }),
    onSuccess: async () => {
      await signOut();
      router.replace('/(auth)/login');
    },
    onError: () =>
      setDialog({ title: 'Could not delete account', message: 'Please try again or contact support.' }),
  });

  const confirmDelete = () =>
    setDialog({
      title: 'Delete account?',
      message: 'This permanently closes your Voryn Connect account. Your wallet must be empty first.',
      confirmLabel: 'Delete account',
      destructive: true,
      onConfirm: () => deleteMutation.mutate(),
    });

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Privacy & Security</Text>
        <Text style={styles.subtitle}>Password, PIN, and account safety.</Text>

        <Card padded={false} style={styles.listCard}>
          <Pressable
            style={[styles.row, styles.rowBorder]}
            onPress={() => setSection(section === 'password' ? 'none' : 'password')}
          >
            <View style={styles.rowIcon}>
              <Ionicons name="key-outline" size={19} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Change password</Text>
              <Text style={styles.rowBody}>Signs out your other devices</Text>
            </View>
            <Ionicons name={section === 'password' ? 'chevron-up' : 'chevron-forward'} size={17} color={colors.textSecondary} />
          </Pressable>
          {section === 'password' ? (
            <View style={styles.form}>
              <BrandTextField icon="lock-closed-outline" placeholder="Current password" isPassword value={currentPassword} onChangeText={setCurrentPassword} />
              <BrandTextField icon="lock-closed-outline" placeholder="New password (min 8 characters)" isPassword value={newPassword} onChangeText={setNewPassword} />
              {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
              <GradientButton
                title="Update password"
                icon="checkmark"
                loading={passwordMutation.isPending}
                disabled={currentPassword.length < 1 || newPassword.length < 8}
                onPress={() => {
                  setPasswordError(null);
                  passwordMutation.mutate();
                }}
              />
            </View>
          ) : null}

          <Pressable
            style={[styles.row, styles.rowBorder]}
            onPress={() => setSection(section === 'pin' ? 'none' : 'pin')}
          >
            <View style={styles.rowIcon}>
              <Ionicons name="keypad-outline" size={19} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{hasPin ? 'Change wallet PIN' : 'Set wallet PIN'}</Text>
              <Text style={styles.rowBody}>
                {hasPin ? 'PIN protection is on' : 'Add a 4-digit PIN for wallet payments'}
              </Text>
            </View>
            {hasPin ? (
              <View style={styles.onBadge}>
                <Text style={styles.onBadgeText}>On</Text>
              </View>
            ) : null}
            <Ionicons name={section === 'pin' ? 'chevron-up' : 'chevron-forward'} size={17} color={colors.textSecondary} />
          </Pressable>
          {section === 'pin' ? (
            <View style={styles.form}>
              {hasPin ? (
                <BrandTextField icon="keypad-outline" placeholder="Current PIN" isPassword keyboardType="number-pad" maxLength={4} value={currentPin} onChangeText={setCurrentPin} />
              ) : null}
              <BrandTextField icon="keypad-outline" placeholder="New 4-digit PIN" isPassword keyboardType="number-pad" maxLength={4} value={newPin} onChangeText={setNewPin} />
              {pinError ? <Text style={styles.errorText}>{pinError}</Text> : null}
              <GradientButton
                title="Save PIN"
                icon="checkmark"
                loading={pinMutation.isPending}
                disabled={newPin.length !== 4 || (hasPin && currentPin.length !== 4)}
                onPress={() => {
                  setPinError(null);
                  pinMutation.mutate();
                }}
              />
            </View>
          ) : null}

          <Pressable style={styles.row} onPress={() => router.push('/(auth)/forgot-password')}>
            <View style={styles.rowIcon}>
              <Ionicons name="help-circle-outline" size={19} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Forgot password</Text>
              <Text style={styles.rowBody}>Reset it with a verification code</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
          </Pressable>
        </Card>

        <Text style={styles.sectionTitle}>Account</Text>
        <Card padded={false} style={styles.listCard}>
          <Pressable style={styles.row} onPress={confirmDelete}>
            <View style={[styles.rowIcon, { backgroundColor: colors.dangerTint }]}>
              <Ionicons name="trash-outline" size={19} color={colors.danger} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.danger }]}>Delete account</Text>
              <Text style={styles.rowBody}>Permanently close your account</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
          </Pressable>
        </Card>
      </ScrollView>
      <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  listCard: { marginBottom: spacing.base },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  rowBody: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  onBadge: {
    backgroundColor: colors.successTint,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  onBadgeText: { color: colors.success, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  form: { padding: spacing.base, paddingTop: 0 },
  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md },
});
