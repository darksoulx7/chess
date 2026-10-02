import type { Color, PieceType } from '@chess/chess-core';
import { formatClock } from '@chess/game-types';
import { StyleSheet, Text, View } from 'react-native';
import { PieceGlyph } from '../chess/PieceGlyph';
import type { PieceTheme } from '../chess/themes';
import { colors, radius, spacing, typography } from '../../theme/tokens';

interface Props {
  name: string;
  color: Color;
  /** Opponent pieces this side has captured. */
  captured: PieceType[];
  /** Material lead in pawns (shown when > 0). */
  advantage: number;
  clockMs: number | null;
  active: boolean;
  pieceTheme: PieceTheme;
  testID?: string;
}

export function PlayerBar({
  name,
  color,
  captured,
  advantage,
  clockMs,
  active,
  pieceTheme,
  testID,
}: Props) {
  const low = clockMs !== null && clockMs < 20_000;
  return (
    <View style={styles.row} testID={testID}>
      <View style={[styles.swatch, { backgroundColor: color === 'w' ? '#f4f4f5' : '#18181b' }]} />
      <Text style={styles.name}>{name}</Text>
      <View style={styles.captured} accessibilityLabel={`Captured pieces: ${captured.length}`}>
        {captured.map((p, i) => (
          <View key={`${p}${i}`} style={{ marginLeft: i === 0 ? 0 : -8 }}>
            <PieceGlyph type={p} color={color === 'w' ? 'b' : 'w'} theme={pieceTheme} size={20} />
          </View>
        ))}
        {advantage > 0 ? <Text style={styles.advantage}>+{advantage}</Text> : null}
      </View>
      {clockMs !== null ? (
        <View style={[styles.clock, active && styles.clockActive, low && styles.clockLow]}>
          <Text style={styles.clockText} testID={`${testID}-clock`}>
            {formatClock(clockMs)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingVertical: spacing.xs,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: { color: colors.text, ...typography.heading },
  captured: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.xs },
  advantage: { color: colors.textMuted, ...typography.label, marginLeft: spacing.sm },
  clock: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minWidth: 84,
    alignItems: 'center',
  },
  clockActive: { backgroundColor: '#1d2a49', borderWidth: 1, borderColor: colors.accent },
  clockLow: { backgroundColor: '#4a1f26', borderColor: colors.danger },
  clockText: { color: colors.text, ...typography.mono },
});
