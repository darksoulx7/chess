import { pickRandomVariation, type Opening, type OpeningIndex } from '@chess/openings';

export type VariationChoice = 'any' | 'random' | (string & {});

export interface OpeningSelection {
  familyId: string | null;
  /** `any` = whole family, `random` = a random variation chosen at game start, otherwise a node id. */
  variation: VariationChoice;
  /** Opening depth in full moves. */
  maxMoves: number;
}

export interface ResolvedOpening {
  id: string;
  name: string;
  maxMoves: number;
}

export const DEPTH_CHOICES = [4, 6, 8, 10, 12, 15] as const;
export const DEFAULT_SELECTION: OpeningSelection = {
  familyId: null,
  variation: 'any',
  maxMoves: 10,
};

/** Turns the picker state into the opening the game will follow (random variations are drawn here, once per game). */
export function resolveOpening(
  index: OpeningIndex,
  selection: OpeningSelection,
  rng: () => number,
): ResolvedOpening | null {
  if (!selection.familyId) return null;
  const family = index.get(selection.familyId);
  if (!family) return null;
  let chosen: Opening | null = family;
  if (selection.variation === 'random') chosen = pickRandomVariation(index, family.id, rng);
  else if (selection.variation !== 'any') chosen = index.get(selection.variation) ?? null;
  if (!chosen) return null;
  return { id: chosen.id, name: chosen.name, maxMoves: selection.maxMoves };
}

export interface VariationRow {
  id: string;
  label: string;
  eco: string;
  plies: number;
}

/** Direct variations of a family with the family prefix removed from the label. */
export function variationRows(index: OpeningIndex, familyId: string): VariationRow[] {
  const family = index.get(familyId);
  if (!family) return [];
  return index.children(familyId).map((o) => ({
    id: o.id,
    label: o.name.startsWith(`${family.name}: `) ? o.name.slice(family.name.length + 2) : o.name,
    eco: o.eco,
    plies: o.moves.length,
  }));
}

/** Selecting any search hit: its family becomes the family, the hit itself the variation. */
export function selectionFromNode(
  index: OpeningIndex,
  nodeId: string,
  maxMoves: number,
): OpeningSelection | null {
  const node = index.get(nodeId);
  const family = index.familyOf(nodeId);
  if (!node || !family) return null;
  return { familyId: family.id, variation: node.id === family.id ? 'any' : node.id, maxMoves };
}
