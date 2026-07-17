import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '@/theme/tokens';

export type DialogSpec = {
  title: string;
  message: string;
  /** Present → two-button confirm dialog; absent → single OK notice. */
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
};

/**
 * Cross-platform replacement for Alert.alert dialogs — RN's Alert is a no-op
 * on react-native-web, which silently kills confirm flows in the browser.
 */
export function ConfirmDialog({ spec, onClose }: { spec: DialogSpec | null; onClose: () => void }) {
  const isConfirm = Boolean(spec?.confirmLabel && spec?.onConfirm);

  return (
    <Modal visible={Boolean(spec)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{spec?.title}</Text>
          <Text style={styles.message}>{spec?.message}</Text>
          <View style={styles.buttons}>
            {isConfirm ? (
              <Pressable style={[styles.button, styles.ghost]} onPress={onClose}>
                <Text style={styles.ghostText}>Cancel</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.button, spec?.destructive ? styles.danger : styles.primary]}
              onPress={() => {
                const confirm = spec?.onConfirm;
                onClose();
                if (isConfirm) confirm?.();
              }}
            >
              <Text style={styles.primaryText}>{isConfirm ? spec?.confirmLabel : 'OK'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(22, 48, 93, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.heavy, color: colors.textPrimary },
  message: { fontSize: fontSize.base, color: colors.textSecondary, lineHeight: 21, marginTop: spacing.sm },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.lg },
  button: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minWidth: 92,
    alignItems: 'center',
  },
  ghost: { borderWidth: 1.5, borderColor: colors.border },
  ghostText: { color: colors.textPrimary, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  primary: { backgroundColor: colors.blue },
  danger: { backgroundColor: colors.danger },
  primaryText: { color: colors.textOnBrand, fontWeight: fontWeight.bold, fontSize: fontSize.base },
});
