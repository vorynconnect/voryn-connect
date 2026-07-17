import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, fontWeight } from '@/theme/tokens';

type Props = {
  uri?: string | null;
  name?: string | null;
  size?: number;
  /** Fallback circle color (defaults to navy, matching existing initials circles). */
  fallbackColor?: string;
};

/** Profile photo circle with an initials fallback — use anywhere a person appears. */
export function Avatar({ uri, name, size = 40, fallbackColor = colors.navy }: Props) {
  const round = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return <Image source={{ uri }} style={round} contentFit="cover" transition={100} />;
  }

  const initials =
    (name ?? '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0))
      .join('')
      .toUpperCase() || '?';

  return (
    <View style={[round, styles.fallback, { backgroundColor: fallbackColor }]}>
      <Text style={[styles.text, { fontSize: Math.max(11, Math.round(size * 0.34)) }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.textOnBrand, fontWeight: fontWeight.heavy },
});
