import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChessGame } from '@chess/chess-core';
import { describe, expect, it } from 'vitest';
import { buildOpenings, parentNameCandidates } from '../scripts/build-lib';
import {
  FEATURED_FAMILIES,
  OPENINGS,
  OPENING_SOURCE,
  OpeningIndex,
  getOpeningIndex,
  parseOpenings,
} from '../src';

const dataDir = join(__dirname, '../data');

describe('generated dataset', () => {
  it('is up to date with the TSV sources', { timeout: 60_000 }, () => {
    const tsvs = ['a', 'b', 'c', 'd', 'e'].map((f) =>
      readFileSync(join(dataDir, 'source', `${f}.tsv`), 'utf8'),
    );
    const regenerated = `${JSON.stringify(buildOpenings(tsvs))}\n`;
    expect(readFileSync(join(dataDir, 'openings.json'), 'utf8')).toBe(regenerated);
  });

  it('records its source and license', () => {
    expect(OPENING_SOURCE.license).toMatch(/CC0/);
    expect(OPENING_SOURCE.url).toContain('lichess-org/chess-openings');
  });

  it('every line is a legal game from the start position', { timeout: 60_000 }, () => {
    for (const o of OPENINGS) {
      const g = ChessGame.create();
      for (const uci of o.moves) {
        expect(g.makeMoveUci(uci).ok, `${o.id}: ${uci}`).toBe(true);
      }
    }
  });

  it('each distinct name appears once in the hierarchy roots', () => {
    const roots = OPENINGS.filter((o) => o.parentId === null).map((o) => o.name);
    expect(new Set(roots).size).toBe(roots.length);
  });

  it('has unique ids, resolvable parents and no cycles', () => {
    const index = new OpeningIndex(OPENINGS); // throws on duplicate ids / unknown parents
    for (const o of OPENINGS) {
      let node = o;
      for (let i = 0; i < 20 && node.parentId; i++) node = index.get(node.parentId) as typeof o;
      expect(node.parentId, `cycle or deep chain at ${o.id}`).toBeNull();
    }
  });

  it('names are hierarchical: a child name starts with its parent family', () => {
    const index = getOpeningIndex();
    for (const o of OPENINGS) {
      if (!o.parentId) continue;
      const family = index.familyOf(o.id)!;
      expect(o.name.startsWith(family.name), `${o.name} vs family ${family.name}`).toBe(true);
    }
  });

  it('most children extend their parent line (the rest are transpositions)', () => {
    const index = getOpeningIndex();
    let children = 0;
    let extending = 0;
    for (const o of OPENINGS) {
      if (!o.parentId) continue;
      children++;
      const parent = index.get(o.parentId)!;
      if (parent.moves.every((m, i) => o.moves[i] === m)) extending++;
    }
    expect(extending / children).toBeGreaterThan(0.8);
  });

  it('contains the openings the product promises', () => {
    const index = getOpeningIndex();
    for (const name of FEATURED_FAMILIES) {
      const fam = index.families.find((f) => f.name === name);
      expect(fam, name).toBeDefined();
      expect(index.subtree(fam!.id).length).toBeGreaterThan(10);
    }
    const names = new Set(OPENINGS.map((o) => o.name));
    for (const n of [
      'Italian Game: Giuoco Piano',
      'Italian Game: Two Knights Defense',
      'Italian Game: Evans Gambit',
      'Sicilian Defense: Najdorf Variation',
      'Sicilian Defense: Dragon Variation',
      'Sicilian Defense: Accelerated Dragon',
      'Sicilian Defense: Scheveningen Variation',
      'Sicilian Defense: Kan Variation',
    ]) {
      expect(names.has(n), n).toBe(true);
    }
  });
});

describe('generator helpers', () => {
  it('derives parent name candidates', () => {
    expect(parentNameCandidates('Sicilian Defense')).toEqual([]);
    expect(parentNameCandidates('Sicilian Defense: Najdorf Variation')).toEqual([
      'Sicilian Defense',
    ]);
    expect(parentNameCandidates('Sicilian Defense: Najdorf Variation, English Attack')).toEqual([
      'Sicilian Defense: Najdorf Variation',
      'Sicilian Defense',
    ]);
  });

  it('rejects illegal moves in source data', () => {
    expect(() => buildOpenings(['eco\tname\tpgn\nA00\tBad\t1. e5'])).toThrow(/illegal move/);
    expect(() => buildOpenings(['eco\tname\tpgn\nbroken row'])).toThrow(/malformed/);
  });

  it('builds a small tree with a synthetic family and prefix-aware parents', () => {
    const tsv = [
      'eco\tname\tpgn',
      'B20\tX Opening: One\t1. e4 c5',
      'B20\tX Opening: One\t1. e4 c5 2. Nf3 d6',
      'B21\tX Opening: One, Deep\t1. e4 c5 2. Nf3 d6 3. d4',
      'B21\tX Opening: One, Other\t1. e4 c5 2. c3',
    ].join('\n');
    const { nodes } = buildOpenings([tsv]);
    const byId = new Map(nodes.map((n) => [n[0], n]));
    expect(byId.get('x-opening')?.[3]).toBeNull(); // synthetic family
    expect(byId.get('x-opening')?.[4]).toBe('e2e4 c7c5'); // common prefix
    expect(byId.get('x-opening-one-2')?.[3]).toBe('x-opening-one');
    // "Deep" extends the *second* "One" line, so it attaches there, not to the first
    expect(byId.get('x-opening-one-deep')?.[3]).toBe('x-opening-one-2');
    expect(byId.get('x-opening-one-other')?.[3]).toBe('x-opening-one'); // only candidate whose line is a prefix
  });
});

describe('parseOpenings / OpeningIndex errors', () => {
  it('parses compact nodes', () => {
    expect(
      parseOpenings([
        ['a', 'A00', 'A', null, 'e2e4 e7e5'],
        ['b', 'A00', 'A: B', 'a', ''],
      ]),
    ).toEqual([
      { id: 'a', eco: 'A00', name: 'A', parentId: null, moves: ['e2e4', 'e7e5'] },
      { id: 'b', eco: 'A00', name: 'A: B', parentId: 'a', moves: [] },
    ]);
  });
  it('rejects duplicate ids and unknown parents', () => {
    const o = (id: string, parentId: string | null) => ({
      id,
      eco: 'A00',
      name: id,
      parentId,
      moves: [] as string[],
    });
    expect(() => new OpeningIndex([o('a', null), o('a', null)])).toThrow(/duplicate/);
    expect(() => new OpeningIndex([o('a', 'zzz')])).toThrow(/unknown parent/);
  });
});
