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
import { useGame, useGameView } from './game-store';
import { useBotDriver } from './use-bot-driver';
import { soundFor } from './sound-events';
import { useClockDisplay } from './use-clock-display';

const BAR_HEIGHT = 52;

export function GameScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { view, outcome } = useGameView();
  const game = useGame((s) => s.game);
  const version = useGame((s) => s.version);
  const orientation = useGame((s) => s.orientation);
  const clock = useGame((s) => s.clock);
  const clockConfig = useGame((s) => s.clockConfig);
  const { makeMove, undo, flip, startGame, resign, agreeDraw, checkFlag, retryBot } =
    useGame.getState();
  const mode = useGame((s) => s.mode);
  const humanColor = useGame((s) => s.humanColor);
  const botRating = useGame((s) => s.botRating);
  const botStatus = useGame((s) => s.botStatus);
  const botError = useGame((s) => s.botError);
  const settings = useSettings();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [confirm, setConfirm] = useState<'resign' | 'draw' | null>(null);
  const [closedVersion, setClosedVersion] = useState<number | null>(null);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useBotDriver(view.fen, view.turn, outcome.over);
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
  const name = (c: 'w' | 'b') =>
    mode === 'BOT'
      ? c === humanColor
        ? 'You'
        : `Bot ${botRating}`
      : c === 'w'
        ? 'White'
        : 'Black';
  const sideName = (c: 'w' | 'b') => (c === 'w' ? 'White' : 'Black');
  const humanTurn = mode !== 'BOT' || view.turn === humanColor;
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
    startGame({
      mode,
      clock: clockConfig,
      humanColor: mode === 'BOT' ? humanColor : undefined,
      botRating: botRating ?? undefined,
    });
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
            movableColor={
              outcome.over
                ? null
                : mode === 'BOT'
                  ? botStatus === 'thinking' || !humanTurn
                    ? null
                    : humanColor
                  : 'both'
            }
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
          {mode === 'BOT' && !outcome.over ? (
            <View style={styles.botRow} testID="bot-status" accessibilityLiveRegion="polite">
              {botStatus === 'thinking' ? (
                <Text style={styles.botText}>Bot is thinking…</Text>
              ) : botStatus === 'error' ? (
                <>
                  <Text style={[styles.botText, styles.botError]}>{botError}</Text>
                  <Button label="Retry" variant="primary" onPress={retryBot} />
                </>
              ) : (
                <Text style={styles.botText}>
                  Strength {botRating} (target level, not an official rating)
                </Text>
              )}
            </View>
          ) : null}
          <View style={styles.moves}>
            <MoveList history={view.history} />
          </View>
          <View style={styles.controls}>
            <Button
              label="Undo"
              onPress={undo}
              disabled={
                !!clock ||
                outcome.over ||
                view.history.length === 0 ||
                (mode === 'BOT' && (botStatus === 'thinking' || !humanTurn))
              }
            />
            <Button label="Flip" onPress={flip} />
            {mode === 'LOCAL' ? (
              <Button label="Draw" onPress={() => setConfirm('draw')} disabled={outcome.over} />
            ) : null}
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
          {confirm === 'resign'
            ? mode === 'BOT'
              ? 'Resign this game?'
              : `${sideName(view.turn)} resigns?`
            : 'Agree to a draw?'}
        </Text>
        <View style={styles.controls}>
          <Button
            label={confirm === 'resign' ? 'Resign' : 'Draw'}
            variant="primary"
            onPress={() => {
              if (confirm === 'resign') resign(mode === 'BOT' ? humanColor : view.turn);
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
  botRow: { gap: spacing.sm },
  botText: { color: colors.textMuted, ...typography.body },
  botError: { color: colors.danger },
  confirmTitle: { color: colors.text, ...typography.title, textAlign: 'center' },
});
