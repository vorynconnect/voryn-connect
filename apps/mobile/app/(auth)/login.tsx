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
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { BrandTextField } from '@/components/BrandTextField';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { useAuth, type SessionUser } from '@/stores/auth';

const schema = z.object({
  identifier: z.string().min(3, 'Enter your email or phone number'),
  password: z.string().min(1, 'Enter your password'),
});

type FormValues = z.infer<typeof schema>;

export default function LoginScreen() {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);
    try {
      const data = await api<{ accessToken: string; refreshToken: string; user: SessionUser }>(
        '/v1/auth/login',
        { method: 'POST', body: values, auth: false },
      );
      await setSession(data);
      router.replace('/(tabs)/home');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not log in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AuthBackdrop />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <BrandLogo height={58} />

        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to continue to Voryn Connect</Text>

        <View style={styles.form}>
          <Controller
            control={control}
            name="identifier"
            render={({ field }) => (
              <BrandTextField
                icon="person-outline"
                placeholder="Email or phone number"
                autoCapitalize="none"
                keyboardType="email-address"
                value={field.value}
                onChangeText={field.onChange}
                error={formState.errors.identifier?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field }) => (
              <BrandTextField
                icon="lock-closed-outline"
                placeholder="Password"
                isPassword
                value={field.value}
                onChangeText={field.onChange}
                error={formState.errors.password?.message}
              />
            )}
          />

          <Link href="/(auth)/forgot-password" asChild>
            <Pressable style={styles.forgotWrap}>
              <Text style={styles.link}>Forgot password?</Text>
            </Pressable>
          </Link>

          {formError ? <Text style={styles.formError}>{formError}</Text> : null}

          <GradientButton title="Log In" onPress={onSubmit} loading={submitting} />
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Don’t have an account? </Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable>
              <Text style={styles.link}>Sign Up</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 108,
    paddingBottom: spacing['2xl'],
  },
  title: {
    fontSize: 38,
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
  form: {},
  forgotWrap: { alignSelf: 'flex-end', marginBottom: spacing.lg },
  link: { color: colors.blue, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  formError: {
    color: colors.danger,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl },
  footerText: { color: colors.textSecondary, fontSize: fontSize.base },
});
