import {
  ChessGame,
  type Color,
  type MoveError,
  type MoveInput,
  type MoveRecord,
  type Result,
} from '@chess/chess-core';
import {
  createClock,
  flagged,
  press,
  stop,
  type ClockConfig,
  type ClockState,
} from '@chess/game-types';
import { useMemo } from 'react';
import { create } from 'zustand';
import {
  deriveGameView,
  getOutcome,
  type GameView,
  type Outcome,
  type ResultOverride,
} from './game-view';

interface LocalGameState {
  game: ChessGame;
  /** Bumped on every mutation of `game` so selectors/memos can react to it. */
  version: number;
  orientation: Color;
  clockConfig: ClockConfig | null;
  clock: ClockState | null;
  override: ResultOverride | null;
  newGame: (clock: ClockConfig | null) => void;
  makeMove: (move: MoveInput, now?: number) => Result<MoveRecord, MoveError>;
  /** Called by the clock ticker; ends the game if the running side's flag fell. */
  checkFlag: (now?: number) => void;
  undo: () => void;
  resign: (color: Color) => void;
  agreeDraw: () => void;
  flip: () => void;
}

const isOver = (s: LocalGameState) => s.game.isGameOver() || s.override !== null;

export const useLocalGame = create<LocalGameState>((set, get) => ({
  game: ChessGame.create(),
  version: 0,
  orientation: 'w',
  clockConfig: null,
  clock: null,
  override: null,

  newGame: (clockConfig) =>
    set((s) => ({
      game: ChessGame.create(),
      version: s.version + 1,
      clockConfig,
      clock: clockConfig ? createClock(clockConfig) : null,
      override: null,
    })),

  makeMove: (move, now = Date.now()) => {
    const s = get();
    if (s.override) return { ok: false, error: 'game-over' };
    const mover = s.game.turn();
    // A move played after the flag fell is not accepted; the game ends on time instead.
    if (s.clock) {
      const late = flagged(s.clock, now);
      if (late) {
        set({ override: { kind: 'timeout', loser: late }, clock: stop(s.clock, now) });
        return { ok: false, error: 'game-over' };
      }
    }
    const result = s.game.makeMove(move);
    if (!result.ok) return result;
    let clock = s.clock;
    if (clock) {
      clock = press(clock, mover, now).state;
      if (s.game.isGameOver()) clock = stop(clock, now);
    }
    set((prev) => ({ version: prev.version + 1, clock }));
    return result;
  },

  checkFlag: (now = Date.now()) => {
    const s = get();
    if (!s.clock || isOver(s)) return;
    const late = flagged(s.clock, now);
    if (late) set({ override: { kind: 'timeout', loser: late }, clock: stop(s.clock, now) });
  },

  // Undo is only offered without a clock: rewinding time would need a move-time log.
  undo: () => {
    const s = get();
    if (s.clock || s.override) return;
    if (s.game.undo()) set((prev) => ({ version: prev.version + 1 }));
  },

  resign: (color) => {
    const s = get();
    if (isOver(s)) return;
    set({
      override: { kind: 'resign', loser: color },
      clock: s.clock ? stop(s.clock, Date.now()) : null,
    });
  },

  agreeDraw: () => {
    const s = get();
    if (isOver(s)) return;
    set({ override: { kind: 'agreement' }, clock: s.clock ? stop(s.clock, Date.now()) : null });
  },

  flip: () => set((s) => ({ orientation: s.orientation === 'w' ? 'b' : 'w' })),
}));

export function useLocalGameView(): { view: GameView; outcome: Outcome } {
  const game = useLocalGame((s) => s.game);
  const version = useLocalGame((s) => s.version);
  const override = useLocalGame((s) => s.override);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => deriveGameView(game), [game, version]);
  const outcome = useMemo(() => getOutcome(view, override), [view, override]);
  return { view, outcome };
}
