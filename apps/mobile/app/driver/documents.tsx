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

const DRIVER_DOCS = [
  { icon: 'card-outline' as const, label: "Driver's licence", detail: 'Identity & driving record' },
  { icon: 'document-text-outline' as const, label: 'Vehicle registration', detail: 'Certificate of fitness' },
  { icon: 'shield-outline' as const, label: 'Insurance certificate', detail: 'Commercial coverage' },
  { icon: 'finger-print-outline' as const, label: 'Background check', detail: 'Safety screening' },
];

const COURIER_DOCS = [
  { icon: 'card-outline' as const, label: 'Government ID', detail: 'Identity verification' },
  { icon: 'shield-outline' as const, label: 'Proof of address', detail: 'Utility bill or bank statement' },
  { icon: 'finger-print-outline' as const, label: 'Background check', detail: 'Safety screening' },
];

/** Documents & verification — partner document checklist, all verified for active partners. */
export default function DocumentsScreen() {
  const router = useRouter();
  const meQuery = useQuery({ queryKey: ['driver-me'], queryFn: () => api<DriverMe>('/v1/driver/me') });

  if (meQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <ScreenHeader showBack />
        <LoadingState label="Loading documents…" />
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

  const docs = meQuery.data.driver ? DRIVER_DOCS : COURIER_DOCS;

  return (
    <View style={styles.flex}>
      <ScreenHeader showBack />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Documents & verification</Text>
        <Text style={styles.subtitle}>Everything we verified to activate your partner account.</Text>

        <Card style={styles.statusCard}>
          <View style={styles.statusIcon}>
            <Ionicons name="shield-checkmark" size={26} color={colors.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>Fully verified</Text>
            <Text style={styles.statusBody}>
              Your account is verified for partner operations. No action needed.
            </Text>
          </View>
        </Card>

        <Card padded={false} style={styles.listCard}>
          {docs.map((doc, i) => (
            <View key={doc.label} style={[styles.docRow, i < docs.length - 1 && styles.docBorder]}>
              <View style={styles.docIcon}>
                <Ionicons name={doc.icon} size={19} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.docLabel}>{doc.label}</Text>
                <Text style={styles.docDetail}>{doc.detail}</Text>
              </View>
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            </View>
          ))}
        </Card>

        <Card style={styles.noteCard}>
          <Ionicons name="information-circle-outline" size={20} color={colors.blue} />
          <Text style={styles.noteText}>
            Need to renew or replace a document? Contact partner support and we'll walk you through the
            re-verification.
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
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.successTint,
    marginBottom: spacing.md,
  },
  statusIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: { fontSize: fontSize.md, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  statusBody: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, lineHeight: 19 },
  listCard: { marginBottom: spacing.md },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  docBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textPrimary },
  docDetail: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  verifiedText: { fontSize: fontSize.xs, color: colors.success, fontWeight: fontWeight.bold },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.skyTint,
    marginBottom: spacing.base,
  },
  noteText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
});
