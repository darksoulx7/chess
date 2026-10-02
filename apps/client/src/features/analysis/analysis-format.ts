import { winProbability, type Score } from '@chess/engine';

/** Score in White's point of view given the side to move that the engine score refers to. */
export function toWhite(score: Score, turn: 'w' | 'b'): Score {
  return turn === 'w' ? score : { type: score.type, value: -score.value };
}

/** Fraction (0..1) of the eval bar that belongs to White. Mate scores fill the bar completely. */
export function whiteShare(score: Score): number {
  if (score.type === 'mate') return score.value > 0 ? 1 : score.value < 0 ? 0 : 0.5;
  return winProbability(score.value);
}

/** "+0.42", "-1.30", "M3", "-M2" (White's point of view). */
export function scoreLabel(score: Score): string {
  if (score.type === 'mate') return `${score.value < 0 ? '-' : ''}M${Math.abs(score.value)}`;
  const v = score.value / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** Numbers a SAN line for display: "12. Bg5 Nf6 13. e4" or "12... Nf6 13. Bg5" depending on the side to move. */
export function formatPv(san: readonly string[], fen: string): string {
  const parts = fen.split(' ');
  let turn = parts[1] === 'b' ? 'b' : 'w';
  let move = Number(parts[5]) || 1;
  const out: string[] = [];
  san.forEach((s, i) => {
    if (turn === 'w') out.push(`${move}.`, s);
    else {
      if (i === 0) out.push(`${move}...`);
      out.push(s);
      move++;
    }
    turn = turn === 'w' ? 'b' : 'w';
  });
  return out.join(' ');
}

export interface GraphPoint {
  x: number;
  y: number;
}

/**
 * Points for an evaluation graph. `whiteEvals` are clamped centipawns (White's POV), one per position.
 * y = 0 is the top (White fully winning), y = height the bottom.
 */
export function evalGraphPoints(
  whiteEvals: readonly number[],
  width: number,
  height: number,
): GraphPoint[] {
  const n = whiteEvals.length;
  return whiteEvals.map((cp, i) => ({
    x: n <= 1 ? 0 : (i / (n - 1)) * width,
    y: (1 - winProbability(cp)) * height,
  }));
}

/** Position index (ply) nearest to an x coordinate on the graph. */
export function plyAtGraphX(x: number, width: number, positions: number): number {
  if (positions <= 1 || width <= 0) return 0;
  return Math.max(0, Math.min(positions - 1, Math.round((x / width) * (positions - 1))));
}
