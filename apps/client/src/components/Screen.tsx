import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
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
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          >
            <View style={[styles.column, { maxWidth }]}>{children}</View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', padding: spacing.lg },
  column: { width: '100%', gap: spacing.lg },
});
