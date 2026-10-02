import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { describeGame } from '../src/features/account/describe-game';
import { fetchGamePgn, useAccountMutations, useGames } from '../src/features/account/queries';
import { useAnalysis } from '../src/features/analysis/analysis-store';
import { useAuth } from '../src/features/auth/auth-store';
import { errorText } from '../src/services/error-text';
import { colors, radius, spacing, typography } from '../src/theme/tokens';

export default function History() {
  const router = useRouter();
  const status = useAuth((s) => s.status);
  const games = useGames();
  const { deleteGame } = useAccountMutations();
  const [message, setMessage] = useState<string | null>(null);

  if (status !== 'signedIn') {
    return (
      <Screen scroll>
        <Text style={styles.title}>Game history</Text>
        <Text style={styles.muted}>Sign in to see your games.</Text>
        <Button label="Sign in" variant="primary" onPress={() => router.push('/auth/login')} />
      </Screen>
    );
  }

  const items = games.data?.pages.flatMap((p) => p.items) ?? [];

  const open = async (id: string) => {
    try {
      const pgn = await fetchGamePgn(id);
      useAnalysis.getState().loadText(pgn);
      router.push('/analysis');
    } catch (err) {
      setMessage(errorText(err));
    }
  };
  const exportPgn = async (id: string) => {
    try {
      await Clipboard.setStringAsync(await fetchGamePgn(id));
      setMessage('PGN copied to the clipboard.');
    } catch (err) {
      setMessage(errorText(err, 'Could not copy the PGN.'));
    }
  };

  return (
    <Screen scroll>
      <Text style={styles.title}>Game history</Text>
      {message ? (
        <Text style={styles.muted} testID="history-message">
          {message}
        </Text>
      ) : null}
      {games.isLoading ? <Text style={styles.muted}>Loading…</Text> : null}
      {games.isError ? <Text style={styles.error}>{errorText(games.error)}</Text> : null}
      {!games.isLoading && items.length === 0 && !games.isError ? (
        <Text style={styles.muted}>
          No games yet. Finish a game while signed in and it appears here.
        </Text>
      ) : null}
      {items.map((g) => {
        const d = describeGame(g);
        return (
          <View key={g.id} style={styles.card} testID="history-item">
            <View style={styles.cardHead}>
              <Text
                style={[
                  styles.badge,
                  d.badge === 'Win' && styles.win,
                  d.badge === 'Loss' && styles.loss,
                ]}
              >
                {d.badge}
              </Text>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{d.title}</Text>
                <Text style={styles.muted}>{d.detail}</Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Button label="Analyze" onPress={() => void open(g.id)} />
              <Button label="Copy PGN" onPress={() => void exportPgn(g.id)} />
              <Button label="Delete" variant="danger" onPress={() => deleteGame.mutate(g.id)} />
            </View>
          </View>
        );
      })}
      {games.hasNextPage ? (
        <Button
          label={games.isFetchingNextPage ? 'Loading…' : 'Load more'}
          onPress={() => void games.fetchNextPage()}
          testID="load-more"
        />
      ) : null}
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, ...typography.title },
  muted: { color: colors.textMuted, ...typography.caption },
  error: { color: colors.danger, ...typography.body },
  flex: { flex: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardTitle: { color: colors.text, ...typography.heading },
  badge: {
    minWidth: 52,
    textAlign: 'center',
    color: colors.textMuted,
    ...typography.label,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingVertical: 4,
  },
  win: { color: colors.success },
  loss: { color: colors.danger },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
