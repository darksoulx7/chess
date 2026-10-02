import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { Segmented } from '../src/components/Segmented';
import { ToggleRow } from '../src/components/ToggleRow';
import { StaticBoard } from '../src/features/chess/StaticBoard';
import { BOARD_THEMES, PIECE_THEMES } from '../src/features/chess/themes';
import { useSettings, type AnimationSpeed } from '../src/features/settings/settings-store';
import { playSound } from '../src/features/settings/sounds';
import { colors, radius, spacing, typography } from '../src/theme/tokens';
import { Pressable } from 'react-native';

// Scholar's-mate position: shows last-move and check highlighting in the preview.
const PREVIEW_FEN = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';

const SPEEDS: Array<{ value: AnimationSpeed; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'fast', label: 'Fast' },
  { value: 'normal', label: 'Normal' },
  { value: 'slow', label: 'Slow' },
];

export default function Settings() {
  const router = useRouter();
  const s = useSettings();
  const { width } = useWindowDimensions();
  const preview = Math.min(width - 32, 320);

  return (
    <Screen scroll>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.previewWrap}>
        <StaticBoard
          size={preview}
          fen={PREVIEW_FEN}
          lastMove={{ from: 'h5', to: 'f7' }}
          checkSquare="e8"
        />
      </View>

      <Section label="Board theme">
        <View style={styles.swatches}>
          {BOARD_THEMES.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="radio"
              accessibilityLabel={`${t.name} board`}
              aria-checked={s.boardThemeId === t.id}
              onPress={() => s.set('boardThemeId', t.id)}
              style={[styles.swatch, s.boardThemeId === t.id && styles.swatchSelected]}
            >
              <View style={styles.swatchSquares}>
                {[t.lightSquare, t.darkSquare, t.darkSquare, t.lightSquare].map((c, i) => (
                  <View key={i} style={{ width: '50%', height: '50%', backgroundColor: c }} />
                ))}
              </View>
              <Text style={styles.swatchLabel}>{t.name}</Text>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section label="Piece set">
        <Segmented
          label="Piece set"
          value={s.pieceThemeId}
          onChange={(v) => s.set('pieceThemeId', v)}
          options={PIECE_THEMES.map((t) => ({ value: t.id, label: t.name }))}
        />
      </Section>

      <Section label="Animation speed">
        <Segmented
          label="Animation speed"
          value={s.animationSpeed}
          onChange={(v) => s.set('animationSpeed', v)}
          options={SPEEDS}
        />
      </Section>

      <Section label="Board">
        <ToggleRow
          label="Coordinates"
          value={s.showCoordinates}
          onChange={(v) => s.set('showCoordinates', v)}
        />
        <ToggleRow
          label="Legal move indicators"
          value={s.showLegalMoves}
          onChange={(v) => s.set('showLegalMoves', v)}
        />
        <ToggleRow
          label="Highlight last move"
          value={s.showLastMove}
          onChange={(v) => s.set('showLastMove', v)}
        />
        <ToggleRow
          label="Highlight check"
          value={s.showCheck}
          onChange={(v) => s.set('showCheck', v)}
        />
        <ToggleRow
          label="Move confirmation"
          hint="Tap the destination twice to confirm a move. Dragging is never confirmed."
          value={s.moveConfirmation}
          onChange={(v) => s.set('moveConfirmation', v)}
        />
        <ToggleRow
          label="Sound"
          value={s.soundEnabled}
          onChange={(v) => {
            s.set('soundEnabled', v);
            if (v) setTimeout(() => playSound('move'), 0);
          }}
        />
      </Section>

      <Button label="Reset to defaults" variant="ghost" onPress={s.reset} />
      <Button label="Done" variant="primary" onPress={() => router.back()} />
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
  previewWrap: { alignItems: 'center' },
  section: { gap: spacing.sm },
  label: { color: colors.textMuted, ...typography.label, textTransform: 'uppercase' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  swatch: {
    width: 76,
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: { borderColor: colors.accent },
  swatchSquares: {
    width: 56,
    height: 56,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  swatchLabel: { color: colors.textMuted, ...typography.caption },
});
