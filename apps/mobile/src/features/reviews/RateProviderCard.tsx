import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { api, ApiError } from '@/lib/api';

type Props = {
  providerId: string;
  subjectType: 'PROVIDER' | 'RIDE_TRIP' | 'ORDER' | 'SERVICE_BOOKING' | 'RENTAL_RESERVATION';
  subjectId: string;
  title: string;
  subtitle?: string;
};

/** Star rating + feedback card shown on every completion screen. */
export function RateProviderCard({ providerId, subjectType, subjectId, title, subtitle }: Props) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (rating === 0) {
      setError('Tap a star to rate.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api('/v1/reviews', {
        method: 'POST',
        body: { subjectType, subjectId, providerId, rating, comment: comment || undefined },
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your review.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Card style={styles.card}>
        <View style={styles.doneRow}>
          <Ionicons name="checkmark-circle" size={28} color={colors.success} />
          <Text style={styles.doneText}>Thanks for your feedback!</Text>
        </View>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle ?? 'Rate your experience and help us improve.'}</Text>
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable key={star} onPress={() => setRating(star)} hitSlop={6}>
            <Ionicons
              name={star <= rating ? 'star' : 'star-outline'}
              size={38}
              color={star <= rating ? colors.blue : colors.borderStrong}
            />
          </Pressable>
        ))}
      </View>
      <View style={styles.inputWrap}>
        <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="Share additional feedback (optional)"
          placeholderTextColor={colors.textMuted}
          value={comment}
          onChangeText={setComment}
          multiline
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <GradientButton title="Submit review" onPress={submit} loading={submitting} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.base },
  title: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md, marginVertical: spacing.base },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  input: { flex: 1, color: colors.textPrimary, fontSize: fontSize.base, minHeight: 40, paddingTop: 0 },
  error: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.sm, textAlign: 'center' },
  doneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  doneText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary },
});
