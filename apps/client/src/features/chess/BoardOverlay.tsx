import type { Color, Square } from '@chess/chess-core';
import React, { memo } from 'react';
import Svg, { Circle, Defs, Polygon, RadialGradient, Rect, Stop, Line } from 'react-native-svg';
import { arrowGeometry } from './arrows';
import { isLightSquare, squareToPoint } from './geometry';
import type { BoardTheme } from './themes';

export interface BoardArrow {
  from: Square;
  to: Square;
  color: string;
  /** 0..1, default 0.8 */
  opacity?: number;
}

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
  /** Annotation / engine arrows, drawn above highlights and below the pieces. */
  arrows?: BoardArrow[];
  /** Keyboard cursor (web); drawn as an outline. */
  cursor?: Square | null;
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
  cursor,
  arrows,
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
      {cursor
        ? (() => {
            const p = squareToPoint(cursor, size, orientation);
            const w = Math.max(3, cell * 0.06);
            return (
              <Rect
                key="cursor"
                x={p.x + w / 2}
                y={p.y + w / 2}
                width={cell - w}
                height={cell - w}
                fill="none"
                stroke="#ffffff"
                strokeWidth={w}
              />
            );
          })()
        : null}
      {arrows?.map((a, i) => {
        const g = arrowGeometry(a.from, a.to, size, orientation);
        const opacity = a.opacity ?? 0.8;
        if (g.circle) {
          return (
            <Circle
              key={`a${i}`}
              cx={g.cx}
              cy={g.cy}
              r={cell * 0.46}
              fill="none"
              stroke={a.color}
              strokeWidth={cell * 0.07}
              opacity={opacity}
            />
          );
        }
        return (
          <React.Fragment key={`a${i}`}>
            <Line
              x1={g.x1}
              y1={g.y1}
              x2={g.x2}
              y2={g.y2}
              stroke={a.color}
              strokeWidth={cell * 0.16}
              strokeLinecap="round"
              opacity={opacity}
            />
            <Polygon
              points={g.head.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={a.color}
              opacity={opacity}
            />
          </React.Fragment>
        );
      })}
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
