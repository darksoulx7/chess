import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors, elevation, radius, spacing } from '../theme/tokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
}

/** Modal sheet: bottom-anchored on narrow screens, centered card on wide ones. */
export function Sheet({ visible, onClose, children, label }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable accessibilityLabel="Dismiss" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View accessibilityViewIsModal accessibilityLabel={label} style={styles.card}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.sheet,
  },
});
