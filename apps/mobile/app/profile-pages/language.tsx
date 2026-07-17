import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';

const LANGUAGE_KEY = 'voryn.language';

const LANGUAGES = [
  { key: 'en-JM', label: 'English (Jamaica)', available: true },
  { key: 'en-US', label: 'English (US)', available: true },
  { key: 'es', label: 'Español', available: false },
  { key: 'fr', label: 'Français', available: false },
];

/** Language & region — stored on-device; JMD stays the app currency. */
export default function LanguageScreen() {
  const [selected, setSelected] = useState('en-JM');

  useEffect(() => {
    SecureStore.getItemAsync(LANGUAGE_KEY).then((stored) => {
      if (stored) setSelected(stored);
    });
  }, []);

  const choose = async (key: string) => {
    setSelected(key);
    await SecureStore.setItemAsync(LANGUAGE_KEY, key);
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <View style={styles.container}>
        <Text style={styles.title}>Language & Region</Text>
        <Text style={styles.subtitle}>Choose your preferred language.</Text>

        <Card padded={false}>
          {LANGUAGES.map((language, i) => {
            const active = selected === language.key;
            return (
              <Pressable
                key={language.key}
                style={[styles.row, i < LANGUAGES.length - 1 && styles.rowBorder, !language.available && styles.rowDisabled]}
                disabled={!language.available}
                onPress={() => choose(language.key)}
              >
                <Text style={[styles.rowLabel, !language.available && { color: colors.textMuted }]}>
                  {language.label}
                </Text>
                {language.available ? (
                  active ? (
                    <Ionicons name="checkmark-circle" size={22} color={colors.blue} />
                  ) : (
                    <View style={styles.radio} />
                  )
                ) : (
                  <Text style={styles.soonText}>Coming soon</Text>
                )}
              </Pressable>
            );
          })}
        </Card>

        <Card style={styles.regionCard}>
          <View style={styles.regionRow}>
            <View style={styles.regionIcon}>
              <Ionicons name="location" size={19} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.regionTitle}>Region</Text>
              <Text style={styles.regionBody}>Jamaica • Prices shown in JMD</Text>
            </View>
          </View>
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.base },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.base,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowDisabled: { opacity: 0.7 },
  rowLabel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong },
  soonText: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: fontWeight.semibold },
  regionCard: { marginTop: spacing.base },
  regionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  regionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  regionBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
});
