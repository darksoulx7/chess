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

export type GameMode = 'LOCAL' | 'BOT';

export interface GameConfig {
  mode: GameMode;
  clock: ClockConfig | null;
  /** BOT only: the side the human plays. */
  humanColor?: Color;
  /** BOT only: bot strength label (not an Elo). */
  botRating?: number;
}

export type BotStatus = 'idle' | 'thinking' | 'error';

interface GameState {
  game: ChessGame;
  /** Bumped on every mutation of `game` so selectors/memos can react to it. */
  version: number;
  mode: GameMode;
  orientation: Color;
  humanColor: Color;
  botRating: number | null;
  /** Salt so each game gets different (but reproducible-per-game) bot randomness. */
  gameSeed: number;
  botStatus: BotStatus;
  botError: string | null;
  /** Bumped to re-trigger the bot driver after an error. */
  botRetry: number;
  clockConfig: ClockConfig | null;
  clock: ClockState | null;
  override: ResultOverride | null;

  startGame: (config: GameConfig) => void;
  makeMove: (move: MoveInput, now?: number) => Result<MoveRecord, MoveError>;
  /** Applies the bot's reply only if the position is still the one it was computed for. */
  applyBotMove: (uci: string, forFen: string, now?: number) => boolean;
  setBotStatus: (status: BotStatus, error?: string | null) => void;
  retryBot: () => void;
  checkFlag: (now?: number) => void;
  undo: () => void;
  resign: (color: Color) => void;
  agreeDraw: () => void;
  flip: () => void;
}

const isOver = (s: GameState) => s.game.isGameOver() || s.override !== null;

export const useGame = create<GameState>((set, get) => ({
  game: ChessGame.create(),
  version: 0,
  mode: 'LOCAL',
  orientation: 'w',
  humanColor: 'w',
  botRating: null,
  gameSeed: 0,
  botStatus: 'idle',
  botError: null,
  botRetry: 0,
  clockConfig: null,
  clock: null,
  override: null,

  startGame: (config) =>
    set((s) => {
      const humanColor = config.mode === 'BOT' ? (config.humanColor ?? 'w') : 'w';
      return {
        game: ChessGame.create(),
        version: s.version + 1,
        mode: config.mode,
        orientation: config.mode === 'BOT' ? humanColor : 'w',
        humanColor,
        botRating: config.mode === 'BOT' ? (config.botRating ?? 1200) : null,
        gameSeed: Math.floor(Math.random() * 0xffffffff),
        botStatus: 'idle',
        botError: null,
        clockConfig: config.clock,
        clock: config.clock ? createClock(config.clock) : null,
        override: null,
      };
    }),

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

  applyBotMove: (uci, forFen, now = Date.now()) => {
    const s = get();
    if (s.mode !== 'BOT' || s.override || s.game.getFen() !== forFen) return false;
    const parsed = s.game.makeMoveUci(uci);
    if (!parsed.ok) return false;
    // makeMoveUci already mutated the game; settle the clock the same way as a normal move.
    const mover = parsed.value.color;
    let clock = s.clock;
    if (clock) {
      clock = press(clock, mover, now).state;
      if (s.game.isGameOver()) clock = stop(clock, now);
    }
    set((prev) => ({ version: prev.version + 1, clock, botStatus: 'idle', botError: null }));
    return true;
  },

  setBotStatus: (botStatus, botError = null) => set({ botStatus, botError }),
  retryBot: () => set((s) => ({ botRetry: s.botRetry + 1, botStatus: 'idle', botError: null })),

  checkFlag: (now = Date.now()) => {
    const s = get();
    if (!s.clock || isOver(s)) return;
    const late = flagged(s.clock, now);
    if (late) set({ override: { kind: 'timeout', loser: late }, clock: stop(s.clock, now) });
  },

  /**
   * LOCAL: only without a clock (rewinding time would need a move-time log).
   * BOT: takes back the bot's reply and the human's move, only on the human's turn.
   */
  undo: () => {
    const s = get();
    if (s.clock || s.override) return;
    if (s.mode === 'BOT') {
      if (s.botStatus === 'thinking' || s.game.turn() !== s.humanColor) return;
      s.game.undo();
      if (s.game.turn() !== s.humanColor) s.game.undo();
      set((prev) => ({ version: prev.version + 1 }));
      return;
    }
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
    if (s.mode === 'BOT' || isOver(s)) return; // bots never accept draws (no offer logic yet)
    set({ override: { kind: 'agreement' }, clock: s.clock ? stop(s.clock, Date.now()) : null });
  },

  flip: () => set((s) => ({ orientation: s.orientation === 'w' ? 'b' : 'w' })),
}));

export function useGameView(): { view: GameView; outcome: Outcome } {
  const game = useGame((s) => s.game);
  const version = useGame((s) => s.version);
  const override = useGame((s) => s.override);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => deriveGameView(game), [game, version]);
  const outcome = useMemo(() => getOutcome(view, override), [view, override]);
  return { view, outcome };
}
