import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import type { SaveState } from './use-save-game';
import { Sheet } from '../../components/Sheet';
import { colors, spacing, typography } from '../../theme/tokens';
import type { Outcome } from './game-view';

interface Props {
  visible: boolean;
  outcome: Outcome;
  onNewGame: () => void;
  onClose: () => void;
  onMenu: () => void;
  /** Account integration: whether/how the finished game is being saved to the user's history. */
  save?: {
    signedIn: boolean;
    state: SaveState;
    error: string | null;
    onRetry: () => void;
    onSignIn: () => void;
  };
}

export function GameOverSheet({ visible, outcome, onNewGame, onClose, onMenu, save }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} label="Game over">
      <View style={styles.head} testID="game-over">
        <Text style={styles.title}>{outcome.title}</Text>
        <Text style={styles.detail}>{outcome.detail}</Text>
      </View>
      {save ? (
        <View style={styles.save} testID="save-status">
          {!save.signedIn ? (
            <Button label="Sign in to save your games" variant="ghost" onPress={save.onSignIn} />
          ) : save.state === 'saving' ? (
            <Text style={styles.detail}>Saving to your history…</Text>
          ) : save.state === 'saved' ? (
            <Text style={styles.saved}>Saved to your history ✓</Text>
          ) : save.state === 'error' ? (
            <>
              <Text style={styles.error}>{save.error}</Text>
              <Button label="Retry save" onPress={save.onRetry} />
            </>
          ) : null}
        </View>
      ) : null}
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
  save: { alignItems: 'center', gap: spacing.sm },
  saved: { color: colors.success, ...typography.body },
  error: { color: colors.danger, ...typography.body, textAlign: 'center' },
});
