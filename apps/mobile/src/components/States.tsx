import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';

/** Centered loading spinner for full sections. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={colors.blue} size="large" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon = 'search-outline',
  title,
  body,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={34} color={colors.blue} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  body = 'Check your connection and try again.',
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconCircle, styles.errorCircle]}>
        <Ionicons name="cloud-offline-outline" size={34} color={colors.danger} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {onRetry ? (
        <Pressable style={styles.retry} onPress={onRetry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Skeleton block used while cards load. */
export function Skeleton({ height, width, style }: { height: number; width?: number | `${number}%`; style?: object }) {
  return <View style={[styles.skeleton, { height, width: width ?? '100%' }, style]} />;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: spacing['3xl'], paddingHorizontal: spacing.xl },
  label: { color: colors.textSecondary, marginTop: spacing.md, fontSize: fontSize.base },
  iconCircle: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
  },
  errorCircle: { backgroundColor: colors.dangerTint },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textPrimary, textAlign: 'center' },
  body: { fontSize: fontSize.base, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  retry: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.skyTint,
  },
  retryText: { color: colors.blue, fontWeight: fontWeight.semibold, fontSize: fontSize.base },
  skeleton: { backgroundColor: '#E8EFFA', borderRadius: radius.md },
});
