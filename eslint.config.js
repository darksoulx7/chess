import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.expo/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Architecture boundary: only chess-core may touch chess.js; UI must never touch an engine binary.
    files: ['apps/**/*.{ts,tsx}', 'packages/!(chess-core)/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'chess.js',
              message: 'Use @chess/chess-core instead of importing chess.js directly.',
            },
          ],
          patterns: [
            {
              group: ['stockfish', 'stockfish/*', 'stockfish-web'],
              message: 'Use the EngineService from @chess/engine.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
