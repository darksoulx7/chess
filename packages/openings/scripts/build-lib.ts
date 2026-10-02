import { ChessGame } from '@chess/chess-core';

/** Compact node: [id, eco, name, parentId | null, "uci uci ..."] */
export type RawNode = [string, string, string, string | null, string];

export interface OpeningFile {
  source: { name: string; url: string; license: string; fetched: string };
  nodes: RawNode[];
}

export const SOURCE = {
  name: 'lichess-org/chess-openings',
  url: 'https://github.com/lichess-org/chess-openings',
  license: 'CC0-1.0 / public domain (per dataset README)',
  fetched: '2026-10-02',
} as const;

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Splits "1. e4 e5 2. Nf3" into SAN tokens. */
function sanTokens(pgn: string): string[] {
  return pgn
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function toUci(pgn: string, context: string): string[] {
  const game = ChessGame.create();
  const out: string[] = [];
  for (const san of sanTokens(pgn)) {
    const r = game.makeMoveSan(san);
    if (!r.ok) throw new Error(`illegal move "${san}" in ${context}`);
    out.push(r.value.lan);
  }
  return out;
}

/** "A: B, C" -> candidate parent names in order of preference: "A: B", then "A". */
export function parentNameCandidates(name: string): string[] {
  const out: string[] = [];
  const colon = name.indexOf(':');
  const family = colon >= 0 ? name.slice(0, colon) : name;
  if (colon >= 0) {
    const rest = name.slice(colon + 1).trim();
    const comma = rest.lastIndexOf(',');
    if (comma >= 0) out.push(`${family}: ${rest.slice(0, comma).trim()}`);
    out.push(family);
  }
  return out;
}

export function buildOpenings(tsvs: string[]): OpeningFile {
  interface Entry {
    eco: string;
    name: string;
    uci: string[];
  }
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const tsv of tsvs) {
    const lines = tsv.split(/\r?\n/).filter(Boolean);
    for (const line of lines.slice(1)) {
      const [eco, name, pgn] = line.split('\t');
      if (!eco || !name || !pgn) throw new Error(`malformed row: ${line}`);
      const uci = toUci(pgn, `${eco} ${name}`);
      const key = `${name}|${uci.join(' ')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ eco, name, uci });
    }
  }

  // Stable ids: slug of the name, de-duplicated with a numeric suffix in file order.
  const idCount = new Map<string, number>();
  const idOf = (name: string) => {
    const base = slug(name);
    const n = (idCount.get(base) ?? 0) + 1;
    idCount.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  const nodes: RawNode[] = [];
  const firstByName = new Map<string, string>(); // name -> id of its first entry
  const ids = entries.map((e) => idOf(e.name));
  entries.forEach((e, i) => {
    if (!firstByName.has(e.name)) firstByName.set(e.name, ids[i] as string);
  });

  // Families that only exist as a prefix of variation names get a synthetic root.
  const synthetic = new Map<string, Entry[]>();
  for (const e of entries) {
    const fam = e.name.includes(':') ? e.name.slice(0, e.name.indexOf(':')) : null;
    if (fam && !firstByName.has(fam)) {
      const list = synthetic.get(fam) ?? [];
      list.push(e);
      synthetic.set(fam, list);
    }
  }
  for (const [fam, children] of synthetic) {
    let prefix = children[0]!.uci;
    for (const c of children) {
      let k = 0;
      while (k < prefix.length && k < c.uci.length && prefix[k] === c.uci[k]) k++;
      prefix = prefix.slice(0, k);
    }
    const id = idOf(fam);
    firstByName.set(fam, id);
    nodes.push([id, children[0]!.eco, fam, null, prefix.join(' ')]);
  }

  // Entries sharing a name are alternates of one opening: the shortest line is the primary and the
  // others hang below it, so each distinct name appears once in the hierarchy.
  const idxByName = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const list = idxByName.get(e.name) ?? [];
    list.push(i);
    idxByName.set(e.name, list);
  });
  const primaryIdx = new Map<string, number>();
  for (const [name, list] of idxByName) {
    primaryIdx.set(
      name,
      list.reduce(
        (best, j) =>
          (entries[j] as Entry).uci.length < (entries[best] as Entry).uci.length ? j : best,
        list[0] as number,
      ),
    );
  }
  const isPrefix = (a: string[], b: string[]) =>
    a.length <= b.length && a.every((m, k) => b[k] === m);

  // For plain-named roots: "Queen's Gambit Declined" belongs under "Queen's Gambit" when the line extends it.
  const rootNames = [...primaryIdx.keys()].filter((n) => !n.includes(':'));
  const wordPrefixParent = (i: number): string | null => {
    const e = entries[i] as Entry;
    let best: string | null = null;
    for (const other of rootNames) {
      if (other === e.name || !e.name.startsWith(`${other} `)) continue;
      const o = entries[primaryIdx.get(other) as number] as Entry;
      if (!isPrefix(o.uci, e.uci)) continue;
      if (best === null || other.length > best.length) best = other;
    }
    return best === null ? null : (ids[primaryIdx.get(best) as number] as string);
  };

  entries.forEach((e, i) => {
    const id = ids[i] as string;
    let parentId: string | null = null;
    const primary = primaryIdx.get(e.name) as number;
    if (primary !== i) {
      parentId = ids[primary] as string; // alternate line of the same-named opening
    } else if (e.name.includes(':')) {
      for (const parentName of parentNameCandidates(e.name)) {
        const candidates = idxByName.get(parentName) ?? [];
        const prefixed = candidates
          .filter(
            (j) =>
              isPrefix((entries[j] as Entry).uci, e.uci) &&
              (entries[j] as Entry).uci.length < e.uci.length,
          )
          .sort((x, y) => (entries[y] as Entry).uci.length - (entries[x] as Entry).uci.length);
        const pick =
          prefixed[0] ?? (candidates.length > 0 ? primaryIdx.get(parentName) : undefined);
        if (pick !== undefined) {
          parentId = ids[pick] as string;
          break;
        }
        const synth = firstByName.get(parentName);
        if (synth && synth !== id) {
          parentId = synth;
          break;
        }
      }
    } else {
      parentId = wordPrefixParent(i);
    }
    nodes.push([id, e.eco, e.name, parentId, e.uci.join(' ')]);
  });

  return { source: { ...SOURCE }, nodes };
}
