import { TIME_CONTROLS, getTimeControl } from '@chess/game-types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Screen } from '../../src/components/Screen';
import { Segmented } from '../../src/components/Segmented';
import { useLocalGame } from '../../src/features/game/local-game-store';
import { colors, spacing, typography } from '../../src/theme/tokens';

export default function PlaySetup() {
  const router = useRouter();
  const [tc, setTc] = useState('none');

  const start = () => {
    useLocalGame.getState().newGame(getTimeControl(tc).config);
    router.push('/play/local');
  };

  return (
    <Screen scroll>
      <Text style={styles.title}>Play on this device</Text>
      <Text style={styles.hint}>Two players share one board. White moves first.</Text>
      <View style={styles.section}>
        <Text style={styles.label}>Time control</Text>
        <Segmented
          label="Time control"
          value={tc}
          onChange={setTc}
          options={TIME_CONTROLS.map((t) => ({ value: t.id, label: t.label }))}
        />
      </View>
      <Button label="Start game" variant="primary" onPress={start} testID="start-local" />
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, ...typography.title },
  hint: { color: colors.textMuted, ...typography.body },
  section: { gap: spacing.sm },
  label: { color: colors.textMuted, ...typography.label },
});
