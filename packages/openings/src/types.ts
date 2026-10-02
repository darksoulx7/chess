/**
 * One named opening line. Families, variations and sub-variations are all nodes; hierarchy comes
 * from `parentId` (the node's name starts with its parent's name). A family is a node without parent.
 */
export interface Opening {
  id: string;
  eco: string;
  /** Full name, e.g. "Sicilian Defense: Najdorf Variation, English Attack". */
  name: string;
  parentId: string | null;
  /** Moves from the initial position in UCI notation. */
  moves: readonly string[];
}

export interface OpeningMatch {
  opening: Opening;
  /** Number of plies of the game covered by the opening line. */
  plies: number;
}
