import type { Color, MoveInput, Piece, PromotionPiece, Square } from '@chess/chess-core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { BoardBackground } from './BoardBackground';
import { BoardOverlay, type LegalTarget } from './BoardOverlay';
import { PieceView } from './PieceView';
import { PromotionPicker } from './PromotionPicker';
import { BoardController } from './board-controller';
import { moveCursor, type CursorKey } from './keyboard';
import { useLatestCallback } from './use-latest-callback';
import {
  IDLE,
  choosePromotion,
  type InteractionContext,
  type InteractionState,
} from './interaction';
import type { BoardTheme, PieceTheme } from './themes';
import type { TrackedPiece } from './tracked-pieces';
import { ANIMATION_MS, type BoardSettings } from '../settings/settings-store';

export interface ChessBoardProps {
  size: number;
  pieces: TrackedPiece[];
  orientation: Color;
  turn: Color;
  /** Side the local user may move; null locks the board (e.g. bot thinking, game over). */
  movableColor: Color | 'both' | null;
  boardTheme: BoardTheme;
  pieceTheme: PieceTheme;
  settings: BoardSettings;
  lastMove: { from: Square; to: Square } | null;
  checkSquare: Square | null;
  getTargets: (from: Square) => Square[];
  isPromotion: (from: Square, to: Square) => boolean;
  /** Called with a candidate move; the parent validates and applies it. */
  onMove: (move: MoveInput, source: 'tap' | 'drag') => void;
  /** Reduced-motion override from the platform; forces instant moves. */
  reduceMotion?: boolean;
  testID?: string;
}

export function ChessBoard(props: ChessBoardProps) {
  const {
    size,
    pieces,
    orientation,
    turn,
    movableColor,
    boardTheme,
    pieceTheme,
    settings,
    lastMove,
    checkSquare,
    getTargets,
    isPromotion,
    onMove,
    reduceMotion,
    testID,
  } = props;

  // Selection belongs to one position: derive it from a key instead of resetting in an effect.
  const positionKey = useMemo(
    () => `${orientation}|${pieces.map((p) => `${p.id}${p.square}`).join(',')}`,
    [pieces, orientation],
  );
  const [stored, setStored] = useState<{ key: string; ix: InteractionState }>({
    key: positionKey,
    ix: IDLE,
  });
  const ix = stored.key === positionKey ? stored.ix : IDLE;

  const dragId = useSharedValue('');
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  // Drag-and-drop moves land exactly where the piece was dropped, so they skip the slide animation.
  const instantMove = useSharedValue(false);

  const pieceMap = useMemo(() => {
    const m = new Map<Square, Piece & { id: string }>();
    for (const p of pieces) m.set(p.square, { type: p.type, color: p.color, id: p.id });
    return m;
  }, [pieces]);

  const ctx: InteractionContext = useMemo(
    () => ({
      turn,
      movableColor,
      pieceAt: (sq) => pieceMap.get(sq) ?? null,
      targetsFrom: getTargets,
      isPromotion,
      confirmMoves: settings.moveConfirmation,
    }),
    [turn, movableColor, pieceMap, getTargets, isPromotion, settings.moveConfirmation],
  );

  // Gesture callbacks forward to the controller, which always sees the latest props via sync().
  const onMoveRef = useLatestCallback(onMove);
  const storeInteraction = useLatestCallback((next: InteractionState) =>
    setStored({ key: positionKey, ix: next }),
  );
  const [controller] = useState(
    () =>
      new BoardController({
        setInteraction: storeInteraction,
        emitMove: (move, instant) => {
          instantMove.value = instant;
          onMoveRef(move, instant ? 'drag' : 'tap');
        },
        startDrag: (id, x, y) => {
          dragX.value = x;
          dragY.value = y;
          dragId.value = id;
        },
        moveDrag: (x, y) => {
          dragX.value = x;
          dragY.value = y;
        },
        endDrag: () => {
          dragId.value = '';
        },
      }),
  );
  useLayoutEffect(() => {
    controller.sync({
      ctx,
      interaction: ix,
      pieceAt: (sq) => pieceMap.get(sq) ?? null,
      orientation,
      size,
    });
  });
  // Clear the instant flag once the new position has been rendered.
  useEffect(() => {
    instantMove.set(false);
  }, [pieces, instantMove]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .minDistance(4)
      .onBegin((e) => controller.begin(e.x, e.y))
      .onStart((e) => controller.startDrag(e.x, e.y))
      .onUpdate((e) => controller.updateDrag(e.x, e.y))
      .onFinalize((e, success) => controller.finishDrag(e.x, e.y, success));
    const tap = Gesture.Tap()
      .runOnJS(true)
      .maxDistance(10)
      .onEnd((e, success) => {
        if (success) controller.tap(e.x, e.y);
      });
    return Gesture.Race(pan, tap);
  }, [controller]);

  // Keyboard play (web): arrows move a cursor, Enter/Space taps it, Escape cancels.
  const rootRef = useRef<View>(null);
  const [cursor, setCursor] = useState<Square | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = rootRef.current as unknown as HTMLElement | null;
    if (!el) return;
    el.tabIndex = 0;
    el.setAttribute('role', 'application');
    // Only keyboard focus shows the cursor; clicking the board with a mouse must not.
    const onFocus = () => {
      if (el.matches(':focus-visible')) setCursor((c) => c ?? (orientation === 'w' ? 'e2' : 'e7'));
    };
    const onBlur = () => setCursor(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        setCursor((c) =>
          moveCursor(c ?? (orientation === 'w' ? 'e2' : 'e7'), e.key as CursorKey, orientation),
        );
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setCursor((c) => {
          if (c) controller.tapSquare(c);
          return c;
        });
      } else if (e.key === 'Escape') {
        controller.reset();
      }
    };
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
    };
  }, [controller, orientation]);

  const targets: LegalTarget[] = useMemo(() => {
    if (!settings.showLegalMoves || !ix.selected) return [];
    const from = ix.selected;
    const mover = pieceMap.get(from);
    return getTargets(from).map((square) => {
      const occupied = pieceMap.has(square);
      const enPassant = mover?.type === 'p' && square[0] !== from[0] && !occupied;
      return { square, capture: occupied || enPassant };
    });
  }, [ix.selected, settings.showLegalMoves, getTargets, pieceMap]);

  const durationMs = reduceMotion ? 0 : ANIMATION_MS[settings.animationSpeed];

  const pending = ix.pendingPromotion;
  const promotingColor = pending ? (pieceMap.get(pending.from)?.color ?? turn) : turn;

  return (
    <View
      ref={rootRef}
      style={{ width: size, height: size }}
      accessibilityLabel="Chess board. Use arrow keys to move the cursor, Enter to select or move."
    >
      <GestureDetector gesture={gesture}>
        <View
          testID={testID}
          accessibilityLabel="Chess board"
          style={{ width: size, height: size, overflow: 'hidden', borderRadius: 6 }}
        >
          <BoardBackground
            size={size}
            orientation={orientation}
            theme={boardTheme}
            showCoordinates={settings.showCoordinates}
          />
          <BoardOverlay
            size={size}
            orientation={orientation}
            theme={boardTheme}
            lastMove={settings.showLastMove ? lastMove : null}
            selected={ix.selected}
            armed={ix.armed}
            checkSquare={settings.showCheck ? checkSquare : null}
            targets={targets}
            cursor={cursor}
          />
          {pieces.map((piece) => (
            <PieceView
              key={piece.id}
              piece={piece}
              size={size}
              orientation={orientation}
              theme={pieceTheme}
              durationMs={durationMs}
              dragId={dragId}
              dragX={dragX}
              dragY={dragY}
              instant={instantMove}
            />
          ))}
        </View>
      </GestureDetector>
      {/* Sibling of the gesture area so picker presses never reach the board's tap handler. */}
      {pending ? (
        <PromotionPicker
          size={size}
          orientation={orientation}
          to={pending.to}
          color={promotingColor}
          theme={pieceTheme}
          onChoose={(piece: PromotionPiece) => {
            const outcome = choosePromotion(ix, piece);
            storeInteraction(outcome.state);
            if (outcome.move) onMove(outcome.move, 'tap');
          }}
          onCancel={() => storeInteraction(IDLE)}
        />
      ) : null}
    </View>
  );
}
