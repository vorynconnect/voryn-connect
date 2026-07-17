import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { GradientButton } from '@/components/GradientButton';
import { ErrorState, LoadingState } from '@/components/States';
import { ScreenHeader } from '@/components/ScreenHeader';
import type { DriverMe } from '@/features/driver/types';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';
import { api } from '@/lib/api';

/** Vehicle details — registered vehicle facts; changes go through partner support. */
export default function VehicleDetailsScreen() {
  const router = useRouter();
  const meQuery = useQuery({ queryKey: ['driver-me'], queryFn: () => api<DriverMe>('/v1/driver/me') });

  if (meQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading vehicle…" />
      </View>
    );
  }
  if (meQuery.isError || !meQuery.data) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <ErrorState onRetry={() => meQuery.refetch()} />
      </View>
    );
  }

  const me = meQuery.data;
  const rows = me.driver
    ? [
        { label: 'Make', value: me.driver.vehicleMake ?? '—' },
        { label: 'Model', value: me.driver.vehicleModel ?? '—' },
        { label: 'Color', value: me.driver.vehicleColor ?? '—' },
        { label: 'Plate number', value: me.driver.plateNo ?? '—' },
        { label: 'Ride category', value: me.driver.rideCategory },
      ]
    : [
        { label: 'Vehicle type', value: me.courier?.vehicleType ?? '—' },
        { label: 'Description', value: me.courier?.vehicleDesc ?? '—' },
      ];

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Vehicle details</Text>
        <Text style={styles.subtitle}>The vehicle registered to your partner account.</Text>

        <Card style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name={me.driver ? 'car' : 'bicycle'} size={30} color={colors.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>
              {me.driver
                ? `${me.driver.vehicleMake ?? ''} ${me.driver.vehicleModel ?? ''}`.trim() || 'Registered vehicle'
                : me.courier?.vehicleDesc ?? 'Delivery vehicle'}
            </Text>
            <View style={styles.verifiedRow}>
              <Ionicons name="shield-checkmark" size={14} color={colors.success} />
              <Text style={styles.verifiedText}>Vehicle verified</Text>
            </View>
          </View>
          {me.driver?.plateNo ? (
            <View style={styles.plateBox}>
              <Text style={styles.plateText}>{me.driver.plateNo}</Text>
            </View>
          ) : null}
        </Card>

        <Card padded={false} style={styles.listCard}>
          {rows.map((row, i) => (
            <View key={row.label} style={[styles.row, i < rows.length - 1 && styles.rowBorder]}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue}>{row.value}</Text>
            </View>
          ))}
        </Card>

        <Card style={styles.noteCard}>
          <Ionicons name="information-circle-outline" size={20} color={colors.blue} />
          <Text style={styles.noteText}>
            Changing your vehicle requires re-verification of your documents. Contact partner support to start the
            update.
          </Text>
        </Card>

        <GradientButton
          title="Contact partner support"
          icon="headset-outline"
          onPress={() => router.push('/profile-pages/support')}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  title: { fontSize: 26, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: 3, marginBottom: spacing.base },
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  verifiedText: { fontSize: fontSize.sm, color: colors.success, fontWeight: fontWeight.semibold },
  plateBox: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  plateText: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary, letterSpacing: 1 },
  listCard: { marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.base,
    gap: spacing.md,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLabel: { fontSize: fontSize.base, color: colors.textSecondary },
  rowValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.skyTint,
    marginBottom: spacing.base,
  },
  noteText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
});
