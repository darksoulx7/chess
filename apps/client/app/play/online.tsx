import { TIME_CONTROLS, getTimeControl } from '@chess/game-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Screen } from '../../src/components/Screen';
import { Segmented } from '../../src/components/Segmented';
import { TextField } from '../../src/components/TextField';
import { ToggleRow } from '../../src/components/ToggleRow';
import { useAuth } from '../../src/features/auth/auth-store';
import {
  createOnlineGame,
  fetchActive,
  fetchLobby,
  joinByCode,
  joinById,
} from '../../src/features/online/online-api';
import { errorText } from '../../src/services/error-text';
import { ApiError } from '../../src/services/api';
import { colors, radius, spacing, typography } from '../../src/theme/tokens';

type ColorChoice = 'w' | 'b' | 'random';
const JOIN_ERRORS: Record<string, string> = {
  not_found: 'No open game with that code.',
  own_game: 'That is your own game.',
  not_open: 'That game already has two players.',
};
const clockLabel = (c: { initialMs: number; incrementMs: number } | null) => {
  if (!c) return 'No clock';
  const m = c.initialMs / 60_000;
  return `${m < 1 ? `${c.initialMs / 1000}s` : `${m} min`}${c.incrementMs ? ` + ${c.incrementMs / 1000}s` : ''}`;
};

export default function OnlineHub() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const status = useAuth((s) => s.status);
  const qc = useQueryClient();
  const [color, setColor] = useState<ColorChoice>('random');
  const [tc, setTc] = useState('10+0');
  const [isPublic, setIsPublic] = useState(false);
  const [code, setCode] = useState(typeof params.code === 'string' ? params.code : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = status === 'signedIn';

  const lobby = useQuery({
    queryKey: ['online', 'lobby'],
    queryFn: fetchLobby,
    enabled: signedIn,
    refetchInterval: 5000,
  });
  const active = useQuery({
    queryKey: ['online', 'active'],
    queryFn: fetchActive,
    enabled: signedIn,
    refetchInterval: 10_000,
  });

  const run = async (fn: () => Promise<{ game: { id: string } }>) => {
    setBusy(true);
    setError(null);
    try {
      const { game } = await fn();
      void qc.invalidateQueries({ queryKey: ['online'] });
      router.push({ pathname: '/play/online-game', params: { id: game.id } });
    } catch (err) {
      setError(
        err instanceof ApiError && JOIN_ERRORS[err.code] ? JOIN_ERRORS[err.code]! : errorText(err),
      );
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <Screen scroll>
        <Text style={styles.muted}>Loading…</Text>
      </Screen>
    );
  }
  if (!signedIn) {
    return (
      <Screen scroll>
        <Text style={styles.title}>Play online</Text>
        <Text style={styles.muted}>Sign in to play against other people.</Text>
        <Button label="Sign in" variant="primary" onPress={() => router.push('/auth/login')} />
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const create = () => {
    const c = getTimeControl(tc).config;
    void run(() =>
      createOnlineGame({
        clock: c ? { baseMs: c.initialMs, incrementMs: c.incrementMs } : null,
        color,
        public: isPublic,
      }),
    );
  };

  return (
    <Screen scroll>
      <Text style={styles.title}>Play online</Text>
      {error ? (
        <Text style={styles.error} testID="online-hub-error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      {active.data && active.data.items.length > 0 ? (
        <Section label="Your games">
          {active.data.items.map((g) => {
            const opp = g.players.w?.name && g.players.b?.name ? null : 'Waiting for opponent';
            const names = `${g.players.w?.name ?? '…'} vs ${g.players.b?.name ?? '…'}`;
            return (
              <Button
                key={g.id}
                label={`Resume · ${opp ?? names}`}
                onPress={() => router.push({ pathname: '/play/online-game', params: { id: g.id } })}
                testID="resume-game"
              />
            );
          })}
        </Section>
      ) : null}

      <Section label="New game">
        <Segmented
          label="Your color"
          value={color}
          onChange={setColor}
          options={[
            { value: 'w', label: 'White' },
            { value: 'b', label: 'Black' },
            { value: 'random', label: 'Random' },
          ]}
        />
        <Segmented
          label="Time control"
          value={tc}
          onChange={setTc}
          options={TIME_CONTROLS.map((t) => ({ value: t.id, label: t.label }))}
        />
        <ToggleRow
          label="List in lobby"
          hint="Anyone can join from the open games list. Otherwise only people with your code."
          value={isPublic}
          onChange={setIsPublic}
        />
        <Button
          label="Create game"
          variant="primary"
          onPress={create}
          disabled={busy}
          testID="create-online"
        />
      </Section>

      <Section label="Join with a code">
        <TextField
          label="Invite code"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
        />
        <Button
          label="Join game"
          onPress={() => void run(() => joinByCode(code.trim()))}
          disabled={busy || code.trim().length < 4}
          testID="join-code"
        />
      </Section>

      <Section label="Open games">
        {lobby.isError ? (
          <Text style={styles.muted}>Could not load open games.</Text>
        ) : lobby.data && lobby.data.items.length === 0 ? (
          <Text style={styles.muted} testID="lobby-empty">
            No open games right now. Create one!
          </Text>
        ) : (
          lobby.data?.items.map((e) => (
            <View key={e.id} style={styles.row} testID="lobby-entry">
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{e.creator}</Text>
                <Text style={styles.muted}>
                  {clockLabel(e.clockConfig)} · you play {e.yourColor === 'w' ? 'White' : 'Black'}
                </Text>
              </View>
              <Button
                label={`Join ${e.creator}`}
                onPress={() => void run(() => joinById(e.id))}
                disabled={busy}
              />
            </View>
          ))
        )}
      </Section>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, ...typography.title },
  section: { gap: spacing.sm },
  label: { color: colors.textMuted, ...typography.label, textTransform: 'uppercase' },
  muted: { color: colors.textMuted, ...typography.body },
  error: { color: colors.danger, ...typography.body },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowText: { flexShrink: 1, gap: 2 },
  rowTitle: { color: colors.text, ...typography.heading },
});
