import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenings } from './build-lib';

const root = join(import.meta.dirname, '..', 'data');
const tsvs = ['a', 'b', 'c', 'd', 'e'].map((f) =>
  readFileSync(join(root, 'source', `${f}.tsv`), 'utf8'),
);
const file = buildOpenings(tsvs);
writeFileSync(join(root, 'openings.json'), `${JSON.stringify(file)}\n`);
console.log(`wrote ${file.nodes.length} opening nodes`);
