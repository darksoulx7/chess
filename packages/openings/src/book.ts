import type { ChessGame } from '@chess/chess-core';
import type { BookProvider } from '@chess/engine';
import type { OpeningIndex } from './tree';
import type { Opening } from './types';

export interface BookOptions {
  /** Opening (family, variation or sub-variation) the bot should follow. */
  openingId: string;
  /** Opening depth in full moves; after that the engine takes over. */
  maxMoves: number;
  /**
   * Moves played so far (UCI). Required when the book is given a game rebuilt from a FEN (the
   * server), which carries no move history; defaults to the game's own history.
   */
  history?: readonly string[];
}

/**
 * Follows lines inside the selected opening's subtree. At each of its turns the bot looks at all
 * lines that (a) belong to the selected opening, (b) match the game so far, and (c) have a next
 * move; it then picks a next move weighted by how many lines continue that way (a proxy for how
 * mainline the move is). If the opponent leaves every known line, no book move is returned and the
 * engine plays on, so deviations never force an illegal or irrelevant move.
 */
export function createOpeningBook(index: OpeningIndex, options: BookOptions): BookProvider {
  const root = index.get(options.openingId);
  const lines: Opening[] = root
    ? index.subtree(root.id).filter((o) => root.moves.every((m, i) => o.moves[i] === m))
    : [];

  return {
    pickMove(game: ChessGame, rng: () => number): string | null {
      const history = options.history ?? game.getHistory().map((m) => m.lan);
      const ply = history.length;
      if (!root || ply >= options.maxMoves * 2) return null;

      const counts = new Map<string, number>();
      for (const line of lines) {
        if (line.moves.length <= ply) continue;
        let matches = true;
        for (let i = 0; i < ply; i++) {
          if (line.moves[i] !== history[i]) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
        const next = line.moves[ply] as string;
        counts.set(next, (counts.get(next) ?? 0) + 1);
      }
      if (counts.size === 0) return null;

      const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const total = entries.reduce((n, [, c]) => n + c, 0);
      let r = rng() * total;
      for (const [move, count] of entries) {
        r -= count;
        if (r <= 0) return move;
      }
      return entries[0]?.[0] ?? null;
    },
  };
}

/** Picks a random sub-line of a family/variation (for "Random variation"), weighted toward deeper named lines. */
export function pickRandomVariation(
  index: OpeningIndex,
  openingId: string,
  rng: () => number,
): Opening | null {
  const children = index.children(openingId);
  if (children.length === 0) return index.get(openingId) ?? null;
  return children[Math.floor(rng() * children.length)] ?? null;
}
