import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { colors, spacing, typography } from '../../theme/tokens';
import type { Outcome } from './game-view';

interface Props {
  visible: boolean;
  outcome: Outcome;
  onNewGame: () => void;
  onClose: () => void;
  onMenu: () => void;
}

export function GameOverSheet({ visible, outcome, onNewGame, onClose, onMenu }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} label="Game over">
      <View style={styles.head} testID="game-over">
        <Text style={styles.title}>{outcome.title}</Text>
        <Text style={styles.detail}>{outcome.detail}</Text>
      </View>
      <View style={styles.actions}>
        <Button label="New game" variant="primary" onPress={onNewGame} />
        <Button label="View board" onPress={onClose} />
        <Button label="Menu" variant="ghost" onPress={onMenu} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: spacing.xs },
  title: { color: colors.text, ...typography.title },
  detail: { color: colors.textMuted, ...typography.body },
  actions: { gap: spacing.sm },
});
