import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

// Official asset trimmed to the artwork bounds (739x325) so the logo renders
// at its full given height with no phantom padding — sits flush in layouts.
const RATIO = 739 / 325;

/**
 * Official Voryn Connect logo. Always renders the uploaded brand asset —
 * never a recreation.
 */
export function BrandLogo({ height = 44 }: { height?: number }) {
  return (
    <View style={styles.wrap}>
      <Image
        source={require('../../assets/brand/voryn-logo.png')}
        style={{ height, width: height * RATIO }}
        contentFit="contain"
        accessibilityLabel="Voryn Connect"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
