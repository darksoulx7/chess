import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { StaticBoard } from '../src/features/chess/StaticBoard';
import { useAnalysis } from '../src/features/analysis/analysis-store';
import { getApiUrl } from '../src/services/config';
import { colors, spacing, typography } from '../src/theme/tokens';

interface Readiness {
  status: string;
  database: string;
  redis: string;
}

async function fetchReadiness(): Promise<Readiness> {
  const res = await fetch(`${getApiUrl()}/health/ready`);
  return (await res.json()) as Readiness;
}

export default function Home() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { data, error, isLoading } = useQuery({
    queryKey: ['ready'],
    queryFn: fetchReadiness,
    retry: false,
  });
  const board = Math.min(width - 48, 360);
  const server = isLoading ? 'Connecting…' : error ? 'Server offline' : `Server ${data?.status}`;

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Text style={styles.title}>Chess</Text>
        <Text style={styles.subtitle}>Play, practice and analyze.</Text>
        <StaticBoard size={board} />
      </View>
      <View style={styles.actions}>
        <Button label="Play" variant="primary" onPress={() => router.push('/play')} />
        <Button
          label="Analyze"
          onPress={() => {
            useAnalysis.getState().reset();
            router.push('/analysis');
          }}
        />
        <Button label="Settings" onPress={() => router.push('/settings')} />
      </View>
      <Text style={styles.status} testID="server-status">
        {server}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xl },
  title: { color: colors.text, ...typography.display },
  subtitle: { color: colors.textMuted, ...typography.body, marginBottom: spacing.md },
  actions: { gap: spacing.sm },
  status: { color: colors.textFaint, ...typography.caption, textAlign: 'center' },
});
