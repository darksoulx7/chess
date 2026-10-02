import {
  ChessGame,
  type Color,
  type MoveError,
  type MoveInput,
  type MoveRecord,
  type Result,
  type Square,
} from '@chess/chess-core';
import type { ReviewResult } from '@chess/engine';
import { useMemo } from 'react';
import { create } from 'zustand';
import { BOT_ERROR_TEXT, BotApiError } from '../../services/bot-api';
import { parseAnalysisInput } from './analysis-input';
import { deriveAnalysisPosition, type AnalysisPosition } from './analysis-view';
import { runReview } from './review-runner';

export interface Arrow {
  from: Square;
  to: Square;
  color: string;
}

export type ReviewState =
  | { status: 'idle' }
  | { status: 'running'; done: number; total: number }
  | { status: 'done'; result: ReviewResult }
  | { status: 'error'; message: string };

export type AnalysisSource = 'start' | 'game' | 'pgn' | 'fen';
export const USER_ARROW_COLOR = '#f5a623';
export const DEPTH_CHOICES = [10, 14, 18] as const;

interface AnalysisState {
  game: ChessGame;
  /** Bumped on every mutation of `game`. */
  version: number;
  /** Half-moves played in the position being viewed (0 = initial position). */
  ply: number;
  orientation: Color;
  engineOn: boolean;
  depth: number;
  arrows: Arrow[];
  source: AnalysisSource;
  review: ReviewState;

  loadGame: (game: ChessGame, source?: AnalysisSource) => void;
  /** Loads pasted PGN/FEN. Returns an error message on failure (state unchanged). */
  loadText: (text: string) => string | null;
  goto: (ply: number) => void;
  step: (delta: number) => void;
  /** Plays a move on the analysis board; from an earlier ply this replaces the rest of the game. */
  makeMove: (move: MoveInput) => Result<MoveRecord, MoveError>;
  toggleEngine: () => void;
  setDepth: (depth: number) => void;
  flip: () => void;
  toggleArrow: (from: Square, to: Square) => void;
  clearArrows: () => void;
  startReview: () => Promise<void>;
  cancelReview: () => void;
  reset: () => void;
}

let reviewController: AbortController | null = null;

export const useAnalysis = create<AnalysisState>((set, get) => {
  /** Replace the game: everything derived from the old game (arrows, review) is dropped. */
  const replaceGame = (game: ChessGame, source: AnalysisSource, ply: number) => {
    reviewController?.abort();
    set((s) => ({
      game,
      version: s.version + 1,
      ply,
      source,
      arrows: [],
      review: { status: 'idle' },
    }));
  };

  return {
    game: ChessGame.create(),
    version: 0,
    ply: 0,
    orientation: 'w',
    engineOn: true,
    depth: 14,
    arrows: [],
    source: 'start',
    review: { status: 'idle' },

    loadGame: (game, source = 'game') =>
      replaceGame(game.clone(), source, game.getHistory().length),

    loadText: (text) => {
      const parsed = parseAnalysisInput(text);
      if (!parsed.ok) return parsed.message;
      replaceGame(
        parsed.game,
        parsed.kind,
        parsed.kind === 'fen' ? 0 : parsed.game.getHistory().length,
      );
      return null;
    },

    goto: (ply) =>
      set((s) => {
        const target = Math.max(0, Math.min(Math.trunc(ply), s.game.getHistory().length));
        return target === s.ply ? s : { ply: target, arrows: [] };
      }),

    step: (delta) => get().goto(get().ply + delta),

    makeMove: (move) => {
      const s = get();
      // Work on a copy so a rejected move leaves everything untouched.
      const next = s.game.clone();
      while (next.getHistory().length > s.ply) next.undo();
      const result = next.makeMove(move);
      if (!result.ok) return result;
      replaceGame(next, s.source === 'start' ? 'start' : s.source, next.getHistory().length);
      return result;
    },

    toggleEngine: () => set((s) => ({ engineOn: !s.engineOn })),
    setDepth: (depth) => set({ depth }),
    flip: () => set((s) => ({ orientation: s.orientation === 'w' ? 'b' : 'w' })),

    toggleArrow: (from, to) =>
      set((s) => {
        const exists = s.arrows.some((a) => a.from === from && a.to === to);
        return {
          arrows: exists
            ? s.arrows.filter((a) => !(a.from === from && a.to === to))
            : [...s.arrows, { from, to, color: USER_ARROW_COLOR }],
        };
      }),
    clearArrows: () => set({ arrows: [] }),

    startReview: async () => {
      reviewController?.abort();
      const controller = new AbortController();
      reviewController = controller;
      const { game, version, depth } = get();
      set({ review: { status: 'running', done: 0, total: game.getHistory().length + 1 } });
      try {
        const result = await runReview({
          game,
          depth: Math.min(depth, 14),
          signal: controller.signal,
          onProgress: (p) => {
            if (get().version === version && !controller.signal.aborted) {
              set({ review: { status: 'running', done: p.done, total: p.total } });
            }
          },
        });
        if (get().version === version && !controller.signal.aborted)
          set({ review: { status: 'done', result } });
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError'))
          return;
        const message =
          err instanceof BotApiError ? BOT_ERROR_TEXT[err.code] : 'The review failed.';
        if (get().version === version) set({ review: { status: 'error', message } });
      }
    },

    cancelReview: () => {
      reviewController?.abort();
      set({ review: { status: 'idle' } });
    },

    reset: () => replaceGame(ChessGame.create(), 'start', 0),
  };
});

/** The position at the current ply, derived once per (game, version, ply). */
export function useAnalysisPosition(): AnalysisPosition {
  const game = useAnalysis((s) => s.game);
  const version = useAnalysis((s) => s.version);
  const ply = useAnalysis((s) => s.ply);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => deriveAnalysisPosition(game, ply), [game, version, ply]);
}
