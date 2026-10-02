import type { MoveInput, Square } from '@chess/chess-core';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Sheet } from '../../components/Sheet';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { ChessBoard } from '../chess/ChessBoard';
import { getBoardTheme, getPieceTheme } from '../chess/themes';
import { materialAdvantage, summarizeCaptures } from '../game/captured';
import { deriveGameView, type Outcome } from '../game/game-view';
import { GameOverSheet } from '../game/GameOverSheet';
import { MoveList } from '../game/MoveList';
import { PlayerBar } from '../game/PlayerBar';
import { soundFor } from '../game/sound-events';
import { useClockDisplay } from '../game/use-clock-display';
import { useKeepAwakeWhile } from '../game/use-game-device';
import { useAuth } from '../auth/auth-store';
import { useSettings } from '../settings/settings-store';
import { playSound } from '../settings/sounds';
import { cancelOnlineGame } from './online-api';
import { buildGame, describeEnd, myColor } from './online-model';
import { useOnline } from './online-store';

const BAR_HEIGHT = 52;

export function OnlineGameScreen({ id }: { id: string }) {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const settings = useSettings();
  const userId = useAuth((s) => s.user?.id ?? null);
  const g = useOnline((s) => s.game);
  const connection = useOnline((s) => s.connection);
  const loadError = useOnline((s) => s.loadError);
  const [confirm, setConfirm] = useState<'resign' | 'abort' | null>(null);
  const [dismissedEnd, setDismissedEnd] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [shareError, setShareError] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    void useOnline.getState().open(id);
    return () => useOnline.getState().leave();
  }, [id]);

  const chess = useMemo(() => (g ? buildGame(g) : null), [g]);
  const view = useMemo(() => (chess ? deriveGameView(chess) : null), [chess]);
  const me = g ? myColor(g, userId) : null;
  useKeepAwakeWhile(g?.status === 'ACTIVE');
  const times = useClockDisplay(g?.clock ?? null, undefined, g?.offset ?? 0);

  // Sound on every new move (own optimistic moves included).
  const lastPlies = useRef(0);
  useEffect(() => {
    if (!view) return;
    const n = view.history.length;
    const last = view.history.at(-1);
    if (last && n === lastPlies.current + 1) playSound(soundFor(last, view.status));
    lastPlies.current = n;
  }, [view]);
  const finished = g?.status === 'FINISHED';
  const wasFinished = useRef(false);
  useEffect(() => {
    if (finished && !wasFinished.current) playSound('end');
    wasFinished.current = !!finished;
  }, [finished]);

  const getTargets = useCallback(
    (from: Square) => (chess ? chess.getLegalMoves(from).map((m) => m.to) : []),
    [chess],
  );
  const isPromotion = useCallback(
    (f: Square, t: Square) => (chess ? chess.isPromotionMove(f, t) : false),
    [chess],
  );
  const onMove = useCallback(
    (move: MoveInput) => {
      if (!chess) return;
      const r = chess.clone().makeMove(move);
      if (!r.ok) return playSound('error');
      useOnline.getState().move(r.value.lan);
    },
    [chess],
  );

  if (loadError) {
    return (
      <Screen scroll>
        <Text style={styles.title} testID="online-load-error">
          {loadError === 'not_found' ? 'This game does not exist.' : 'Cannot reach the server.'}
        </Text>
        <Button label="Retry" onPress={() => void useOnline.getState().open(id)} />
        <Button label="Back" variant="ghost" onPress={() => router.dismissTo('/play/online')} />
      </Screen>
    );
  }
  if (!g || !view || !chess) {
    return (
      <Screen scroll>
        <Text style={styles.muted}>Loading game…</Text>
      </Screen>
    );
  }

  if (g.status === 'WAITING') {
    const link = g.code ? `Join my chess game with code ${g.code}` : '';
    return (
      <Screen scroll>
        <Text style={styles.title}>Waiting for an opponent</Text>
        {g.code ? (
          <View style={styles.codeBox}>
            <Text style={styles.muted}>Share this code</Text>
            <Text style={styles.code} selectable testID="invite-code">
              {g.code}
            </Text>
          </View>
        ) : null}
        <Text style={styles.muted}>
          {g.isPublic ? 'Listed in the lobby. ' : ''}The game starts as soon as someone joins.
        </Text>
        {g.code ? (
          <Button
            label="Share invite"
            onPress={() => {
              setShareError(false);
              Share.share({ message: link }).catch(() => setShareError(true));
            }}
          />
        ) : null}
        {shareError ? (
          <Text style={styles.muted}>Sharing is not available here; copy the code.</Text>
        ) : null}
        <Button
          label="Cancel game"
          variant="danger"
          onPress={() => {
            void cancelOnlineGame(g.id).finally(() => router.dismissTo('/play/online'));
          }}
        />
      </Screen>
    );
  }

  const orientation = me ?? 'w';
  const top = orientation === 'w' ? 'b' : 'w';
  const wide = width >= 900;
  const board = wide
    ? Math.max(280, Math.min(height - BAR_HEIGHT * 2 - 40, width - 440, 760))
    : Math.max(260, Math.min(width - 16, height - BAR_HEIGHT * 2 - 300, 640));
  const captures = summarizeCaptures(view.history);
  const active = g.status === 'ACTIVE';
  const myTurn = active && me !== null && view.turn === me && !g.pending;
  const end = describeEnd(g.result, g.termination);
  const outcome: Outcome = finished
    ? {
        over: true,
        winner: g.result === '1-0' ? 'w' : g.result === '0-1' ? 'b' : 'draw',
        ...end,
      }
    : {
        over: false,
        winner: null,
        title: me === null ? 'Spectating' : myTurn ? 'Your move' : "Opponent's move",
        detail: view.status.state === 'active' && view.status.inCheck ? 'Check' : '',
      };
  const nameOf = (c: 'w' | 'b') => {
    const p = g.players[c];
    const base = p?.name ?? (c === 'w' ? 'White' : 'Black');
    return c === me ? `${base} (you)` : base;
  };
  const bar = (c: 'w' | 'b', testID: string) => (
    <PlayerBar
      testID={testID}
      name={nameOf(c)}
      color={c}
      captured={c === 'w' ? captures.byWhite : captures.byBlack}
      advantage={materialAdvantage(captures, c)}
      clockMs={times ? times[c] : null}
      active={active && view.turn === c && (!g.clock || g.clock.started)}
      pieceTheme={getPieceTheme(settings.pieceThemeId)}
    />
  );
  const opponentOffered = g.drawOfferBy !== null && g.drawOfferBy !== me;
  const iOffered = g.drawOfferBy !== null && g.drawOfferBy === me;
  const canAbort = active && g.moves.length < 2;
  const opp = me === 'w' ? 'b' : 'w';

  return (
    <Screen>
      <View style={[styles.root, wide && styles.rootWide]}>
        <View style={{ width: board }}>
          {bar(top, 'bar-top')}
          <ChessBoard
            testID="board"
            size={board}
            pieces={view.pieces}
            orientation={orientation}
            turn={view.turn}
            movableColor={myTurn && me ? me : null}
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
          {bar(orientation, 'bar-bottom')}
        </View>

        <View style={[styles.panel, wide && { width: 320 }]}>
          <Text style={styles.status} testID="status" accessibilityLiveRegion="polite">
            {outcome.over ? `${outcome.title} — ${outcome.detail}` : outcome.title}
            {!outcome.over && outcome.detail ? ` — ${outcome.detail.toLowerCase()}` : ''}
          </Text>
          {connection !== 'open' ? (
            <Text style={styles.warn} testID="connection-status" accessibilityLiveRegion="polite">
              {connection === 'closed' ? 'Disconnected' : 'Reconnecting…'}
            </Text>
          ) : null}
          {active && me && !g.presence[opp] ? (
            <Text style={styles.muted} testID="opponent-away">
              Opponent is offline. Their clock keeps running.
            </Text>
          ) : null}
          {g.error ? (
            <Text style={styles.warn} testID="online-error">
              {g.error === 'illegal_move' || g.error === 'not_your_turn' || g.error === 'stale'
                ? 'That move was not accepted; the board was updated.'
                : 'Action rejected. Try again.'}
            </Text>
          ) : null}
          {opponentOffered && active ? (
            <View style={styles.offer} testID="draw-offer">
              <Text style={styles.status}>Your opponent offers a draw</Text>
              <View style={styles.controls}>
                <Button
                  label="Accept draw"
                  variant="primary"
                  onPress={() => useOnline.getState().answerDraw(true)}
                />
                <Button label="Decline" onPress={() => useOnline.getState().answerDraw(false)} />
              </View>
            </View>
          ) : null}
          <View style={styles.moves}>
            <MoveList history={view.history} />
          </View>
          {active && me ? (
            <View style={styles.controls}>
              <Button
                label={iOffered ? 'Draw offered' : 'Offer draw'}
                onPress={() => useOnline.getState().offerDraw()}
                disabled={iOffered || canAbort}
              />
              {canAbort ? (
                <Button label="Abort" variant="danger" onPress={() => setConfirm('abort')} />
              ) : (
                <Button label="Resign" variant="danger" onPress={() => setConfirm('resign')} />
              )}
            </View>
          ) : null}
          <View style={styles.controls}>
            <Button
              label="Lobby"
              variant="ghost"
              onPress={() => router.dismissTo('/play/online')}
            />
            <Button label="Menu" variant="ghost" onPress={() => router.dismissTo('/')} />
          </View>
          <Text style={styles.fen} selectable testID="fen">
            {view.fen}
          </Text>
        </View>
      </View>

      <Sheet visible={confirm !== null} onClose={() => setConfirm(null)} label="Confirm">
        <Text style={styles.confirmTitle}>
          {confirm === 'resign' ? 'Resign this game?' : 'Abort this game? It will not count.'}
        </Text>
        <View style={styles.controls}>
          <Button
            label={confirm === 'resign' ? 'Resign' : 'Abort'}
            variant="primary"
            onPress={() => {
              if (confirm === 'resign') useOnline.getState().resign();
              else useOnline.getState().abort();
              setConfirm(null);
            }}
          />
          <Button label="Cancel" onPress={() => setConfirm(null)} />
        </View>
      </Sheet>

      <GameOverSheet
        visible={!!finished && !dismissedEnd}
        outcome={outcome}
        onNewGame={() => router.dismissTo('/play/online')}
        onClose={() => setDismissedEnd(true)}
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
  title: { color: colors.text, ...typography.title },
  status: { color: colors.text, ...typography.title, fontSize: 18 },
  muted: { color: colors.textMuted, ...typography.body },
  warn: { color: colors.danger, ...typography.label },
  codeBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  code: { color: colors.text, ...typography.display, letterSpacing: 4 },
  offer: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
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
