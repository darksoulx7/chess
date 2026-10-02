import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  outDir: 'dist',
  // Workspace packages ship TypeScript source, and chess.js is only a dependency of chess-core,
  // so both must be bundled for `node dist/main.js` to run on its own.
  noExternal: [/^@chess\//, 'chess.js'],
});
