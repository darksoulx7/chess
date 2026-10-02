import type { OpeningIndex } from './tree';
import type { OpeningMatch } from './types';

/**
 * The deepest named opening whose line is a prefix of `moves` (UCI). Ties on length prefer the
 * more specific (deeper in the hierarchy) and then the first listed.
 */
export function identifyOpening(
  index: OpeningIndex,
  moves: readonly string[],
): OpeningMatch | null {
  let best: OpeningMatch | null = null;
  for (const o of index.all) {
    const n = o.moves.length;
    if (n === 0 || n > moves.length || (best && n <= best.plies)) continue;
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (o.moves[i] !== moves[i]) {
        ok = false;
        break;
      }
    }
    if (ok) best = { opening: o, plies: n };
  }
  return best;
}
