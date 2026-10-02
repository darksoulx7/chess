import type { Color, PromotionPiece, Square } from '@chess/chess-core';
import { Pressable, View } from 'react-native';
import { PieceGlyph } from './PieceGlyph';
import { squareToPoint } from './geometry';
import type { PieceTheme } from './themes';

const CHOICES: PromotionPiece[] = ['q', 'n', 'r', 'b'];
const LABEL: Record<PromotionPiece, string> = {
  q: 'Queen',
  n: 'Knight',
  r: 'Rook',
  b: 'Bishop',
};

interface Props {
  size: number;
  orientation: Color;
  to: Square;
  color: Color;
  theme: PieceTheme;
  onChoose: (piece: PromotionPiece) => void;
  onCancel: () => void;
}

export function PromotionPicker({
  size,
  orientation,
  to,
  color,
  theme,
  onChoose,
  onCancel,
}: Props) {
  const cell = size / 8;
  const p = squareToPoint(to, size, orientation);
  // Stack grows from the promotion square toward the middle of the board.
  const growsDown = p.y < size / 2;
  const top = growsDown ? p.y : p.y - cell * 3;

  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, zIndex: 50 }}>
      <Pressable
        accessibilityLabel="Cancel promotion"
        onPress={onCancel}
        style={{ position: 'absolute', inset: 0, backgroundColor: '#000000a0' }}
      />
      <View
        style={{
          position: 'absolute',
          left: p.x,
          top,
          width: cell,
          backgroundColor: '#f4f4f5',
          borderRadius: 8,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOpacity: 0.4,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        {(growsDown ? CHOICES : [...CHOICES].reverse()).map((piece) => (
          <Pressable
            key={piece}
            accessibilityRole="button"
            accessibilityLabel={`Promote to ${LABEL[piece]}`}
            onPress={() => onChoose(piece)}
            style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
              width: cell,
              height: cell,
              backgroundColor: hovered || pressed ? '#d9e4ff' : 'transparent',
            })}
          >
            <PieceGlyph type={piece} color={color} theme={theme} size={cell} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
