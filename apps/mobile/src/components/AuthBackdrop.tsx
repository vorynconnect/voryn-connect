import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';

/**
 * Soft decorative backdrop of the auth mockups: large translucent circles in
 * the corners over the light-blue app background.
 */
export function AuthBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.circle, styles.topLeft]} />
      <View style={[styles.circle, styles.bottomRight]} />
      <View style={styles.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    borderWidth: 46,
    borderColor: '#E3EEFC',
    opacity: 0.9,
  },
  topLeft: { top: -190, left: -130 },
  bottomRight: { bottom: -170, right: -150 },
  dot: {
    position: 'absolute',
    top: 84,
    left: '38%',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.cyan,
    opacity: 0.75,
  },
});
