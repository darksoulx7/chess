import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../components/Button';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { useAccountMutations } from '../account/queries';
import { useAuth } from '../auth/auth-store';
import { errorText } from '../../services/error-text';
import { useAnalysis } from './analysis-store';

export function LoadPanel() {
  const game = useAnalysis((s) => s.game);
  const ply = useAnalysis((s) => s.ply);
  const loadText = useAnalysis((s) => s.loadText);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const { saveGame } = useAccountMutations();
  const [saveName, setSaveName] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // The store replaces `game` on every change, so this re-renders and recomputes with it.
  const pgn = game.getHistory().length > 0 ? game.getPgn({ Event: 'Analysis', Site: 'Chess' }) : '';
  const fen = game.getFenAtPly(ply) ?? game.getFen();

  const copy = async (label: string, value: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    } catch {
      setCopied('Copy is not available here: select the text and copy it manually.');
    }
  };

  return (
    <View style={styles.box}>
      <Text style={styles.label}>Load PGN or FEN</Text>
      <TextInput
        accessibilityLabel="PGN or FEN"
        placeholder="Paste a PGN or a FEN…"
        placeholderTextColor={colors.textFaint}
        value={text}
        onChangeText={(t) => {
          setText(t);
          setError(null);
        }}
        multiline
        numberOfLines={5}
        style={styles.input}
        testID="load-input"
      />
      {error ? (
        <Text style={styles.error} testID="load-error">
          {error}
        </Text>
      ) : null}
      <Button
        label="Load"
        variant="primary"
        testID="load-button"
        onPress={() => {
          const message = loadText(text);
          setError(message);
          if (!message) setText('');
        }}
      />

      <Text style={styles.label}>Current position (FEN)</Text>
      <Text selectable style={styles.mono} testID="current-fen">
        {fen}
      </Text>
      <Button
        label={copied === 'FEN' ? 'Copied' : 'Copy FEN'}
        onPress={() => void copy('FEN', fen)}
      />

      <Text style={styles.label}>Game (PGN)</Text>
      <Text selectable style={styles.mono} testID="current-pgn">
        {pgn || 'No moves yet.'}
      </Text>
      <Button
        label={copied === 'PGN' ? 'Copied' : 'Copy PGN'}
        onPress={() => void copy('PGN', pgn)}
        disabled={!pgn}
      />
      {signedIn && pgn ? (
        <View style={styles.box}>
          <Text style={styles.label}>Save to my games</Text>
          <TextInput
            accessibilityLabel="Saved game name"
            placeholder={`Game ${new Date().toLocaleDateString()}`}
            placeholderTextColor={colors.textFaint}
            value={saveName}
            onChangeText={setSaveName}
            maxLength={100}
            style={styles.nameInput}
            testID="save-name"
          />
          <Button
            label={saveGame.isPending ? 'Saving…' : 'Save to my games'}
            testID="save-to-games"
            disabled={saveGame.isPending}
            onPress={() =>
              saveGame.mutate(
                { name: saveName.trim() || `Game ${new Date().toLocaleDateString()}`, pgn },
                {
                  onSuccess: () => {
                    setSaveMessage('Saved. Find it under Saved games.');
                    setSaveName('');
                  },
                  onError: (err) => setSaveMessage(errorText(err, 'Could not save this game.')),
                },
              )
            }
          />
          {saveMessage ? (
            <Text style={styles.hint} testID="save-message">
              {saveMessage}
            </Text>
          ) : null}
        </View>
      ) : null}
      {copied && copied !== 'FEN' && copied !== 'PGN' ? (
        <Text style={styles.hint}>{copied}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
  label: {
    color: colors.textMuted,
    ...typography.label,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  input: {
    minHeight: 110,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    borderRadius: radius.md,
    padding: spacing.md,
    textAlignVertical: 'top',
    ...typography.body,
  },
  error: { color: colors.danger, ...typography.body },
  nameInput: {
    minHeight: 44,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    ...typography.body,
  },
  mono: {
    color: colors.text,
    ...typography.caption,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  hint: { color: colors.textFaint, ...typography.caption },
});
