import {
  ChessGame,
  type Color,
  type MoveError,
  type MoveInput,
  type MoveRecord,
  type Result,
} from '@chess/chess-core';
import { useMemo } from 'react';
import { create } from 'zustand';
import { deriveGameView, type GameView } from './game-view';

interface LocalGameState {
  game: ChessGame;
  /** Bumped on every mutation of `game` so selectors/memos can react to it. */
  version: number;
  orientation: Color;
  makeMove: (move: MoveInput) => Result<MoveRecord, MoveError>;
  undo: () => void;
  reset: () => void;
  flip: () => void;
}

export const useLocalGame = create<LocalGameState>((set, get) => ({
  game: ChessGame.create(),
  version: 0,
  orientation: 'w',
  makeMove: (move) => {
    const result = get().game.makeMove(move);
    if (result.ok) set((s) => ({ version: s.version + 1 }));
    return result;
  },
  undo: () => {
    if (get().game.undo()) set((s) => ({ version: s.version + 1 }));
  },
  reset: () => set((s) => ({ game: ChessGame.create(), version: s.version + 1 })),
  flip: () => set((s) => ({ orientation: s.orientation === 'w' ? 'b' : 'w' })),
}));

export function useLocalGameView(): GameView {
  const game = useLocalGame((s) => s.game);
  const version = useLocalGame((s) => s.version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => deriveGameView(game), [game, version]);
}
