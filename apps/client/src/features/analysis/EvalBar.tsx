import type { Color } from '@chess/chess-core';
import type { Score } from '@chess/engine';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, typography } from '../../theme/tokens';
import { scoreLabel, whiteShare } from './analysis-format';

interface Props {
  height: number;
  /** Evaluation in White's point of view; null before the first result. */
  score: Score | null;
  orientation: Color;
  dimmed?: boolean;
  /** Text for finished positions ("1-0", "0-1", "½-½") instead of a numeric score. */
  resultLabel?: string;
}

/** Vertical evaluation bar: the light part is White's share of the position. */
export function EvalBar({ height, score, orientation, dimmed, resultLabel }: Props) {
  const share = score ? whiteShare(score) : 0.5;
  const fraction = useSharedValue(share);
  useEffect(() => {
    fraction.value = withTiming(share, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [share, fraction]);
  const whiteStyle = useAnimatedStyle(() => ({ height: `${fraction.value * 100}%` }));

  const label = resultLabel ?? (score ? scoreLabel(score) : '–');
  const whiteBetter = share >= 0.5;
  const whiteAtBottom = orientation === 'w';
  // Put the label inside the winning side's area, away from the middle.
  const labelAtBottom = whiteBetter === whiteAtBottom;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={
        score
          ? `Evaluation ${label}, ${whiteBetter ? 'White' : 'Black'} is better`
          : 'Evaluation not available'
      }
      style={[
        styles.bar,
        { height },
        dimmed && styles.dimmed,
        { flexDirection: whiteAtBottom ? 'column-reverse' : 'column' },
      ]}
      testID="eval-bar"
    >
      <Animated.View style={[styles.white, whiteStyle]} />
      <Text
        testID="eval-label"
        style={[
          styles.label,
          labelAtBottom ? styles.labelBottom : styles.labelTop,
          { color: whiteBetter ? '#18181b' : '#f4f4f5' },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    width: 30,
    backgroundColor: '#27272a',
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  dimmed: { opacity: 0.6 },
  white: { backgroundColor: '#f4f4f5', width: '100%' },
  label: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    ...typography.caption,
    fontWeight: '700',
  },
  labelTop: { top: 4 },
  labelBottom: { bottom: 4 },
});
