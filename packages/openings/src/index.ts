import { OPENINGS } from './data';
import { OpeningIndex } from './tree';

export * from './types';
export { OPENINGS, OPENING_SOURCE, parseOpenings } from './data';
export { OpeningIndex } from './tree';
export { identifyOpening } from './identify';
export { formatOpeningLine } from './format';
export { createOpeningBook, pickRandomVariation, type BookOptions } from './book';

/** Shared index over the bundled dataset (built lazily on first use). */
let shared: OpeningIndex | null = null;
export function getOpeningIndex(): OpeningIndex {
  shared ??= new OpeningIndex(OPENINGS);
  return shared;
}

/** Well-known families offered first in pickers. Names must exist in the dataset (tested). */
export const FEATURED_FAMILIES = [
  'Italian Game',
  'Ruy Lopez',
  'Sicilian Defense',
  'French Defense',
  'Caro-Kann Defense',
  "Queen's Gambit",
  'English Opening',
] as const;
