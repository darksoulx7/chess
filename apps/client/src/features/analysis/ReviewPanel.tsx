import { ChessGame } from '@chess/chess-core';
import type { MoveClass, MoveReview, ReviewResult, SideSummary } from '@chess/engine';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { Button } from '../../components/Button';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { evalGraphPoints, plyAtGraphX } from './analysis-format';
import { useAnalysis } from './analysis-store';

const CLASS_LABEL: Record<MoveClass, string> = {
  book: 'Book',
  best: 'Best',
  good: 'Good',
  inaccuracy: 'Inaccuracies',
  mistake: 'Mistakes',
  blunder: 'Blunders',
};
const CLASS_ORDER: MoveClass[] = ['best', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];
const CLASS_COLOR: Record<MoveClass, string> = {
  book: '#8ab4ff',
  best: '#4ade80',
  good: '#a3e635',
  inaccuracy: '#f5c542',
  mistake: '#f59e42',
  blunder: '#f87171',
};
const PHASE_LABEL = {
  strong: 'Strong',
  solid: 'Solid',
  'needs-work': 'Needs work',
  'n/a': '—',
} as const;

export function ReviewPanel() {
  const review = useAnalysis((s) => s.review);
  const game = useAnalysis((s) => s.game);
  const ply = useAnalysis((s) => s.ply);
  const { startReview, cancelReview, goto } = useAnalysis.getState();
  const moves = game.getHistory().length;

  if (review.status === 'idle' || review.status === 'error') {
    return (
      <View style={styles.box}>
        <Text style={styles.body}>
          Analyze every move with the engine to find inaccuracies, mistakes and blunders. Thresholds
          are heuristics (centipawn loss), not exact judgments.
        </Text>
        {review.status === 'error' ? <Text style={styles.error}>{review.message}</Text> : null}
        <Button
          label={review.status === 'error' ? 'Try again' : 'Review game'}
          variant="primary"
          onPress={() => void startReview()}
          disabled={moves === 0}
          testID="start-review"
        />
        {moves === 0 ? (
          <Text style={styles.muted}>Load a game or play some moves first.</Text>
        ) : null}
      </View>
    );
  }

  if (review.status === 'running') {
    const pct = review.total > 0 ? Math.round((review.done / review.total) * 100) : 0;
    return (
      <View style={styles.box} testID="review-progress">
        <Text style={styles.body}>
          Analyzing positions… {review.done} / {review.total}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <Button label="Cancel" onPress={cancelReview} />
      </View>
    );
  }

  return <ReviewResults result={review.result} game={game} ply={ply} onSelectPly={goto} />;
}

function ReviewResults({
  result,
  game,
  ply,
  onSelectPly,
}: {
  result: ReviewResult;
  game: ChessGame;
  ply: number;
  onSelectPly: (ply: number) => void;
}) {
  const critical = useMemo(() => {
    const history = game.getHistory();
    return result.moves
      .filter((m) => m.moveClass === 'blunder' || m.moveClass === 'mistake' || m.missedOpportunity)
      .sort((a, b) => b.lossCp - a.lossCp)
      .slice(0, 6)
      .map((m) => ({ move: m, best: bestSan(history[m.ply - 1]?.before, m.bestMove) }));
  }, [result, game]);

  return (
    <View style={styles.box} testID="review-results">
      <View style={styles.accRow}>
        <Accuracy label="White" side={result.white} />
        <Accuracy label="Black" side={result.black} />
      </View>

      <EvalGraph evals={result.whiteEvals} ply={ply} onSelectPly={onSelectPly} />

      <View style={styles.table}>
        <View style={styles.tr}>
          <Text style={[styles.th, styles.tdLabel]} />
          <Text style={styles.th}>White</Text>
          <Text style={styles.th}>Black</Text>
        </View>
        {CLASS_ORDER.map((c) => (
          <View key={c} style={styles.tr}>
            <Text style={[styles.tdLabel, { color: CLASS_COLOR[c] }]}>{CLASS_LABEL[c]}</Text>
            <Text style={styles.td} testID={`count-w-${c}`}>
              {result.white.counts[c]}
            </Text>
            <Text style={styles.td} testID={`count-b-${c}`}>
              {result.black.counts[c]}
            </Text>
          </View>
        ))}
        <View style={styles.tr}>
          <Text style={styles.tdLabel}>Missed wins</Text>
          <Text style={styles.td}>{result.white.missedOpportunities}</Text>
          <Text style={styles.td}>{result.black.missedOpportunities}</Text>
        </View>
      </View>

      <View style={styles.table}>
        {(['opening', 'middlegame', 'endgame'] as const).map((p) => (
          <View key={p} style={styles.tr}>
            <Text style={styles.tdLabel}>
              {p[0]?.toUpperCase()}
              {p.slice(1)}
            </Text>
            <Text style={styles.td}>{PHASE_LABEL[result.phases.w[p].label]}</Text>
            <Text style={styles.td}>{PHASE_LABEL[result.phases.b[p].label]}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.heading}>Critical moments</Text>
      {critical.length === 0 ? <Text style={styles.muted}>No major mistakes found.</Text> : null}
      {critical.map(({ move, best }) => (
        <Pressable
          key={move.ply}
          accessibilityRole="button"
          accessibilityLabel={`Go to move ${moveNumber(move)} ${move.san}`}
          onPress={() => onSelectPly(move.ply)}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.moment,
            (pressed || hovered) && styles.momentHover,
          ]}
        >
          <Text style={styles.momentTitle}>
            {moveNumber(move)} {move.san}{' '}
            <Text
              style={{ color: CLASS_COLOR[move.moveClass === 'book' ? 'good' : move.moveClass] }}
            >
              {move.moveClass === 'blunder'
                ? 'Blunder'
                : move.moveClass === 'mistake'
                  ? 'Mistake'
                  : 'Missed opportunity'}
            </Text>
          </Text>
          <Text style={styles.muted}>
            −{(move.lossCp / 100).toFixed(1)} pawns{best ? ` · better: ${best}` : ''}
          </Text>
        </Pressable>
      ))}
      <Text style={styles.footnote}>
        Accuracy-style metric from win-probability loss; classes use centipawn thresholds
        (inaccuracy ≥ {result.thresholds.inaccuracyCp}, mistake ≥ {result.thresholds.mistakeCp},
        blunder ≥ {result.thresholds.blunderCp}). Heuristics, not exact judgments.
      </Text>
    </View>
  );
}

const moveNumber = (m: MoveReview) => `${Math.ceil(m.ply / 2)}${m.color === 'w' ? '.' : '...'}`;

function bestSan(fenBefore: string | undefined, uci: string | null): string | null {
  if (!fenBefore || !uci) return null;
  const g = ChessGame.fromFen(fenBefore);
  if (!g.ok) return null;
  const r = g.value.makeMoveUci(uci);
  return r.ok ? r.value.san : null;
}

function Accuracy({ label, side }: { label: string; side: SideSummary }) {
  return (
    <View style={styles.acc}>
      <Text style={styles.accLabel}>{label}</Text>
      <Text style={styles.accValue} testID={`accuracy-${label.toLowerCase()}`}>
        {Math.round(side.accuracy)}%
      </Text>
    </View>
  );
}

const GRAPH_H = 70;
function EvalGraph({
  evals,
  ply,
  onSelectPly,
}: {
  evals: number[];
  ply: number;
  onSelectPly: (p: number) => void;
}) {
  const width = 320;
  const pts = evalGraphPoints(evals, width, GRAPH_H);
  const line = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const area = pts.length > 1 ? `${line} L${width} ${GRAPH_H} L0 ${GRAPH_H} Z` : '';
  const cursorX = evals.length > 1 ? (ply / (evals.length - 1)) * width : 0;
  return (
    <Pressable
      accessibilityLabel="Evaluation graph. Tap to jump to a move."
      onPress={(e) => onSelectPly(plyAtGraphX(e.nativeEvent.locationX, width, evals.length))}
      style={styles.graph}
      testID="eval-graph"
    >
      <Svg
        width="100%"
        height={GRAPH_H}
        viewBox={`0 0 ${width} ${GRAPH_H}`}
        preserveAspectRatio="none"
      >
        <Rect x={0} y={0} width={width} height={GRAPH_H} fill="#27272a" />
        {area ? <Path d={area} fill="#f4f4f5" /> : null}
        <Line
          x1={0}
          y1={GRAPH_H / 2}
          x2={width}
          y2={GRAPH_H / 2}
          stroke="#71717a"
          strokeWidth={1}
        />
        <Line
          x1={cursorX}
          y1={0}
          x2={cursorX}
          y2={GRAPH_H}
          stroke={colors.accent}
          strokeWidth={2}
        />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.md },
  body: { color: colors.text, ...typography.body },
  muted: { color: colors.textMuted, ...typography.caption },
  error: { color: colors.danger, ...typography.body },
  track: {
    height: 8,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent },
  accRow: { flexDirection: 'row', gap: spacing.md },
  acc: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  accLabel: { color: colors.textMuted, ...typography.label },
  accValue: { color: colors.text, ...typography.display, fontSize: 32 },
  graph: { borderRadius: radius.sm, overflow: 'hidden' },
  table: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  th: { flex: 1, color: colors.textFaint, ...typography.caption, textAlign: 'center' },
  tdLabel: { flex: 1.4, color: colors.textMuted, ...typography.label },
  td: { flex: 1, color: colors.text, ...typography.body, textAlign: 'center' },
  heading: { color: colors.text, ...typography.heading },
  moment: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  momentHover: { backgroundColor: colors.surfaceRaised },
  momentTitle: { color: colors.text, ...typography.body },
  footnote: { color: colors.textFaint, ...typography.caption },
});
