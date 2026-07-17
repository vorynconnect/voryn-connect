import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';
import { useAuth, type SessionUser } from '@/stores/auth';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

export default function VerifyOtpScreen() {
  const router = useRouter();
  const { identifier } = useLocalSearchParams<{ identifier: string }>();
  const setSession = useAuth((s) => s.setSession);

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const inputs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  const setDigit = (index: number, value: string) => {
    const clean = value.replace(/\D/g, '');
    setDigits((prev) => {
      const next = [...prev];
      if (clean.length > 1) {
        // Paste of the whole code
        clean.split('').slice(0, OTP_LENGTH).forEach((c, i) => (next[i] = c));
      } else {
        next[index] = clean;
      }
      return next;
    });
    if (clean && index < OTP_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  const onKeyPress = (index: number, key: string) => {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const code = digits.join('');

  const verify = async () => {
    if (code.length !== OTP_LENGTH || !identifier) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await api<{ accessToken: string; refreshToken: string; user: SessionUser }>(
        '/v1/auth/verify-otp',
        { method: 'POST', auth: false, body: { identifier, code } },
      );
      await setSession(data);
      router.replace('/(auth)/complete-profile');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async (channel: 'SMS' | 'EMAIL') => {
    if (!identifier) return;
    setError(null);
    try {
      await api('/v1/auth/resend-otp', {
        method: 'POST',
        auth: false,
        body: { identifier, purpose: 'SIGNUP', channel },
      });
      setSecondsLeft(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resend the code.');
    }
  };

  const timerLabel = `00:${String(secondsLeft).padStart(2, '0')}`;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AuthBackdrop />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <BrandLogo height={54} />

        <Text style={styles.title}>Verify your account</Text>
        <Text style={styles.subtitle}>Enter the 6-digit code sent to your phone</Text>

        <View style={styles.otpRow}>
          {digits.map((digit, i) => (
            <TextInput
              key={i}
              ref={(r) => {
                inputs.current[i] = r;
              }}
              style={[styles.otpBox, digit ? styles.otpBoxFilled : null]}
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
              value={digit}
              onChangeText={(v) => setDigit(i, v)}
              onKeyPress={({ nativeEvent }) => onKeyPress(i, nativeEvent.key)}
              autoFocus={i === 0}
              selectTextOnFocus
              accessibilityLabel={`Digit ${i + 1}`}
            />
          ))}
        </View>

        <View style={styles.sentToCard}>
          <View style={styles.sentToIcon}>
            <Ionicons name="phone-portrait-outline" size={20} color={colors.blue} />
          </View>
          <Text style={styles.sentToText}>
            Code sent to <Text style={styles.sentToStrong}>{identifier}</Text>
          </Text>
        </View>

        {secondsLeft > 0 ? (
          <Text style={styles.resendTimer}>
            Resend code in <Text style={styles.timer}>{timerLabel}</Text>
          </Text>
        ) : (
          <Pressable onPress={() => resend('SMS')}>
            <Text style={styles.resendLink}>Resend code</Text>
          </Pressable>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GradientButton
          title="Verify & Continue"
          onPress={verify}
          loading={submitting}
          disabled={code.length !== OTP_LENGTH}
          style={styles.cta}
        />

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable style={styles.emailInstead} onPress={() => resend('EMAIL')}>
          <View style={styles.sentToIcon}>
            <Ionicons name="mail-outline" size={20} color={colors.blue} />
          </View>
          <Text style={styles.emailInsteadText}>Use email instead</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: 96, paddingBottom: spacing['2xl'] },
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
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  otpBox: {
    flex: 1,
    height: 74,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    textAlign: 'center',
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    ...shadow.card,
  },
  otpBoxFilled: { borderColor: colors.blue },
  sentToCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginTop: spacing.xl,
  },
  sentToIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  sentToText: { color: colors.textSecondary, fontSize: fontSize.base },
  sentToStrong: { color: colors.textPrimary, fontWeight: fontWeight.bold },
  resendTimer: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.xl, fontSize: fontSize.base },
  timer: { color: colors.blue, fontWeight: fontWeight.semibold },
  resendLink: {
    textAlign: 'center',
    color: colors.blue,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.xl,
    fontSize: fontSize.md,
  },
  error: { color: colors.danger, textAlign: 'center', marginTop: spacing.md },
  cta: { marginTop: spacing['2xl'] },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xl },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  dividerText: { color: colors.textSecondary, marginHorizontal: spacing.md },
  emailInstead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  emailInsteadText: { color: colors.blue, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
