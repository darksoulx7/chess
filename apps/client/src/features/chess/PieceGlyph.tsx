import type { PieceType } from '@chess/chess-core';
import { memo } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import type { PieceTheme } from './themes';

/**
 * Original piece artwork (drawn for this project; not derived from any third-party piece set).
 * 100x100 viewBox; bodies end at y=76 and sit on a shared base plate.
 */
function Body({ type, detail, line }: { type: PieceType; detail: boolean; line: string }) {
  switch (type) {
    case 'p':
      return (
        <>
          <Path d="M42 46 H58 C58 57 64 63 68 76 H32 C36 63 42 57 42 46 Z" />
          <Circle cx={50} cy={32} r={14} />
        </>
      );
    case 'r':
      return (
        <Path d="M30 22 H41 V30 H46 V22 H54 V30 H59 V22 H70 V40 L63 46 V68 L68 76 H32 L37 68 V46 L30 40 Z" />
      );
    case 'n':
      return (
        <>
          <Path d="M32 76 C32 58 38 48 48 42 L41 38 C39 33 40 28 44 24 L47 17 L53 24 C67 26 75 40 70 76 Z" />
          {detail ? <Circle cx={52} cy={33} r={2.4} fill={line} stroke="none" /> : null}
        </>
      );
    case 'b':
      return (
        <>
          <Path d="M50 20 C58 28 67 36 63 49 C62 55 59 59 59 63 H65 L67 76 H33 L35 63 H41 C41 59 38 55 37 49 C33 36 42 28 50 20 Z" />
          <Circle cx={50} cy={15} r={5} />
          {detail ? <Path d="M50 32 L58 44" fill="none" strokeLinecap="round" /> : null}
        </>
      );
    case 'q':
      return (
        <>
          <Path d="M25 34 L36 66 L33 76 H67 L64 66 L75 34 L62 50 L50 26 L38 50 Z" />
          <Circle cx={25} cy={30} r={5} />
          <Circle cx={37} cy={21} r={5} />
          <Circle cx={50} cy={17} r={5} />
          <Circle cx={63} cy={21} r={5} />
          <Circle cx={75} cy={30} r={5} />
        </>
      );
    case 'k':
      return (
        <>
          <Path d="M35 76 L33 58 C33 49 41 44 50 44 C59 44 67 49 67 58 L65 76 Z" />
          <Rect x={46} y={14} width={8} height={30} rx={1} />
          <Rect x={38} y={22} width={24} height={8} rx={1} />
        </>
      );
  }
}

export interface PieceGlyphProps {
  type: PieceType;
  color: 'w' | 'b';
  theme: PieceTheme;
  size: number;
}

export const PieceGlyph = memo(function PieceGlyph({ type, color, theme, size }: PieceGlyphProps) {
  const style = color === 'w' ? theme.white : theme.black;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <G
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth={theme.strokeWidth}
        strokeLinejoin="round"
      >
        <Body type={type} detail={theme.detail} line={style.stroke} />
        <Rect x={27} y={76} width={46} height={10} rx={3} />
      </G>
    </Svg>
  );
});
