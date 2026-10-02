import type { EngineLine, Score } from './types';

/** Parses a UCI `info` line into a search line, or null for lines without a score/pv (e.g. `info string`). */
export function parseInfoLine(line: string): EngineLine | null {
  if (!line.startsWith('info ')) return null;
  const t = line.split(/\s+/);
  const get = (key: string): string | undefined => {
    const i = t.indexOf(key);
    return i >= 0 ? t[i + 1] : undefined;
  };

  const scoreAt = t.indexOf('score');
  const pvAt = t.indexOf('pv');
  if (scoreAt < 0 || pvAt < 0) return null;
  const kind = t[scoreAt + 1];
  const raw = Number(t[scoreAt + 2]);
  if ((kind !== 'cp' && kind !== 'mate') || !Number.isFinite(raw)) return null;
  // Bound lines (lowerbound/upperbound) are not final scores for the line.
  const bound = t[scoreAt + 3];
  if (bound === 'lowerbound' || bound === 'upperbound') return null;

  const score: Score = kind === 'cp' ? { type: 'cp', value: raw } : { type: 'mate', value: raw };
  const pv = t.slice(pvAt + 1).filter((m) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m));
  if (pv.length === 0) return null;

  const depth = Number(get('depth'));
  const multipv = Number(get('multipv') ?? 1);
  const nodes = get('nodes');
  const out: EngineLine = {
    multipv: Number.isInteger(multipv) && multipv > 0 ? multipv : 1,
    depth: Number.isFinite(depth) ? depth : 0,
    score,
    pv,
  };
  if (nodes !== undefined && Number.isFinite(Number(nodes))) out.nodes = Number(nodes);
  return out;
}

/** Returns the move from a `bestmove` line; `null` when the engine reports `(none)` (no legal moves). */
export function parseBestMove(line: string): { move: string | null } | null {
  const m = /^bestmove\s+(\S+)/.exec(line);
  if (!m) return null;
  const move = m[1] as string;
  return { move: move === '(none)' || move === '0000' ? null : move };
}

/** Builds the `go` command for the given limits. At least one limit is always present. */
export function buildGoCommand(limits: {
  depth?: number;
  nodes?: number;
  movetimeMs?: number;
}): string {
  const parts: string[] = ['go'];
  if (limits.depth !== undefined)
    parts.push('depth', String(Math.max(1, Math.floor(limits.depth))));
  if (limits.nodes !== undefined)
    parts.push('nodes', String(Math.max(1, Math.floor(limits.nodes))));
  if (limits.movetimeMs !== undefined)
    parts.push('movetime', String(Math.max(1, Math.floor(limits.movetimeMs))));
  if (parts.length === 1) parts.push('depth', '10');
  return parts.join(' ');
}
