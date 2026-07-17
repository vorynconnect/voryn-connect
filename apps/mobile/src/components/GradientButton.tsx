import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, gradients, radius, shadow, spacing } from '@/theme/tokens';

type Props = {
  title: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Right-aligned secondary label, e.g. the total on "Confirm booking". */
  trailingText?: string;
  style?: StyleProp<ViewStyle>;
};

/** Primary CTA — blue→cyan gradient pill, as on every mockup CTA. */
export function GradientButton({ title, onPress, loading, disabled, icon, trailingText, style }: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [style, pressed && !isDisabled ? { transform: [{ scale: 0.985 }] } : null]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <LinearGradient
        colors={gradients.primary}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.button, shadow.cta, isDisabled && styles.disabled]}
      >
        {loading ? (
          <ActivityIndicator color={colors.textOnBrand} />
        ) : (
          <View style={styles.row}>
            {icon ? <Ionicons name={icon} size={20} color={colors.textOnBrand} style={styles.icon} /> : null}
            <Text style={styles.label}>{title}</Text>
            {trailingText ? <Text style={styles.trailing}>{trailingText}</Text> : null}
          </View>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.pill,
    paddingVertical: 17,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  disabled: { opacity: 0.55 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  icon: { marginRight: spacing.sm },
  label: {
    color: colors.textOnBrand,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
  trailing: {
    color: colors.textOnBrand,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    marginLeft: spacing.base,
  },
});
