import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { BrandTextField } from '@/components/BrandTextField';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';

const USES = [
  { key: 'rides', label: 'Rides', icon: 'car-outline' },
  { key: 'delivery', label: 'Delivery', icon: 'bicycle-outline' },
  { key: 'services', label: 'Services', icon: 'construct-outline' },
] as const;

/** Onboarding step 2 of 4 — "Complete your profile". */
export default function CompleteProfileScreen() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');
  const [primaryUse, setPrimaryUse] = useState<(typeof USES)[number]['key']>('rides');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api('/v1/users/me', {
        method: 'PATCH',
        body: {
          ...(username ? { username } : {}),
          ...(dateOfBirth ? { dateOfBirth } : {}),
          primaryUse,
        },
      });
      router.push({ pathname: '/(auth)/set-location', params: address ? { address } : {} });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AuthBackdrop />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.progressRow}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.progressBar, i === 1 && styles.progressActive]} />
          ))}
        </View>

        <BrandLogo height={52} />

        <Text style={styles.title}>Complete your profile</Text>
        <Text style={styles.subtitle}>Tell us a little about yourself</Text>

        <View style={styles.avatarWrap}>
          <View style={styles.avatarCircle}>
            <Ionicons name="person" size={64} color={colors.borderStrong} />
          </View>
          <View style={styles.cameraBadge}>
            <Ionicons name="camera" size={20} color={colors.textOnBrand} />
          </View>
          <Text style={styles.addPhoto}>Add profile photo</Text>
        </View>

        <BrandTextField
          icon="person-outline"
          placeholder="Username"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />
        <BrandTextField
          icon="calendar-outline"
          placeholder="Date of birth (YYYY-MM-DD)"
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
        />
        <BrandTextField
          icon="location-outline"
          placeholder="Address"
          value={address}
          onChangeText={setAddress}
        />

        <View style={styles.useCard}>
          <View style={styles.useHeader}>
            <View style={styles.useIconChip}>
              <Ionicons name="briefcase-outline" size={20} color={colors.blue} />
            </View>
            <Text style={styles.useLabel}>Primary use</Text>
            <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
          </View>
          <View style={styles.useOptions}>
            {USES.map((use) => {
              const active = primaryUse === use.key;
              return (
                <Pressable
                  key={use.key}
                  onPress={() => setPrimaryUse(use.key)}
                  style={[styles.usePill, active && styles.usePillActive]}
                >
                  <Ionicons
                    name={use.icon}
                    size={18}
                    color={active ? colors.blue : colors.textSecondary}
                  />
                  <Text style={[styles.usePillText, active && styles.usePillTextActive]}>{use.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GradientButton title="Continue" onPress={submit} loading={submitting} />

        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/(auth)/login" asChild>
            <Pressable>
              <Text style={styles.link}>Log In</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: 64, paddingBottom: spacing['2xl'] },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  progressBar: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border },
  progressActive: { backgroundColor: colors.blue },
  title: {
    fontSize: 34,
    fontWeight: fontWeight.heavy,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  avatarWrap: { alignItems: 'center', marginBottom: spacing.xl },
  avatarCircle: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.surface,
    borderWidth: 6,
    borderColor: '#EDF3FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 34,
    right: '30%',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.background,
  },
  addPhoto: { color: colors.blue, fontWeight: fontWeight.semibold, marginTop: spacing.sm, fontSize: fontSize.md },
  useCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.base,
    marginBottom: spacing.xl,
  },
  useHeader: { flexDirection: 'row', alignItems: 'center' },
  useIconChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  useLabel: { flex: 1, fontSize: fontSize.md, color: colors.textPrimary },
  useOptions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.base },
  usePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  usePillActive: { borderColor: colors.blue, backgroundColor: colors.skyTint },
  usePillText: { color: colors.textSecondary, fontSize: fontSize.base, fontWeight: fontWeight.medium },
  usePillTextActive: { color: colors.blue, fontWeight: fontWeight.semibold },
  error: { color: colors.danger, textAlign: 'center', marginBottom: spacing.md },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
  footerText: { color: colors.textSecondary, fontSize: fontSize.base },
  link: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
});
