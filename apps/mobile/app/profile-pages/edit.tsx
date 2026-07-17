import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ConfirmDialog, type DialogSpec } from '@/components/ConfirmDialog';
import { Avatar } from '@/components/Avatar';
import { BrandTextField } from '@/components/BrandTextField';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { pickAndUploadAvatar } from '@/lib/avatar';
import { useAuth, type CustomerProfile, type SessionUser } from '@/stores/auth';

/** Edit profile — personal info from the "My Profile" mockup header. */
export default function EditProfileScreen() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const profile = useAuth((s) => s.profile);
  const refreshMe = useAuth((s) => s.refreshMe);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  const avatarMutation = useMutation({
    mutationFn: pickAndUploadAvatar,
    onSuccess: async (result) => {
      if (result) await refreshMe();
    },
    onError: (err) =>
      setDialog({
        title: 'Photo upload failed',
        message: err instanceof ApiError ? err.message : 'Try a different image.',
      }),
  });

  const removeAvatarMutation = useMutation({
    mutationFn: () => api('/v1/users/me', { method: 'PATCH', body: { avatarUrl: null } }),
    onSuccess: () => refreshMe(),
    onError: (err) =>
      setDialog({
        title: 'Could not remove photo',
        message: err instanceof ApiError ? err.message : 'Try again.',
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      api<{ user: SessionUser; profile: CustomerProfile }>('/v1/users/me', {
        method: 'PATCH',
        body: {
          fullName: fullName.trim(),
          ...(username.trim() ? { username: username.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      await refreshMe();
      router.back();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save your profile.'),
  });

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Edit Profile</Text>
        <Text style={styles.subtitle}>Update your personal information.</Text>

        <Text style={styles.sectionTitle}>Profile photo</Text>
        <Card style={styles.photoCard}>
          <Avatar uri={profile?.avatarUrl} name={user?.fullName} size={74} />
          <View style={{ flex: 1 }}>
            <Text style={styles.photoHint}>
              Your photo shows on your profile{profile?.avatarUrl ? ' and to your driver or customer on trips' : ''}.
            </Text>
            <View style={styles.photoActions}>
              <Pressable
                style={styles.photoButton}
                disabled={avatarMutation.isPending}
                onPress={() => avatarMutation.mutate()}
              >
                <Ionicons name="camera-outline" size={15} color={colors.blue} />
                <Text style={styles.photoButtonText}>
                  {avatarMutation.isPending ? 'Uploading…' : profile?.avatarUrl ? 'Change photo' : 'Add photo'}
                </Text>
              </Pressable>
              {profile?.avatarUrl ? (
                <Pressable
                  style={styles.photoButton}
                  disabled={removeAvatarMutation.isPending}
                  onPress={() => removeAvatarMutation.mutate()}
                >
                  <Ionicons name="trash-outline" size={15} color={colors.danger} />
                  <Text style={[styles.photoButtonText, { color: colors.danger }]}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Card>

        <Text style={styles.sectionTitle}>Personal info</Text>
        <BrandTextField icon="person-outline" placeholder="Full name" value={fullName} onChangeText={setFullName} />
        <BrandTextField
          icon="at-outline"
          placeholder="Username (optional)"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />

        <Text style={styles.sectionTitle}>Contact</Text>
        <Card padded={false} style={styles.contactCard}>
          {[
            { icon: 'call-outline' as const, label: 'Phone', value: user?.phone ?? 'Not set', verified: user?.phoneVerified },
            { icon: 'mail-outline' as const, label: 'Email', value: user?.email ?? 'Not set', verified: user?.emailVerified },
          ].map((row, i) => (
            <View key={row.label} style={[styles.contactRow, i === 0 && styles.contactBorder]}>
              <View style={styles.contactIcon}>
                <Ionicons name={row.icon} size={18} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactLabel}>{row.label}</Text>
                <Text style={styles.contactValue}>{row.value}</Text>
              </View>
              {row.verified ? (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                  <Text style={styles.verifiedText}>Verified</Text>
                </View>
              ) : null}
            </View>
          ))}
        </Card>
        <Text style={styles.contactNote}>
          To change your phone or email, contact Support — we verify these for your security.
        </Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <GradientButton
          title="Save changes"
          icon="checkmark"
          loading={saveMutation.isPending}
          disabled={fullName.trim().length < 2}
          onPress={() => {
            setError(null);
            saveMutation.mutate();
          }}
        />
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
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  photoCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.base, marginBottom: spacing.sm },
  photoHint: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 19 },
  photoActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  photoButtonText: { color: colors.blue, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  contactCard: { marginBottom: spacing.sm },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  contactBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  contactIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  contactValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary, marginTop: 1 },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.successTint,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  verifiedText: { color: colors.success, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  contactNote: { fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: spacing.base },
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md, textAlign: 'center' },
});
