import type { Opening } from './types';

/** Indexed view over a list of openings: lookup, hierarchy, search. Build once, query many times. */
export class OpeningIndex {
  private readonly byId = new Map<string, Opening>();
  private readonly childrenOf = new Map<string, Opening[]>();
  readonly families: readonly Opening[];

  constructor(readonly all: readonly Opening[]) {
    for (const o of all) {
      if (this.byId.has(o.id)) throw new Error(`duplicate opening id: ${o.id}`);
      this.byId.set(o.id, o);
    }
    const roots: Opening[] = [];
    for (const o of all) {
      if (o.parentId === null) {
        roots.push(o);
        continue;
      }
      if (!this.byId.has(o.parentId)) throw new Error(`unknown parent ${o.parentId} for ${o.id}`);
      const list = this.childrenOf.get(o.parentId) ?? [];
      list.push(o);
      this.childrenOf.set(o.parentId, list);
    }
    const byName = (a: Opening, b: Opening) => a.name.localeCompare(b.name);
    this.families = roots.sort(byName);
    for (const list of this.childrenOf.values()) {
      list.sort((a, b) => a.moves.length - b.moves.length || byName(a, b));
    }
  }

  get(id: string): Opening | undefined {
    return this.byId.get(id);
  }

  children(id: string): readonly Opening[] {
    return this.childrenOf.get(id) ?? [];
  }

  /** The node and everything below it (depth-first). */
  subtree(id: string): Opening[] {
    const root = this.byId.get(id);
    if (!root) return [];
    const out: Opening[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop() as Opening;
      out.push(node);
      for (const c of this.children(node.id)) stack.push(c);
    }
    return out;
  }

  /** Root family of a node. */
  familyOf(id: string): Opening | undefined {
    let node = this.byId.get(id);
    while (node?.parentId) node = this.byId.get(node.parentId);
    return node;
  }

  /** Case/diacritic-insensitive substring search over names, best matches first. */
  search(query: string, limit = 30): Opening[] {
    const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const terms = norm(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const scored: Array<[number, Opening]> = [];
    for (const o of this.all) {
      const name = norm(o.name);
      if (!terms.every((t) => name.includes(t))) continue;
      const starts = name.startsWith(terms[0] as string) ? 0 : 1;
      scored.push([starts * 1000 + name.length + (o.parentId ? 50 : 0), o]);
    }
    return scored
      .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
      .slice(0, limit)
      .map(([, o]) => o);
  }
}
