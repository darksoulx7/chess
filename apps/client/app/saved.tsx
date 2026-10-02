import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { Sheet } from '../src/components/Sheet';
import { TextField } from '../src/components/TextField';
import {
  fetchSavedPgn,
  useAccountMutations,
  useSavedGames,
  type SavedGameSummary,
} from '../src/features/account/queries';
import { useAnalysis } from '../src/features/analysis/analysis-store';
import { useAuth } from '../src/features/auth/auth-store';
import { errorText } from '../src/services/error-text';
import { colors, radius, spacing, typography } from '../src/theme/tokens';

export default function Saved() {
  const router = useRouter();
  const status = useAuth((s) => s.status);
  const saved = useSavedGames();
  const { deleteSaved, renameSaved } = useAccountMutations();
  const [renaming, setRenaming] = useState<SavedGameSummary | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  if (status !== 'signedIn') {
    return (
      <Screen scroll>
        <Text style={styles.title}>Saved games</Text>
        <Text style={styles.muted}>Sign in to save games and open them later.</Text>
        <Button label="Sign in" variant="primary" onPress={() => router.push('/auth/login')} />
      </Screen>
    );
  }
  const items = saved.data?.items ?? [];

  const open = async (id: string) => {
    try {
      useAnalysis.getState().loadText(await fetchSavedPgn(id));
      router.push('/analysis');
    } catch (err) {
      setMessage(errorText(err));
    }
  };

  return (
    <Screen scroll>
      <Text style={styles.title}>Saved games</Text>
      {message ? (
        <Text style={styles.muted} testID="saved-message">
          {message}
        </Text>
      ) : null}
      {saved.isLoading ? <Text style={styles.muted}>Loading…</Text> : null}
      {saved.isError ? <Text style={styles.error}>{errorText(saved.error)}</Text> : null}
      {!saved.isLoading && items.length === 0 && !saved.isError ? (
        <Text style={styles.muted}>
          Nothing saved yet. Use "Save to my games" in the analysis screen.
        </Text>
      ) : null}
      {items.map((g) => (
        <View key={g.id} style={styles.card} testID="saved-item">
          <Text style={styles.cardTitle}>{g.name}</Text>
          <Text style={styles.muted}>
            {Math.ceil(g.plyCount / 2)} moves · {g.result} ·{' '}
            {new Date(g.updatedAt).toLocaleDateString()}
          </Text>
          <View style={styles.actions}>
            <Button label="Analyze" onPress={() => void open(g.id)} />
            <Button
              label="Rename"
              onPress={() => {
                setRenaming(g);
                setName(g.name);
              }}
            />
            <Button
              label="Copy PGN"
              onPress={async () => {
                try {
                  await Clipboard.setStringAsync(await fetchSavedPgn(g.id));
                  setMessage('PGN copied to the clipboard.');
                } catch (err) {
                  setMessage(errorText(err, 'Could not copy the PGN.'));
                }
              }}
            />
            <Button label="Delete" variant="danger" onPress={() => deleteSaved.mutate(g.id)} />
          </View>
        </View>
      ))}
      <Button label="Back" variant="ghost" onPress={() => router.back()} />

      <Sheet
        visible={renaming !== null}
        onClose={() => setRenaming(null)}
        label="Rename saved game"
      >
        <Text style={styles.title}>Rename</Text>
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          maxLength={100}
          testID="rename-input"
        />
        <Button
          label="Save"
          variant="primary"
          testID="rename-save"
          disabled={!name.trim()}
          onPress={() => {
            if (renaming)
              renameSaved.mutate(
                { id: renaming.id, name: name.trim() },
                { onSettled: () => setRenaming(null) },
              );
          }}
        />
        <Button label="Cancel" onPress={() => setRenaming(null)} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, ...typography.title },
  muted: { color: colors.textMuted, ...typography.caption },
  error: { color: colors.danger, ...typography.body },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.text, ...typography.heading },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
