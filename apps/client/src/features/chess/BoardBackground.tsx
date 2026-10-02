import type { Color, Square } from '@chess/chess-core';
import { ALL_SQUARES } from '@chess/chess-core';
import { memo } from 'react';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { coordinateLabels, isLightSquare, squareToPoint } from './geometry';
import type { BoardTheme } from './themes';

interface Props {
  size: number;
  orientation: Color;
  theme: BoardTheme;
  showCoordinates: boolean;
}

export const BoardBackground = memo(function BoardBackground({
  size,
  orientation,
  theme,
  showCoordinates,
}: Props) {
  const cell = size / 8;
  const labels = coordinateLabels(orientation);
  const fontSize = Math.max(9, cell * 0.2);
  const colorOn = (light: boolean) => (light ? theme.darkSquare : theme.lightSquare);

  return (
    <Svg width={size} height={size}>
      {ALL_SQUARES.map((sq: Square) => {
        const p = squareToPoint(sq, size, orientation);
        return (
          <Rect
            key={sq}
            x={p.x}
            y={p.y}
            width={cell}
            height={cell}
            fill={isLightSquare(sq) ? theme.lightSquare : theme.darkSquare}
          />
        );
      })}
      {showCoordinates
        ? labels.ranks.map((rank, row) => (
            <SvgText
              key={`r${rank}`}
              x={cell * 0.06}
              y={row * cell + fontSize * 1.1}
              fontSize={fontSize}
              fontWeight="700"
              fontFamily="sans-serif"
              fill={colorOn(isLightSquare(`a${rank}` as Square) === (orientation === 'w'))}
            >
              {rank}
            </SvgText>
          ))
        : null}
      {showCoordinates
        ? labels.files.map((file, col) => (
            <SvgText
              key={`f${file}`}
              x={(col + 1) * cell - cell * 0.06}
              y={size - cell * 0.08}
              fontSize={fontSize}
              fontWeight="700"
              fontFamily="sans-serif"
              textAnchor="end"
              fill={colorOn(isLightSquare(`${file}1` as Square))}
            >
              {file}
            </SvgText>
          ))
        : null}
    </Svg>
  );
});
