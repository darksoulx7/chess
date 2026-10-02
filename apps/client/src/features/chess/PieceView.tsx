import type { Color } from '@chess/chess-core';
import { memo, useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { PieceGlyph } from './PieceGlyph';
import { squareToPoint } from './geometry';
import { PIECE_NAMES, type PieceTheme } from './themes';
import type { TrackedPiece } from './tracked-pieces';

interface Props {
  piece: TrackedPiece;
  size: number;
  orientation: Color;
  theme: PieceTheme;
  durationMs: number;
  dragId: SharedValue<string>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  /** True while the current position change came from a drop (no slide animation). */
  instant: SharedValue<boolean>;
}

export const PieceView = memo(function PieceView({
  piece,
  size,
  orientation,
  theme,
  durationMs,
  dragId,
  dragX,
  dragY,
  instant,
}: Props) {
  const cell = size / 8;
  const target = squareToPoint(piece.square, size, orientation);
  const x = useSharedValue(target.x);
  const y = useSharedValue(target.y);
  const id = piece.id;

  useEffect(() => {
    if (durationMs <= 0 || instant.get()) {
      x.value = target.x;
      y.value = target.y;
    } else {
      const config = { duration: durationMs, easing: Easing.out(Easing.cubic) };
      x.value = withTiming(target.x, config);
      y.value = withTiming(target.y, config);
    }
  }, [target.x, target.y, durationMs, x, y, instant]);

  const style = useAnimatedStyle(() => {
    const dragging = dragId.value === id;
    return {
      transform: [
        { translateX: dragging ? dragX.value : x.value },
        { translateY: dragging ? dragY.value : y.value },
        { scale: dragging ? 1.12 : 1 },
      ],
      zIndex: dragging ? 20 : 1,
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, top: 0, width: cell, height: cell }, style]}
      accessible
      accessibilityLabel={`${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[piece.type]} on ${piece.square}`}
    >
      <PieceGlyph type={piece.type} color={piece.color} theme={theme} size={cell} />
    </Animated.View>
  );
});
