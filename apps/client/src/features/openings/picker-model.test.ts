import { createRng } from '@chess/engine';
import { getOpeningIndex } from '@chess/openings';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELECTION,
  resolveOpening,
  selectionFromNode,
  variationRows,
} from './picker-model';

const index = getOpeningIndex();
const italian = index.families.find((f) => f.name === 'Italian Game')!;

describe('resolveOpening', () => {
  it('returns null without a family (no opening) or for unknown ids', () => {
    expect(resolveOpening(index, DEFAULT_SELECTION, createRng(1))).toBeNull();
    expect(
      resolveOpening(index, { familyId: 'nope', variation: 'any', maxMoves: 8 }, createRng(1)),
    ).toBeNull();
    expect(
      resolveOpening(index, { familyId: italian.id, variation: 'nope', maxMoves: 8 }, createRng(1)),
    ).toBeNull();
  });

  it('whole family, a specific variation, and depth', () => {
    expect(
      resolveOpening(index, { familyId: italian.id, variation: 'any', maxMoves: 6 }, createRng(1)),
    ).toEqual({
      id: italian.id,
      name: 'Italian Game',
      maxMoves: 6,
    });
    const r = resolveOpening(
      index,
      { familyId: italian.id, variation: 'italian-game-giuoco-piano', maxMoves: 10 },
      createRng(1),
    );
    expect(r).toEqual({
      id: 'italian-game-giuoco-piano',
      name: 'Italian Game: Giuoco Piano',
      maxMoves: 10,
    });
  });

  it('random picks a variation of the family, reproducibly per seed, and varies across seeds', () => {
    const sel = { familyId: italian.id, variation: 'random' as const, maxMoves: 10 };
    const kids = new Set(index.children(italian.id).map((c) => c.id));
    const picks = Array.from({ length: 40 }, (_, i) => resolveOpening(index, sel, createRng(i))!);
    expect(picks.every((p) => kids.has(p.id))).toBe(true);
    expect(new Set(picks.map((p) => p.id)).size).toBeGreaterThan(4);
    expect(resolveOpening(index, sel, createRng(9))).toEqual(
      resolveOpening(index, sel, createRng(9)),
    );
  });
});

describe('variationRows / selectionFromNode', () => {
  it('lists direct variations with the family prefix stripped', () => {
    const rows = variationRows(index, italian.id);
    expect(rows.find((r) => r.id === 'italian-game-giuoco-piano')).toMatchObject({
      label: 'Giuoco Piano',
      eco: 'C50',
    });
    expect(rows.every((r) => !r.label.startsWith('Italian Game'))).toBe(true);
    expect(variationRows(index, 'nope')).toEqual([]);
  });

  it('maps a search hit to family + variation', () => {
    const hit = index.search('giuoco piano')[0]!;
    expect(selectionFromNode(index, hit.id, 8)).toEqual({
      familyId: italian.id,
      variation: hit.id,
      maxMoves: 8,
    });
    expect(selectionFromNode(index, italian.id, 8)).toEqual({
      familyId: italian.id,
      variation: 'any',
      maxMoves: 8,
    });
    expect(selectionFromNode(index, 'nope', 8)).toBeNull();
  });
});
