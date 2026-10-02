import { TIME_CONTROLS, getTimeControl } from '@chess/game-types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Screen } from '../../src/components/Screen';
import { Segmented } from '../../src/components/Segmented';
import { useGame } from '../../src/features/game/game-store';
import { colors, spacing, typography } from '../../src/theme/tokens';

export default function LocalSetup() {
  const router = useRouter();
  const [tc, setTc] = useState('none');

  const start = () => {
    useGame.getState().startGame({ mode: 'LOCAL', clock: getTimeControl(tc).config });
    router.push('/play/game');
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
