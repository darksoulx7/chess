import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { getApiUrl } from '../src/services/config';

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
  const { data, error, isLoading } = useQuery({ queryKey: ['ready'], queryFn: fetchReadiness });
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Chess</Text>
      <Link href="/play/local" style={styles.link}>
        Play on this device
      </Link>
      <Text style={styles.status}>
        {isLoading
          ? 'Connecting to server…'
          : error
            ? 'Server unreachable'
            : `Server ${data?.status} · db ${data?.database} · redis ${data?.redis}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { color: '#f2f2f2', fontSize: 40, fontWeight: '700' },
  link: { color: '#8ab4ff', fontSize: 18, fontWeight: '600' },
  status: { color: '#9aa0a6', fontSize: 14 },
});
