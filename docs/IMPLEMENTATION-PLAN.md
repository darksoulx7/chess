# Implementation Plan

Status date: 2026-10-02. Repository was empty at start (no commits, no files).

## 1. Environment findings (verified)

| Item              | Finding                                             |
| ----------------- | --------------------------------------------------- |
| Node / npm / pnpm | 22.22.0 / 10.9.4 / 10.28.0                          |
| Docker            | CLI 29.6.2 installed, **no daemon** in this sandbox |
| PostgreSQL        | 16.14 installed, cluster `16/main` stopped          |
| Redis             | 7.0.15 installed, stopped                           |
| apt `stockfish`   | 16 available (native binary)                        |

Consequence: local dev uses `docker compose` where a daemon exists; in this sandbox Postgres/Redis are started natively. Both paths are documented in the root README.

## 2. Verified dependency versions (npm registry, 2026-10-02)

| Package                                         | Version                                      | License               |
| ----------------------------------------------- | -------------------------------------------- | --------------------- |
| expo / expo-router                              | 57.0.26 / 57.0.24                            | MIT                   |
| react-native                                    | 0.87.1 (final pin comes from `expo install`) | MIT                   |
| react-native-reanimated / gesture-handler / svg | 4.5.1 / 2.32 / 15.15.4 (SDK-aligned)         | MIT                   |
| chess.js                                        | 1.4.0                                        | BSD-2-Clause          |
| fastify / @fastify/websocket                    | 5.12.5 / 11.3.1                              | MIT                   |
| pg / ioredis / argon2                           | 8.23.1 / 6.0.0 / 0.45.1                      | MIT                   |
| zustand / @tanstack/react-query                 | 5.0.15 / 5.104.1                             | MIT                   |
| vitest                                          | 5.0.3                                        | MIT                   |
| **typescript**                                  | **pinned 5.9.x**, not `latest` (7.x)         | Apache-2.0            |
| stockfish (npm, nmrugg)                         | 19.0.0, ~200 MB unpacked, multiple builds    | **GPL-3.0**           |
| stockfish-web                                   | 0.1.0                                        | **AGPL-3.0-or-later** |

Pin rationale: `typescript-eslint` 8.71 declares `typescript >=4.8.4 <6.1.0`; TS 7 would break linting. Revisit when typescript-eslint supports it.

Expo SDK 57 supports pnpm isolated installs (docs: isolated deps supported from SDK 54; Metro monorepo config is automatic since SDK 52). We start with isolated and fall back to `nodeLinker: hoisted` only if a concrete failure appears.

## 3. Architecture

Modular monolith, one Expo client, shared pure-TS packages.

```
apps/client   Expo + Expo Router (web, Android, iOS)
apps/server   Fastify + WebSocket + Postgres + Redis
packages/chess-core   chess.js wrapper (ChessGame). No UI, no IO.
packages/game-types   GameState, BotProfile, Opening, API/WS contracts (zod)
packages/engine       EngineService interface + UCI parsing + bot move selection
packages/config       shared tsconfig / eslint base
data/openings         opening data (JSON), loaded by server + client
docs/
```

`packages/ui` from the brief is **deferred**: design tokens and components live in `apps/client/src/theme` and `src/components` until a second consumer exists (recorded in DECISIONS.md).

Boundaries:

- UI → `chess-core` / `game-types` only; never `chess.js` directly (ESLint `no-restricted-imports`).
- UI → `EngineService` interface only; never Stockfish.
- Server owns truth for online games (turn, clock, legality, result).

## 4. Stockfish strategy and licensing

- **Server (bot + review):** Stockfish as a **separate native process** over UCI (`StockfishProcessEngine`). Dev: apt `stockfish`; production: installed in the Render Docker image. Process boundary keeps the integration simple to reason about.
- **Client (analysis, offline bot):** `StockfishWebEngine` in a Web Worker, behind the same `EngineService`. Binary is lazy-loaded, **not** committed in the initial phases. It is only added after a licensing decision.
- `stockfish-web` is AGPL-3.0-or-later and `stockfish` is GPL-3.0. **No legal conclusion is made here.** Release gate: counsel/maintainer reviews the exact integration (client-side redistribution vs. server-side process) before any public distribution. Tracked as a release requirement in `docs/BOT.md`.
- Bot strength labels (100–2500) are target profiles, not Elo claims.

## 5. Deployment

- **Frontend → Vercel:** `expo export --platform web` (static output in `apps/client/dist`), `vercel.json` with SPA rewrite and build/output settings. Public API URL via `EXPO_PUBLIC_API_URL` (no hardcoded URLs).
- **Backend → Render:** `render.yaml` Blueprint: Docker web service (Node + Stockfish binary), managed Postgres, Render Key Value (Redis). Env vars set in the blueprint; secrets generated by Render (`generateValue`) or marked `sync: false`.
- WebSockets work on Render web services. Render free tier sleeps; online games need a paid instance (noted, not blocking).
- CORS allow-list from env (`CORS_ORIGINS`).

## 6. Phases and definition of done

Each phase ends with `pnpm typecheck`, `pnpm lint`, `pnpm test` (and `pnpm build` where applicable) actually passing, then docs updated.

| Phase        | Scope                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Foundation | monorepo, Expo web boots, Fastify boots, Postgres + Redis connect (`/health`), lint/typecheck/test wired, docker-compose, render.yaml, vercel.json |
| 1 Chess core | `ChessGame`, full rule tests                                                                                                                       |
| 2 Board      | custom SVG board, click + drag, legal dots, promotion, last move, check, animation; play vs self                                                   |
| 3 Premium UI | design tokens, home/setup/game screens, themes, settings, sounds, responsive layouts                                                               |
| 4 Bot        | EngineService, UCI process engine, BotProfile selection, bot game                                                                                  |
| 5 Openings   | data model + data + repertoire bot                                                                                                                 |
| 6 Analysis   | eval bar, lines, review, classification thresholds                                                                                                 |
| 7 Auth       | argon2id, access+rotating refresh, profile, history, saved games                                                                                   |
| 8 Online     | authoritative WS games, clocks, reconnect, idempotent moves                                                                                        |
| 9 Mobile     | Android/iOS polish                                                                                                                                 |

**First milestone:** Phase 0 complete and verified, then Phase 1 and 2 (playable local board). Bot demo follows.

## 7. Risks

| Risk                                                     | Mitigation                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GPL/AGPL Stockfish licensing                             | process boundary on server, no bundled binary in repo, explicit release gate                                                                        |
| Expo SDK 57 / RN 0.87 ecosystem lag, pnpm + Metro quirks | use `expo install` for alignment, fall back to hoisted linker with a recorded reason                                                                |
| Drag interactions diverging across web/native            | single gesture layer on Gesture Handler + Reanimated, tested on web first                                                                           |
| Weak bots look random                                    | candidate filtering by centipawn loss; seeded RNG for tests                                                                                         |
| Render free-tier cold starts hurting WS                  | documented; paid instance for online                                                                                                                |
| Sandbox has no Docker daemon, cannot run emulators       | verify web + backend + unit tests here; native builds verified only to the extent possible (`expo export` for android/ios bundles), stated honestly |

## 8. Testing strategy

- `vitest` for all TS packages and the server; `jest-expo` + React Native Testing Library for client components.
- chess-core: exhaustive rule fixtures (perft counts for known positions to verify move generation integration, plus targeted mate/stalemate/castling/ep/promotion/repetition/50-move/insufficient-material cases).
- Server: integration tests against real Postgres/Redis (service containers in CI, native here).
- CI: GitHub Actions running install, typecheck, lint, test, build.
