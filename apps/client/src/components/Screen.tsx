import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';

interface Props {
  children: ReactNode;
  /** Scrollable content with a centered max-width column (menus, settings). */
  scroll?: boolean;
  maxWidth?: number;
}

export function Screen({ children, scroll, maxWidth = 560 }: Props) {
  return (
    <SafeAreaView style={styles.root}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.column, { maxWidth }]}>{children}</View>
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, alignItems: 'center', padding: spacing.lg },
  column: { width: '100%', gap: spacing.lg },
});
