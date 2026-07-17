import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';

const QUICK_AMOUNTS_MINOR = [100000, 200000, 500000, 1000000]; // JMD 1k / 2k / 5k / 10k

type Props = {
  /** Current amount in minor units; 0 when empty. */
  valueMinor: number;
  onChange: (minor: number) => void;
  label?: string;
};

/**
 * Large JMD amount entry with quick-pick chips — shared by top up, send,
 * withdraw, and scan-to-pay. Amounts are integer minor units end to end;
 * the input accepts whole JMD only.
 */
export function AmountInput({ valueMinor, onChange, label = 'Amount' }: Props) {
  const major = valueMinor > 0 ? String(Math.floor(valueMinor / 100)) : '';
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.amountRow}>
        <Text style={styles.currency}>JMD</Text>
        <TextInput
          style={styles.amountInput}
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          value={major}
          maxLength={9}
          onChangeText={(text) => {
            const digits = text.replace(/[^0-9]/g, '');
            onChange(digits ? Number(digits) * 100 : 0);
          }}
        />
      </View>
      <View style={styles.chipsRow}>
        {QUICK_AMOUNTS_MINOR.map((minor) => {
          const active = valueMinor === minor;
          return (
            <Pressable
              key={minor}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onChange(minor)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {(minor / 100).toLocaleString('en-JM')}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.base },
  label: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textPrimary, marginBottom: spacing.md },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  currency: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textSecondary },
  amountInput: { flex: 1, fontSize: 34, fontWeight: fontWeight.heavy, color: colors.textPrimary, paddingVertical: 4 },
  chipsRow: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
  },
  chipActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  chipTextActive: { color: colors.textOnBrand },
});
