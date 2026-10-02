import { ChessGame } from '../src';

export function fromFen(fen: string): ChessGame {
  const r = ChessGame.fromFen(fen);
  if (!r.ok) throw new Error(`bad fen in test: ${fen}`);
  return r.value;
}

export function play(game: ChessGame, ...sans: string[]): ChessGame {
  for (const san of sans) {
    const r = game.makeMoveSan(san);
    if (!r.ok) throw new Error(`illegal move in test: ${san} (${r.error})`);
  }
  return game;
}

/** Counts leaf nodes using only the public ChessGame API. */
export function perft(game: ChessGame, depth: number): number {
  if (depth === 0) return 1;
  const moves = game.getLegalMoves();
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    const r = game.makeMove({
      from: m.from,
      to: m.to,
      ...(m.promotion ? { promotion: m.promotion } : {}),
    });
    if (!r.ok) throw new Error(`legal move rejected: ${m.lan} (${r.error})`);
    nodes += perft(game, depth - 1);
    game.undo();
  }
  return nodes;
}
