import raw from '../data/openings.json';
import type { Opening } from './types';

type RawNode = [string, string, string, string | null, string];
interface RawFile {
  source: { name: string; url: string; license: string; fetched: string };
  nodes: RawNode[];
}

export const OPENING_SOURCE = (raw as RawFile).source;

export function parseOpenings(nodes: readonly RawNode[]): Opening[] {
  return nodes.map(([id, eco, name, parentId, moves]) => ({
    id,
    eco,
    name,
    parentId,
    moves: moves === '' ? [] : moves.split(' '),
  }));
}

export const OPENINGS: readonly Opening[] = parseOpenings((raw as RawFile).nodes);
