import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';
import { formatJmdCompact } from '@/lib/format';

/** Preset tip amounts in JMD minor units (100 / 200 / 300 / 500). */
const PRESETS_MINOR = [0, 10000, 20000, 30000, 50000];

/** Server-enforced minimum for a non-zero tip (JMD 10). */
export const MIN_TIP_MINOR = 1000;

type Props = {
  valueMinor: number;
  onChange: (tipMinor: number) => void;
};

/** Tip amount picker — preset chips plus a custom amount. */
export function TipSelector({ valueMinor, onChange }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');

  const applyCustom = (text: string) => {
    const digits = text.replace(/[^0-9]/g, '');
    setCustomText(digits);
    const major = parseInt(digits, 10);
    onChange(Number.isFinite(major) ? major * 100 : 0);
  };

  return (
    <View>
      <View style={styles.row}>
        {PRESETS_MINOR.map((preset) => {
          const active = !customOpen && valueMinor === preset;
          return (
            <Pressable
              key={preset}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                setCustomOpen(false);
                setCustomText('');
                onChange(preset);
              }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {preset === 0 ? 'No tip' : formatJmdCompact(preset)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          style={[styles.chip, customOpen && styles.chipActive]}
          onPress={() => {
            setCustomOpen(true);
            onChange(customText ? parseInt(customText, 10) * 100 : 0);
          }}
        >
          <Text style={[styles.chipText, customOpen && styles.chipTextActive]}>Custom</Text>
        </Pressable>
      </View>
      {customOpen ? (
        <View style={styles.customRow}>
          <Text style={styles.customPrefix}>JMD</Text>
          <TextInput
            style={styles.customInput}
            keyboardType="number-pad"
            placeholder="Enter amount"
            placeholderTextColor={colors.textMuted}
            value={customText}
            onChangeText={applyCustom}
          />
        </View>
      ) : null}
      {valueMinor > 0 && valueMinor < MIN_TIP_MINOR ? (
        <Text style={styles.minHint}>Minimum tip is {formatJmdCompact(MIN_TIP_MINOR)}.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.blue, backgroundColor: colors.skyTint },
  chipText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  chipTextActive: { color: colors.blue },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
  },
  customPrefix: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textSecondary },
  customInput: { flex: 1, paddingVertical: spacing.md, fontSize: fontSize.base, color: colors.textPrimary },
  minHint: { fontSize: fontSize.xs, color: colors.danger, marginTop: spacing.sm },
});
