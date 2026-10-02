import { BOT_RATINGS } from '@chess/engine';
import { TIME_CONTROLS, getTimeControl } from '@chess/game-types';
import type { Color } from '@chess/chess-core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Screen } from '../../src/components/Screen';
import { Segmented } from '../../src/components/Segmented';
import { useGame } from '../../src/features/game/game-store';
import { colors, spacing, typography } from '../../src/theme/tokens';

type ColorChoice = 'w' | 'b' | 'random';

export default function BotSetup() {
  const router = useRouter();
  const [color, setColor] = useState<ColorChoice>('w');
  const [rating, setRating] = useState('1200');
  const [tc, setTc] = useState('none');

  const start = () => {
    const humanColor: Color = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
    useGame.getState().startGame({
      mode: 'BOT',
      clock: getTimeControl(tc).config,
      humanColor,
      botRating: Number(rating),
    });
    router.push('/play/game');
  };

  return (
    <Screen scroll>
      <Text style={styles.title}>Play vs Bot</Text>
      <Section label="Your color">
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
      </Section>
      <Section label="Bot strength">
        <Segmented
          label="Bot strength"
          value={rating}
          onChange={setRating}
          options={BOT_RATINGS.map((r) => ({ value: String(r), label: String(r) }))}
        />
        <Text style={styles.hint}>
          Strength levels are tuning profiles, not official ratings. Lower levels make human-like
          mistakes.
        </Text>
      </Section>
      <Section label="Time control">
        <Segmented
          label="Time control"
          value={tc}
          onChange={setTc}
          options={TIME_CONTROLS.map((t) => ({ value: t.id, label: t.label }))}
        />
      </Section>
      <Button label="Start game" variant="primary" onPress={start} testID="start-bot" />
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
  hint: { color: colors.textFaint, ...typography.caption },
});
