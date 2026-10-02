import type { PieceType } from '@chess/chess-core';
import { StyleSheet, View } from 'react-native';
import { PieceGlyph } from '../features/chess/PieceGlyph';
import { getPieceTheme } from '../features/chess/themes';
import { colors } from '../theme/tokens';

const PIECE: Record<string, PieceType> = {
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
  pawn: 'p',
};

export function Avatar({ id, size = 48 }: { id: string; size?: number }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Avatar: ${id}`}
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <PieceGlyph
        type={PIECE[id] ?? 'n'}
        color="w"
        theme={getPieceTheme('classic')}
        size={size * 0.85}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.accent,
  },
});
