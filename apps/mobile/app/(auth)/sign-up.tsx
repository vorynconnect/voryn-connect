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
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { BrandTextField } from '@/components/BrandTextField';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';

const schema = z
  .object({
    fullName: z.string().min(2, 'Enter your full name'),
    email: z.string().email('Enter a valid email address'),
    phone: z.string().min(7, 'Enter a valid phone number'),
    password: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string(),
    acceptedTerms: z.boolean().refine((v) => v, 'You must accept the Terms & Privacy Policy'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

type FormValues = z.infer<typeof schema>;

export default function SignUpScreen() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { control, handleSubmit, formState, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      acceptedTerms: false,
    },
  });
  const accepted = watch('acceptedTerms');

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);
    try {
      await api('/v1/auth/signup', {
        method: 'POST',
        auth: false,
        body: {
          fullName: values.fullName,
          email: values.email,
          phone: values.phone,
          password: values.password,
          acceptedTerms: values.acceptedTerms,
        },
      });
      router.push({ pathname: '/(auth)/verify-otp', params: { identifier: values.phone } });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create your account.');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AuthBackdrop />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <BrandLogo height={54} />

        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>Sign up to start using Voryn Connect</Text>

        <Controller
          control={control}
          name="fullName"
          render={({ field }) => (
            <BrandTextField
              icon="person-outline"
              placeholder="Full name"
              value={field.value}
              onChangeText={field.onChange}
              error={formState.errors.fullName?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <BrandTextField
              icon="mail-outline"
              placeholder="Email address"
              autoCapitalize="none"
              keyboardType="email-address"
              value={field.value}
              onChangeText={field.onChange}
              error={formState.errors.email?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="phone"
          render={({ field }) => (
            <BrandTextField
              icon="call-outline"
              placeholder="Phone number"
              keyboardType="phone-pad"
              value={field.value}
              onChangeText={field.onChange}
              error={formState.errors.phone?.message}
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
        <Controller
          control={control}
          name="confirmPassword"
          render={({ field }) => (
            <BrandTextField
              icon="lock-closed-outline"
              placeholder="Confirm password"
              isPassword
              value={field.value}
              onChangeText={field.onChange}
              error={formState.errors.confirmPassword?.message}
            />
          )}
        />

        <Pressable
          style={styles.termsRow}
          onPress={() => setValue('acceptedTerms', !accepted, { shouldValidate: true })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
        >
          <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
            {accepted ? <Ionicons name="checkmark" size={16} color={colors.textOnBrand} /> : null}
          </View>
          <Text style={styles.termsText}>
            I agree to the <Text style={styles.link}>Terms &amp; Privacy Policy</Text>
          </Text>
        </Pressable>
        {formState.errors.acceptedTerms ? (
          <Text style={styles.formError}>{formState.errors.acceptedTerms.message}</Text>
        ) : null}
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}

        <GradientButton title="Create Account" onPress={onSubmit} loading={submitting} />

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
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 84,
    paddingBottom: spacing['2xl'],
  },
  title: {
    fontSize: 36,
    fontWeight: fontWeight.heavy,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    marginTop: spacing.xs,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    backgroundColor: colors.surface,
  },
  checkboxChecked: { backgroundColor: colors.blue },
  termsText: { color: colors.textPrimary, fontSize: fontSize.base },
  link: { color: colors.blue, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  formError: {
    color: colors.danger,
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
  },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl },
  footerText: { color: colors.textSecondary, fontSize: fontSize.base },
});
