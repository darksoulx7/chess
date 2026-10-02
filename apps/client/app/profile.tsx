import { AVATAR_IDS } from '@chess/game-types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../src/components/Avatar';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { Sheet } from '../src/components/Sheet';
import { TextField } from '../src/components/TextField';
import { useStats } from '../src/features/account/queries';
import { useAuth } from '../src/features/auth/auth-store';
import { api } from '../src/services/api';
import { errorText } from '../src/services/error-text';
import { colors, radius, spacing, typography } from '../src/theme/tokens';

export default function Profile() {
  const router = useRouter();
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const setUser = useAuth((s) => s.setUser);
  const stats = useStats();
  const [username, setUsername] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (status !== 'signedIn' || !user) {
    return (
      <Screen scroll>
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.muted}>
          Sign in to keep your games, stats and settings across devices.
        </Text>
        <Button label="Sign in" variant="primary" onPress={() => router.push('/auth/login')} />
        <Button label="Create account" onPress={() => router.push('/auth/register')} />
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const save = async (patch: { username?: string; avatar?: string }) => {
    setError(null);
    setMessage(null);
    try {
      const r = await api<{ user: typeof user }>('/api/me', { method: 'PATCH', body: patch });
      setUser(r.user);
      setUsername(null);
      setMessage('Saved.');
    } catch (err) {
      setError(errorText(err));
    }
  };

  const s = stats.data;
  return (
    <Screen scroll>
      <View style={styles.head}>
        <Avatar id={user.avatar} size={64} />
        <View style={styles.flex}>
          <Text style={styles.name} testID="profile-name">
            {user.username}
          </Text>
          <Text style={styles.muted}>{user.email}</Text>
        </View>
      </View>

      <View style={styles.statsRow} testID="stats">
        <Stat label="Games" value={s ? String(s.gamesPlayed) : '–'} testID="stat-games" />
        <Stat label="Wins" value={s ? String(s.wins) : '–'} testID="stat-wins" />
        <Stat label="Losses" value={s ? String(s.losses) : '–'} testID="stat-losses" />
        <Stat label="Draws" value={s ? String(s.draws) : '–'} testID="stat-draws" />
        <Stat
          label="Win rate"
          value={s ? `${Math.round(s.winRate * 100)}%` : '–'}
          testID="stat-winrate"
        />
      </View>
      <Text style={styles.muted}>
        Results count games against bots. Local games are not included.
      </Text>

      <Text style={styles.heading}>Favorite openings</Text>
      {s && s.favoriteOpenings.length === 0 ? (
        <Text style={styles.muted}>Play some games to see your favorites.</Text>
      ) : null}
      {s?.favoriteOpenings.map((o) => (
        <View key={o.name} style={styles.row}>
          <Text style={styles.rowText}>{o.name}</Text>
          <Text style={styles.muted}>{o.count}×</Text>
        </View>
      ))}

      <Text style={styles.heading}>Edit profile</Text>
      <TextField
        label="Username"
        value={username ?? user.username}
        onChangeText={setUsername}
        autoCapitalize="none"
        testID="edit-username"
      />
      <Button
        label="Save username"
        onPress={() => void save({ username: username ?? user.username })}
        disabled={username === null || username === user.username}
        testID="save-username"
      />
      <Text style={styles.label}>Avatar</Text>
      <View style={styles.avatars}>
        {AVATAR_IDS.map((id) => (
          <Pressable
            key={id}
            accessibilityRole="radio"
            aria-checked={user.avatar === id}
            accessibilityLabel={`${id} avatar`}
            onPress={() => void save({ avatar: id })}
            style={[styles.avatarChoice, user.avatar === id && styles.avatarSelected]}
          >
            <Avatar id={id} size={44} />
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.ok}>{message}</Text> : null}

      <Button label="Game history" onPress={() => router.push('/history')} />
      <Button label="Saved games" onPress={() => router.push('/saved')} />
      <Button
        label="Sign out"
        onPress={async () => {
          await logout();
          router.dismissTo('/');
        }}
        testID="sign-out"
      />
      <Button label="Delete account" variant="danger" onPress={() => setDeleting(true)} />
      <Button label="Back" variant="ghost" onPress={() => router.back()} />

      <Sheet visible={deleting} onClose={() => setDeleting(false)} label="Delete account">
        <Text style={styles.title}>Delete account?</Text>
        <Text style={styles.muted}>
          This permanently deletes your account, game history and saved games. Enter your password
          to confirm.
        </Text>
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          error={deleteError}
          testID="delete-password"
        />
        <Button
          label="Delete my account"
          variant="danger"
          testID="confirm-delete"
          onPress={async () => {
            setDeleteError(null);
            try {
              await api('/api/me', { method: 'DELETE', body: { password } });
              await logout();
              setDeleting(false);
              router.dismissTo('/');
            } catch (err) {
              setDeleteError(errorText(err));
            }
          }}
        />
        <Button label="Cancel" onPress={() => setDeleting(false)} />
      </Sheet>
    </Screen>
  );
}

function Stat({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} testID={testID}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, ...typography.title },
  muted: { color: colors.textMuted, ...typography.caption },
  heading: { color: colors.text, ...typography.heading, marginTop: spacing.sm },
  label: { color: colors.textMuted, ...typography.label },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  flex: { flex: 1 },
  name: { color: colors.text, ...typography.title },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    flexGrow: 1,
    minWidth: 90,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  statValue: { color: colors.text, ...typography.title },
  statLabel: { color: colors.textMuted, ...typography.caption },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowText: { color: colors.text, ...typography.body, flex: 1 },
  avatars: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  avatarChoice: {
    padding: 4,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarSelected: { borderColor: colors.accent },
  error: { color: colors.danger, ...typography.body },
  ok: { color: colors.success, ...typography.body },
});
