import type { MoveInput, Square } from '@chess/chess-core';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Sheet } from '../../components/Sheet';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { ChessBoard } from '../chess/ChessBoard';
import { getBoardTheme, getPieceTheme } from '../chess/themes';
import { useSettings } from '../settings/settings-store';
import { playSound } from '../settings/sounds';
import { MoveList } from './MoveList';
import { PlayerBar } from './PlayerBar';
import { GameOverSheet } from './GameOverSheet';
import { materialAdvantage, summarizeCaptures } from './captured';
import { useLocalGame, useLocalGameView } from './local-game-store';
import { soundFor } from './sound-events';
import { useClockDisplay } from './use-clock-display';

const BAR_HEIGHT = 52;

export function LocalGameScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { view, outcome } = useLocalGameView();
  const game = useLocalGame((s) => s.game);
  const version = useLocalGame((s) => s.version);
  const orientation = useLocalGame((s) => s.orientation);
  const clock = useLocalGame((s) => s.clock);
  const clockConfig = useLocalGame((s) => s.clockConfig);
  const { makeMove, undo, flip, newGame, resign, agreeDraw, checkFlag } = useLocalGame.getState();
  const settings = useSettings();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [confirm, setConfirm] = useState<'resign' | 'draw' | null>(null);
  const [closedVersion, setClosedVersion] = useState<number | null>(null);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const times = useClockDisplay(clock, checkFlag);

  // Sound: one effect per new move or per externally-decided result.
  const seen = useRef({ plies: view.history.length, over: outcome.over });
  useEffect(() => {
    const last = view.history.at(-1);
    if (view.history.length === seen.current.plies + 1 && last) {
      playSound(soundFor(last, view.status));
    } else if (outcome.over && !seen.current.over && !view.isOver) {
      playSound('end'); // resignation / timeout / agreed draw
    }
    seen.current = { plies: view.history.length, over: outcome.over };
  }, [view.history, view.status, view.isOver, outcome.over]);

  const wide = width >= 900;
  const board = wide
    ? Math.max(280, Math.min(height - BAR_HEIGHT * 2 - 40, width - 440, 760))
    : Math.max(260, Math.min(width - 16, height - BAR_HEIGHT * 2 - 300, 640));

  const getTargets = useCallback(
    (from: Square) => game.getLegalMoves(from).map((m) => m.to),
    [game],
  );
  const isPromotion = useCallback((f: Square, t: Square) => game.isPromotionMove(f, t), [game]);
  const onMove = useCallback(
    (move: MoveInput) => {
      const result = makeMove(move);
      if (!result.ok && result.error !== 'game-over') playSound('error');
    },
    [makeMove],
  );

  const captures = summarizeCaptures(view.history);
  const pieceTheme = getPieceTheme(settings.pieceThemeId);
  const top = orientation === 'w' ? 'b' : 'w';
  const bottom = orientation;
  const name = (c: 'w' | 'b') => (c === 'w' ? 'White' : 'Black');
  const barFor = (c: 'w' | 'b', testID: string) => (
    <PlayerBar
      testID={testID}
      name={name(c)}
      color={c}
      captured={c === 'w' ? captures.byWhite : captures.byBlack}
      advantage={materialAdvantage(captures, c)}
      clockMs={times ? times[c] : null}
      active={!outcome.over && view.turn === c && (!clock || clock.started)}
      pieceTheme={pieceTheme}
    />
  );

  const startAgain = () => {
    newGame(clockConfig);
    setClosedVersion(null);
  };

  return (
    <Screen>
      <View style={[styles.root, wide && styles.rootWide]}>
        <View style={{ width: board }}>
          {barFor(top, 'bar-top')}
          <ChessBoard
            testID="board"
            size={board}
            pieces={view.pieces}
            orientation={orientation}
            turn={view.turn}
            movableColor={outcome.over ? null : 'both'}
            boardTheme={getBoardTheme(settings.boardThemeId)}
            pieceTheme={pieceTheme}
            settings={settings}
            lastMove={view.lastMove}
            checkSquare={view.checkSquare}
            getTargets={getTargets}
            isPromotion={isPromotion}
            onMove={onMove}
            reduceMotion={reduceMotion}
          />
          {barFor(bottom, 'bar-bottom')}
        </View>

        <View style={[styles.panel, wide && { width: 320 }]}>
          <View>
            <Text style={styles.status} testID="status" accessibilityLiveRegion="polite">
              {outcome.over
                ? `${outcome.title} — ${outcome.detail}`
                : `${outcome.title}${outcome.detail ? ` — ${outcome.detail.toLowerCase()}` : ''}`}
            </Text>
          </View>
          <View style={styles.moves}>
            <MoveList history={view.history} />
          </View>
          <View style={styles.controls}>
            <Button
              label="Undo"
              onPress={undo}
              disabled={!!clock || outcome.over || view.history.length === 0}
            />
            <Button label="Flip" onPress={flip} />
            <Button label="Draw" onPress={() => setConfirm('draw')} disabled={outcome.over} />
            <Button
              label="Resign"
              variant="danger"
              onPress={() => setConfirm('resign')}
              disabled={outcome.over}
            />
          </View>
          <View style={styles.controls}>
            <Button label="New game" variant="primary" onPress={startAgain} />
            <Button label="Menu" variant="ghost" onPress={() => router.dismissTo('/')} />
          </View>
          <Text style={styles.fen} selectable testID="fen">
            {view.fen}
          </Text>
        </View>
      </View>

      <Sheet visible={confirm !== null} onClose={() => setConfirm(null)} label="Confirm">
        <Text style={styles.confirmTitle}>
          {confirm === 'resign' ? `${name(view.turn)} resigns?` : 'Agree to a draw?'}
        </Text>
        <View style={styles.controls}>
          <Button
            label={confirm === 'resign' ? 'Resign' : 'Draw'}
            variant="primary"
            onPress={() => {
              if (confirm === 'resign') resign(view.turn);
              else agreeDraw();
              setConfirm(null);
            }}
          />
          <Button label="Cancel" onPress={() => setConfirm(null)} />
        </View>
      </Sheet>

      <GameOverSheet
        visible={outcome.over && closedVersion !== version}
        outcome={outcome}
        onNewGame={startAgain}
        onClose={() => setClosedVersion(version)}
        onMenu={() => router.dismissTo('/')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingTop: spacing.sm, gap: spacing.md },
  rootWide: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: spacing.xxl,
    paddingTop: spacing.lg,
  },
  panel: { alignSelf: 'stretch', paddingHorizontal: spacing.lg, gap: spacing.md },
  status: { color: colors.text, ...typography.title, fontSize: 18 },
  moves: {
    flexShrink: 1,
    minHeight: 80,
    maxHeight: 300,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fen: { color: colors.textFaint, ...typography.caption },
  confirmTitle: { color: colors.text, ...typography.title, textAlign: 'center' },
});
