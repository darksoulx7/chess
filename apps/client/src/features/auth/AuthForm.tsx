import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { errorText } from '../../services/error-text';
import { colors, spacing, typography } from '../../theme/tokens';
import { useAuth } from './auth-store';

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';
  // Client-side checks only improve feedback; the server validates everything again.
  const problem = isRegister
    ? !/^\S+@\S+\.\S+$/.test(email)
      ? 'Enter a valid email address.'
      : !USERNAME_RE.test(username)
        ? 'Username must be 3-20 letters, numbers or underscores.'
        : password.length < 10
          ? 'Password must be at least 10 characters.'
          : null
    : !identifier.trim() || !password
      ? 'Enter your email or username and password.'
      : null;

  const submit = async () => {
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register({ email: email.trim(), username: username.trim(), password });
      else await login(identifier.trim(), password);
      router.dismissTo('/');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll maxWidth={440}>
      <Text style={styles.title}>{isRegister ? 'Create account' : 'Sign in'}</Text>
      <View style={styles.form}>
        {isRegister ? (
          <>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              testID="email"
            />
            <TextField
              label="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoComplete="username-new"
              textContentType="username"
              hint="3-20 letters, numbers or underscores"
              testID="username"
            />
          </>
        ) : (
          <TextField
            label="Email or username"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoComplete="username"
            textContentType="username"
            testID="identifier"
          />
        )}
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          textContentType={isRegister ? 'newPassword' : 'password'}
          hint={isRegister ? 'At least 10 characters' : undefined}
          onSubmitEditing={() => void submit()}
          testID="password"
        />
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" testID="auth-error">
            {error}
          </Text>
        ) : null}
        <Button
          label={busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          variant="primary"
          onPress={() => void submit()}
          disabled={busy}
          testID="auth-submit"
        />
      </View>
      <Link href={isRegister ? '/auth/login' : '/auth/register'} style={styles.link} replace>
        {isRegister ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </Link>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, ...typography.title },
  form: { gap: spacing.md },
  error: { color: colors.danger, ...typography.body },
  link: {
    color: colors.accent,
    ...typography.body,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});
