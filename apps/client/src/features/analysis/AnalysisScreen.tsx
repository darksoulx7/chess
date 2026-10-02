import type { MoveInput, Square } from '@chess/chess-core';
import type { MoveClass } from '@chess/engine';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Segmented } from '../../components/Segmented';
import { ToggleRow } from '../../components/ToggleRow';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import type { BoardArrow } from '../chess/BoardOverlay';
import { ChessBoard } from '../chess/ChessBoard';
import { getBoardTheme, getPieceTheme } from '../chess/themes';
import { MoveList } from '../game/MoveList';
import { useSettings } from '../settings/settings-store';
import { playSound } from '../settings/sounds';
import { soundFor } from '../game/sound-events';
import { toWhite } from './analysis-format';
import { DEPTH_CHOICES, useAnalysis, useAnalysisPosition } from './analysis-store';
import { EngineLines } from './EngineLines';
import { EvalBar } from './EvalBar';
import { LoadPanel } from './LoadPanel';
import { ReviewPanel } from './ReviewPanel';
import { useEngineAnalysis } from './use-engine-analysis';

type Tab = 'moves' | 'review' | 'load';
const ENGINE_COLORS = ['#4caf50', '#4a90d9', '#9b7ed9'];

export function AnalysisScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const settings = useSettings();
  const position = useAnalysisPosition();
  const game = useAnalysis((s) => s.game);
  const ply = useAnalysis((s) => s.ply);
  const orientation = useAnalysis((s) => s.orientation);
  const engineOn = useAnalysis((s) => s.engineOn);
  const depth = useAnalysis((s) => s.depth);
  const userArrows = useAnalysis((s) => s.arrows);
  const review = useAnalysis((s) => s.review);
  const { goto, step, makeMove, toggleEngine, setDepth, flip, toggleArrow, clearArrows } =
    useAnalysis.getState();
  const [tab, setTab] = useState<Tab>('moves');

  const engine = useEngineAnalysis(position.fen, engineOn, depth, 3);
  const version = useAnalysis((s) => s.version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const history = useMemo(() => game.getHistory(), [game, version]);

  // Evaluation in White's point of view for the shown position (only trust data for this exact FEN).
  const shown = engine.data?.fen === position.fen ? engine.data : undefined;
  const whiteScore = shown?.terminal
    ? shown.terminal.state === 'checkmate'
      ? ({ type: 'mate', value: shown.terminal.winner === 'w' ? 1 : -1 } as const)
      : ({ type: 'cp', value: 0 } as const)
    : shown?.lines[0]
      ? toWhite(shown.lines[0].score, position.turn)
      : engine.data?.lines[0]
        ? toWhite(engine.data.lines[0].score, engine.data.fen.split(' ')[1] === 'b' ? 'b' : 'w')
        : null;

  const resultLabel =
    position.status.state === 'checkmate'
      ? position.status.winner === 'w'
        ? '1-0'
        : '0-1'
      : position.status.state === 'draw'
        ? '½-½'
        : undefined;

  const engineArrows: BoardArrow[] = useMemo(() => {
    if (!engineOn || !shown) return [];
    return shown.lines.flatMap((line, i) => {
      const uci = line.pv[0];
      if (!uci || uci.length < 4) return [];
      return [
        {
          from: uci.slice(0, 2) as Square,
          to: uci.slice(2, 4) as Square,
          color: ENGINE_COLORS[i] ?? '#999',
          opacity: i === 0 ? 0.85 : 0.5,
        },
      ];
    });
  }, [engineOn, shown]);
  const arrows = useMemo(() => [...engineArrows, ...userArrows], [engineArrows, userArrows]);

  const annotations = useMemo(() => {
    if (review.status !== 'done') return undefined;
    const map: Partial<Record<number, MoveClass>> = {};
    for (const m of review.result.moves) map[m.ply] = m.moveClass;
    return map;
  }, [review]);

  const wide = width >= 900;
  const bar = 30;
  const boardSize = wide
    ? Math.max(280, Math.min(height - 130, width - 460 - bar - 24, 720))
    : Math.max(240, Math.min(width - bar - 24, height - 420, 560));

  const getTargets = useCallback(
    (from: Square) => position.positionGame.getLegalMoves(from).map((m) => m.to),
    [position.positionGame],
  );
  const isPromotion = useCallback(
    (f: Square, t: Square) => position.positionGame.isPromotionMove(f, t),
    [position.positionGame],
  );
  const onMove = useCallback(
    (move: MoveInput) => {
      const r = makeMove(move);
      if (r.ok) {
        const status = useAnalysis.getState().game.getStatus();
        playSound(soundFor(r.value, status));
      }
    },
    [makeMove],
  );
  const onAnnotate = useCallback(
    (from: Square, to: Square) => toggleArrow(from, to),
    [toggleArrow],
  );

  // Web keyboard navigation: arrows / Home / End step through the game unless typing or driving the board cursor.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.closest('[role="application"]'))
      )
        return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'Home') goto(0);
      else if (e.key === 'End') goto(Number.MAX_SAFE_INTEGER);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, goto]);

  const atStart = ply === 0;
  const atEnd = ply === history.length;

  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.root, wide && styles.rootWide]}>
        <View style={styles.boardCol}>
          <View style={styles.boardRow}>
            <EvalBar
              height={boardSize}
              score={whiteScore}
              orientation={orientation}
              dimmed={engine.analyzing}
              resultLabel={resultLabel}
            />
            <ChessBoard
              testID="board"
              size={boardSize}
              pieces={position.pieces}
              orientation={orientation}
              turn={position.turn}
              movableColor={position.status.state === 'active' ? position.turn : null}
              boardTheme={getBoardTheme(settings.boardThemeId)}
              pieceTheme={getPieceTheme(settings.pieceThemeId)}
              settings={settings}
              lastMove={position.lastMove}
              checkSquare={position.checkSquare}
              getTargets={getTargets}
              isPromotion={isPromotion}
              onMove={onMove}
              arrows={arrows}
              onAnnotate={onAnnotate}
            />
          </View>
          <View style={[styles.nav, { width: boardSize + bar + spacing.sm }]}>
            <Button
              label="⏮"
              onPress={() => goto(0)}
              disabled={atStart}
              testID="nav-first"
              accessibilityLabelOverride="First move"
            />
            <Button
              label="◀"
              onPress={() => step(-1)}
              disabled={atStart}
              testID="nav-prev"
              accessibilityLabelOverride="Previous move"
            />
            <Button
              label="▶"
              onPress={() => step(1)}
              disabled={atEnd}
              testID="nav-next"
              accessibilityLabelOverride="Next move"
            />
            <Button
              label="⏭"
              onPress={() => goto(history.length)}
              disabled={atEnd}
              testID="nav-last"
              accessibilityLabelOverride="Last move"
            />
            <Button label="Flip" onPress={flip} />
          </View>
          <Text style={styles.position} testID="position-label">
            {ply === 0
              ? 'Start position'
              : `After ${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '...'} ${history[ply - 1]?.san ?? ''}`}
            {userArrows.length > 0 ? '  ·  ' : ''}
          </Text>
          {userArrows.length > 0 ? (
            <Button label="Clear arrows" variant="ghost" onPress={clearArrows} />
          ) : null}
        </View>

        <View style={[styles.panel, wide && { width: 420 }]}>
          <View style={styles.engineRow}>
            <View style={styles.flex}>
              <ToggleRow label="Engine" value={engineOn} onChange={toggleEngine} />
            </View>
          </View>
          {engineOn ? (
            <Segmented
              label="Engine depth"
              value={String(depth)}
              onChange={(v) => setDepth(Number(v))}
              options={DEPTH_CHOICES.map((d) => ({ value: String(d), label: `Depth ${d}` }))}
            />
          ) : null}
          <EngineLines engineOn={engineOn} state={engine} depth={depth} />

          <Segmented
            label="Analysis panel"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'moves', label: 'Moves' },
              { value: 'review', label: 'Review' },
              { value: 'load', label: 'Load / Export' },
            ]}
          />
          {tab === 'moves' ? (
            <View style={styles.moves}>
              <MoveList
                history={history}
                activePly={ply}
                onSelectPly={goto}
                annotations={annotations}
              />
            </View>
          ) : tab === 'review' ? (
            <ReviewPanel />
          ) : (
            <LoadPanel />
          )}
          <Button label="Menu" variant="ghost" onPress={() => router.dismissTo('/')} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', padding: spacing.md, gap: spacing.lg },
  rootWide: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: spacing.xl,
  },
  boardCol: { alignItems: 'center', gap: spacing.sm },
  boardRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  nav: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', flexWrap: 'wrap' },
  position: { color: colors.textMuted, ...typography.label },
  panel: { alignSelf: 'stretch', gap: spacing.md },
  engineRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  moves: {
    minHeight: 120,
    maxHeight: 320,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
