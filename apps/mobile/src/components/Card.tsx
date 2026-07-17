import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { colors, radius, shadow, spacing } from '@/theme/tokens';

type Props = ViewProps & {
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
};

/** White rounded card with the soft navy shadow used across the mockups. */
export function Card({ style, padded = true, children, ...rest }: Props) {
  return (
    <View style={[styles.card, padded && styles.padded, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadow.card,
  },
  padded: { padding: spacing.base },
});
