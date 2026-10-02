# Decisions

| Date       | Decision                                                     | Reason                                                                                                                                          |
| ---------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-02 | pnpm workspaces, isolated linker                             | Supported by Expo SDK 57; fall back to `nodeLinker: hoisted` only on a concrete failure.                                                        |
| 2026-10-02 | TypeScript pinned to ~5.9                                    | typescript-eslint 8.71 requires `<6.1.0`; npm `latest` is 7.x.                                                                                  |
| 2026-10-02 | Expo web `output: "single"` (SPA) + Vercel rewrite           | Static export without per-route SSG; simplest correct Vercel deployment.                                                                        |
| 2026-10-02 | `packages/ui` deferred                                       | No second consumer yet; tokens/components live in `apps/client` to avoid a speculative abstraction.                                             |
| 2026-10-02 | Shared packages consumed as TS source (`main: src/index.ts`) | Metro, Vitest and tsup handle TS directly; no build step per package. Server bundler must set `noExternal: [/^@chess\//]` once it imports them. |
| 2026-10-02 | `EXPO_PUBLIC_*` read via literal `process.env.X`             | Expo inlines only literal member access; a default-param `process.env` silently left the URL undefined (found by browser test).                 |
| 2026-10-02 | Stockfish as separate native process on the server           | Process boundary; client WASM deferred pending licensing review (stockfish GPL-3.0, stockfish-web AGPL-3.0-or-later).                           |
