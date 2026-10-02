import { ChessGame } from '@chess/chess-core';
import { describe, expect, it } from 'vitest';
import {
  createOpeningBook,
  formatOpeningLine,
  getOpeningIndex,
  identifyOpening,
  pickRandomVariation,
} from '../src';
import { createRng } from '@chess/engine';

const index = getOpeningIndex();
const play = (...sans: string[]) => {
  const g = ChessGame.create();
  for (const s of sans) if (!g.makeMoveSan(s).ok) throw new Error(`illegal ${s}`);
  return g;
};
const uci = (g: ChessGame) => g.getHistory().map((m) => m.lan);

describe('search', () => {
  it('finds openings case- and diacritic-insensitively, best matches first', () => {
    const r = index.search('najdorf');
    expect(r.length).toBeGreaterThan(3);
    expect(r.every((o) => /najdorf/i.test(o.name))).toBe(true);
    expect(index.search('KOSTIC').some((o) => o.name.includes('Kostić'))).toBe(true);
    expect(index.search('giuoco piano')[0]?.name).toBe('Italian Game: Giuoco Piano');
  });
  it('multi-term search requires all terms; empty query is empty', () => {
    expect(
      index
        .search('sicilian dragon')
        .every((o) => /sicilian/i.test(o.name) && /dragon/i.test(o.name)),
    ).toBe(true);
    expect(index.search('   ')).toEqual([]);
    expect(index.search('zzzzqqq')).toEqual([]);
    expect(index.search('sicilian', 5)).toHaveLength(5);
  });
});

describe('hierarchy queries', () => {
  it('lists families, children and subtrees', () => {
    const italian = index.families.find((f) => f.name === 'Italian Game')!;
    const kids = index.children(italian.id);
    expect(kids.some((k) => k.name === 'Italian Game: Giuoco Piano')).toBe(true);
    const sub = index.subtree('italian-game-giuoco-piano');
    expect(sub[0]?.id).toBe('italian-game-giuoco-piano');
    expect(sub.length).toBeGreaterThan(3);
    expect(index.familyOf('italian-game-giuoco-piano-aitken-variation')?.name).toBe('Italian Game');
    expect(index.subtree('nope')).toEqual([]);
  });
});

describe('identifyOpening', () => {
  it('returns null for the start position and non-opening moves', () => {
    expect(identifyOpening(index, [])).toBeNull();
    expect(identifyOpening(index, ['a2a4', 'h7h6'])?.opening.name ?? 'none').not.toMatch(/Italian/);
  });
  it('finds the deepest named line', () => {
    const g = play('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5');
    const m = identifyOpening(index, uci(g));
    expect(m?.opening.name).toBe('Italian Game: Giuoco Piano');
    expect(m?.plies).toBe(6);
    const najdorf = play('e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6');
    expect(identifyOpening(index, uci(najdorf))?.opening.name).toMatch(/Najdorf/);
  });
  it('keeps the match as the game continues past the book', () => {
    const g = play('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'a6', 'a4', 'h6');
    expect(identifyOpening(index, uci(g))?.opening.name).toMatch(/^Italian Game/);
  });
});

describe('opening book (bot repertoire)', () => {
  const rng = (seed: number) => createRng(seed);

  it('as White follows the selected line move by move', () => {
    const book = createOpeningBook(index, { openingId: 'italian-game-giuoco-piano', maxMoves: 10 });
    const g = ChessGame.create();
    expect(book.pickMove(g, rng(1))).toBe('e2e4');
    play2(g, 'e4', 'e5');
    expect(book.pickMove(g, rng(1))).toBe('g1f3');
    play2(g, 'Nf3', 'Nc6');
    expect(book.pickMove(g, rng(1))).toBe('f1c4');
  });

  it('continues into sub-variations after the base line ends, within the depth', () => {
    const book = createOpeningBook(index, { openingId: 'italian-game-giuoco-piano', maxMoves: 10 });
    const g = play('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5');
    const next = book.pickMove(g, rng(3));
    expect(next).not.toBeNull();
    expect(g.makeMoveUci(next as string).ok).toBe(true); // the book move is legal
  });

  it('stops at the configured depth', () => {
    const book = createOpeningBook(index, { openingId: 'italian-game', maxMoves: 2 });
    expect(book.pickMove(play('e4', 'e5', 'Nf3', 'Nc6'), rng(1))).toBeNull(); // 2 full moves played
    expect(book.pickMove(play('e4', 'e5'), rng(1))).not.toBeNull();
    expect(
      createOpeningBook(index, { openingId: 'italian-game', maxMoves: 0 }).pickMove(
        ChessGame.create(),
        rng(1),
      ),
    ).toBeNull();
  });

  it('hands over to the engine when the opponent deviates', () => {
    const book = createOpeningBook(index, { openingId: 'sicilian-defense', maxMoves: 10 });
    // bot is Black: 1.e4 c5 is Sicilian, so book answers 1.e4 with c5
    expect(book.pickMove(play('e4'), rng(1))).toBe('c7c5');
    // human played 1.d4: nothing in the Sicilian subtree matches
    expect(book.pickMove(play('d4'), rng(1))).toBeNull();
    // Bb5+ is a named Sicilian line (Canal Attack), so the book still has an answer there
    expect(book.pickMove(play('e4', 'c5', 'Nf3', 'd6', 'Bb5+'), rng(1))).not.toBeNull();
    // human leaves every known line later
    expect(book.pickMove(play('e4', 'c5', 'Nf3', 'd6', 'a3'), rng(1))).toBeNull();
  });

  it('is deterministic per seed and varies across seeds for a broad family', () => {
    const book = createOpeningBook(index, { openingId: 'sicilian-defense', maxMoves: 10 });
    const g = play('e4', 'c5');
    const a = Array.from({ length: 300 }, (_, i) => book.pickMove(g, rng(i)));
    const b = Array.from({ length: 300 }, (_, i) => book.pickMove(g, rng(i)));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(2); // several different 2nd moves are in the repertoire
    expect(a.every((m) => m !== null && g.clone().makeMoveUci(m as string).ok)).toBe(true);
  });

  it('prefers more mainline moves (weighted by supporting lines)', () => {
    const book = createOpeningBook(index, { openingId: 'sicilian-defense', maxMoves: 10 });
    const g = play('e4', 'c5');
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i++) {
      const m = book.pickMove(g, rng(i)) as string;
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    expect(counts.get('g1f3') ?? 0).toBe(Math.max(...counts.values())); // 2.Nf3 is the most supported
  });

  it('is a no-op for unknown openings', () => {
    expect(
      createOpeningBook(index, { openingId: 'does-not-exist', maxMoves: 10 }).pickMove(
        ChessGame.create(),
        rng(1),
      ),
    ).toBeNull();
  });
});

describe('pickRandomVariation', () => {
  it('returns a child of the family, deterministically per seed', () => {
    const fam = index.families.find((f) => f.name === 'Sicilian Defense')!;
    const kids = new Set(index.children(fam.id).map((k) => k.id));
    const picks = Array.from({ length: 30 }, (_, i) =>
      pickRandomVariation(index, fam.id, createRng(i)),
    );
    expect(picks.every((p) => p && kids.has(p.id))).toBe(true);
    expect(new Set(picks.map((p) => p!.id)).size).toBeGreaterThan(5);
    expect(pickRandomVariation(index, fam.id, createRng(5))?.id).toBe(
      pickRandomVariation(index, fam.id, createRng(5))?.id,
    );
  });
  it('returns the node itself when it has no children, and null for unknown ids', () => {
    const leaf = index.all.find((o) => o.parentId && index.children(o.id).length === 0)!;
    expect(pickRandomVariation(index, leaf.id, createRng(1))?.id).toBe(leaf.id);
    expect(pickRandomVariation(index, 'nope', createRng(1))).toBeNull();
  });
});

function play2(g: ChessGame, ...sans: string[]) {
  for (const s of sans) if (!g.makeMoveSan(s).ok) throw new Error(`illegal ${s}`);
}

describe('book with an explicit history (server use: game rebuilt from FEN has no history)', () => {
  it('uses the supplied history instead of the game history', () => {
    const history = ['e2e4', 'e7e5'];
    const fenOnly = ChessGame.fromFen(play('e4', 'e5').getFen());
    if (!fenOnly.ok) throw new Error('fen');
    const withHistory = createOpeningBook(index, {
      openingId: 'italian-game-giuoco-piano',
      maxMoves: 10,
      history,
    });
    expect(withHistory.pickMove(fenOnly.value, createRng(1))).toBe('g1f3');
    // without the history a FEN-only game looks like ply 0 and would wrongly answer 1.e4 again
    const without = createOpeningBook(index, {
      openingId: 'italian-game-giuoco-piano',
      maxMoves: 10,
    });
    expect(without.pickMove(fenOnly.value, createRng(1))).toBe('e2e4');
  });
});

describe('formatOpeningLine', () => {
  it('formats numbered SAN and respects the ply limit', () => {
    const uci = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'];
    expect(formatOpeningLine(uci)).toBe('1.e4 e5 2.Nf3 Nc6 3.Bc4');
    expect(formatOpeningLine(uci, 3)).toBe('1.e4 e5 2.Nf3');
    expect(formatOpeningLine([])).toBe('');
    expect(formatOpeningLine(['e2e4', 'zzzz'])).toBe('1.e4');
  });
});
