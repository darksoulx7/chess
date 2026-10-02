import type { Color, Square } from '@chess/chess-core';
import { memo } from 'react';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { isLightSquare, squareToPoint } from './geometry';
import type { BoardTheme } from './themes';

export interface LegalTarget {
  square: Square;
  capture: boolean;
}

interface Props {
  size: number;
  orientation: Color;
  theme: BoardTheme;
  lastMove: { from: Square; to: Square } | null;
  selected: Square | null;
  armed: Square | null;
  checkSquare: Square | null;
  targets: LegalTarget[];
}

/** Square highlights and legal-move markers drawn between the board and the pieces. */
export const BoardOverlay = memo(function BoardOverlay({
  size,
  orientation,
  theme,
  lastMove,
  selected,
  armed,
  checkSquare,
  targets,
}: Props) {
  const cell = size / 8;
  const fill = (sq: Square, light: string, dark: string) => (isLightSquare(sq) ? light : dark);

  const rect = (sq: Square, color: string, key: string) => {
    const p = squareToPoint(sq, size, orientation);
    return <Rect key={key} x={p.x} y={p.y} width={cell} height={cell} fill={color} />;
  };

  return (
    <Svg width={size} height={size} pointerEvents="none" style={{ position: 'absolute' }}>
      <Defs>
        <RadialGradient id="check" cx="50%" cy="50%" r="60%">
          <Stop offset="0" stopColor={theme.checkSquare} stopOpacity="1" />
          <Stop offset="0.45" stopColor={theme.checkSquare} stopOpacity="0.85" />
          <Stop offset="1" stopColor={theme.checkSquare} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {lastMove
        ? [lastMove.from, lastMove.to].map((sq) =>
            rect(sq, fill(sq, theme.lastMoveLight, theme.lastMoveDark), `lm${sq}`),
          )
        : null}
      {checkSquare
        ? (() => {
            const p = squareToPoint(checkSquare, size, orientation);
            return (
              <Rect key="check" x={p.x} y={p.y} width={cell} height={cell} fill="url(#check)" />
            );
          })()
        : null}
      {selected ? rect(selected, theme.selectedSquare, 'sel') : null}
      {armed ? rect(armed, theme.selectedSquare, 'armed') : null}
      {targets.map(({ square, capture }) => {
        const p = squareToPoint(square, size, orientation);
        const cx = p.x + cell / 2;
        const cy = p.y + cell / 2;
        return capture ? (
          <Circle
            key={`t${square}`}
            cx={cx}
            cy={cy}
            r={cell * 0.44}
            fill="none"
            stroke={theme.captureIndicator}
            strokeWidth={cell * 0.09}
          />
        ) : (
          <Circle key={`t${square}`} cx={cx} cy={cy} r={cell * 0.17} fill={theme.legalMove} />
        );
      })}
    </Svg>
  );
});
