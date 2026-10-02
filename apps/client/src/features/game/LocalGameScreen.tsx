import type { MoveInput, Square } from '@chess/chess-core';
import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { ChessBoard } from '../chess/ChessBoard';
import { getBoardTheme, getPieceTheme } from '../chess/themes';
import { useSettings } from '../settings/settings-store';
import { MoveList } from './MoveList';
import { useLocalGame, useLocalGameView } from './local-game-store';

function statusText(view: ReturnType<typeof useLocalGameView>): string {
  const s = view.status;
  if (s.state === 'checkmate') return `Checkmate — ${s.winner === 'w' ? 'White' : 'Black'} wins`;
  if (s.state === 'draw') {
    const reasons = {
      stalemate: 'Stalemate',
      'insufficient-material': 'Draw — insufficient material',
      'threefold-repetition': 'Draw — threefold repetition',
      'fifty-move-rule': 'Draw — fifty-move rule',
    } as const;
    return reasons[s.reason];
  }
  return `${view.turn === 'w' ? 'White' : 'Black'} to move${s.inCheck ? ' — check' : ''}`;
}

export function LocalGameScreen() {
  const { width, height } = useWindowDimensions();
  const view = useLocalGameView();
  const { game, orientation, makeMove, undo, reset, flip } = useLocalGame();
  const settings = useSettings();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const wide = width >= 900;
  const board = wide
    ? Math.max(280, Math.min(height - 64, width - 440, 760))
    : Math.max(260, Math.min(width - 16, height - 260, 640));

  const getTargets = useCallback(
    (from: Square) => game.getLegalMoves(from).map((m) => m.to),
    [game],
  );
  const isPromotion = useCallback((f: Square, t: Square) => game.isPromotionMove(f, t), [game]);
  const onMove = useCallback((move: MoveInput) => void makeMove(move), [makeMove]);

  const sideName = (c: 'w' | 'b') => (c === 'w' ? 'White' : 'Black');
  const top = orientation === 'w' ? 'b' : 'w';

  return (
    <View style={[styles.root, wide && styles.rootWide]}>
      <View style={{ width: board }}>
        <Text style={styles.player}>{sideName(top)}</Text>
        <ChessBoard
          testID="board"
          size={board}
          pieces={view.pieces}
          orientation={orientation}
          turn={view.turn}
          movableColor={view.isOver ? null : 'both'}
          boardTheme={getBoardTheme(settings.boardThemeId)}
          pieceTheme={getPieceTheme(settings.pieceThemeId)}
          settings={settings}
          lastMove={view.lastMove}
          checkSquare={view.checkSquare}
          getTargets={getTargets}
          isPromotion={isPromotion}
          onMove={onMove}
          reduceMotion={reduceMotion}
        />
        <Text style={styles.player}>{sideName(orientation)}</Text>
      </View>

      <View style={[styles.panel, wide && { width: 320, height: board + 64 }]}>
        <Text style={styles.status} testID="status" accessibilityLiveRegion="polite">
          {statusText(view)}
        </Text>
        <View style={styles.moves}>
          <MoveList history={view.history} />
        </View>
        <View style={styles.controls}>
          <Button label="Undo" onPress={undo} disabled={view.history.length === 0} />
          <Button label="Flip" onPress={flip} />
          <Button label="New game" onPress={reset} />
        </View>
        <Text style={styles.fen} selectable testID="fen">
          {view.fen}
        </Text>
        <Link href="/" style={styles.back}>
          ← Menu
        </Link>
      </View>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingTop: 12, gap: 12 },
  rootWide: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: 32,
    paddingTop: 24,
  },
  player: { color: '#a1a1aa', fontSize: 14, fontWeight: '600', paddingVertical: 6 },
  panel: { alignSelf: 'stretch', paddingHorizontal: 16, gap: 12 },
  status: { color: '#f4f4f5', fontSize: 18, fontWeight: '700' },
  moves: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 80,
    maxHeight: 320,
    backgroundColor: '#171a21',
    borderRadius: 10,
    padding: 10,
  },
  controls: { flexDirection: 'row', gap: 8 },
  button: {
    backgroundColor: '#262b36',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  pressed: { backgroundColor: '#323949' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#f4f4f5', fontWeight: '600' },
  fen: { color: '#71717a', fontSize: 11 },
  back: { color: '#8ab4ff', fontSize: 14 },
});
