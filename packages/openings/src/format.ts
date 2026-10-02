import { ChessGame } from '@chess/chess-core';

/** "1.e4 e5 2.Nf3 Nc6" for a UCI line, limited to `maxPlies` half-moves (all if omitted). */
export function formatOpeningLine(uciMoves: readonly string[], maxPlies = uciMoves.length): string {
  const game = ChessGame.create();
  const parts: string[] = [];
  for (const [i, uci] of uciMoves.slice(0, maxPlies).entries()) {
    const r = game.makeMoveUci(uci);
    if (!r.ok) break;
    parts.push(i % 2 === 0 ? `${i / 2 + 1}.${r.value.san}` : r.value.san);
  }
  return parts.join(' ');
}
