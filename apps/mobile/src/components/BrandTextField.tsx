import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

type Props = TextInputProps & {
  icon?: keyof typeof Ionicons.glyphMap;
  isPassword?: boolean;
  error?: string;
  trailing?: React.ReactNode;
};

/**
 * Rounded input with a leading icon chip — the field style used across the
 * auth and checkout mockups.
 */
export function BrandTextField({ icon, isPassword, error, trailing, ...inputProps }: Props) {
  const [hidden, setHidden] = useState(Boolean(isPassword));
  return (
    <View style={styles.wrap}>
      <View style={[styles.field, error ? styles.fieldError : null]}>
        {icon ? (
          <View style={styles.iconChip}>
            <Ionicons name={icon} size={20} color={colors.blue} />
          </View>
        ) : null}
        <TextInput
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          secureTextEntry={hidden}
          {...inputProps}
        />
        {isPassword ? (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8} accessibilityLabel="Toggle password visibility">
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={22} color={colors.textSecondary} />
          </Pressable>
        ) : (
          trailing ?? null
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.base },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.base,
    paddingVertical: 6,
    minHeight: 60,
  },
  fieldError: { borderColor: colors.danger },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  input: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
    marginLeft: spacing.md,
  },
});
