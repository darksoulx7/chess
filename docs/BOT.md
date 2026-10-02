# Bot

## Overview

`@chess/engine` defines the engine abstraction and the bot logic; the server runs Stockfish as a **separate native process** (UCI) behind it; the client only talks HTTP.

```
Client (BOT game) --POST /api/bot/move--> Fastify --> EnginePool --> StockfishProcess --UCI--> stockfish binary
                                              \--> chooseBotMove(BotProfile, MultiPV lines, seeded RNG)
```

- `EngineService.analyze({fen, limits, multiPv, signal})` → lines (score, PV) + best move. Helpers: `getBestMove`, `getEvaluation`, `getPrincipalVariation`.
- Implementations: `StockfishProcess` (server, native). A client WASM engine and a mobile engine can implement the same interface later (see licensing).
- The UI never imports an engine; ESLint blocks `stockfish*` imports outside the server.

## Strength profiles

`BotProfile` (see `packages/engine/src/bot-profile.ts`): `targetRating`, `searchDepth`, `nodes?`, `moveTimeMs?`, `candidateMoveCount`, `randomness`, `mistakeRate`, `blunderRate`, `goodWindowCp`, `maxMistakeLossCp`, `maxBlunderLossCp`.
Supported labels: 100, 200 … 2500 (25 levels). **These are tuning labels, not Elo.** The table `PROFILE_ANCHORS` (7 anchors, linearly interpolated) is data meant to be tuned.

How a move is chosen (`chooseBotMove`):

1. Optional opening-book move (legal check) → play it.
2. Only one legal move → play it, no engine call.
3. Engine returns up to `candidateMoveCount` lines at the profile's depth/nodes/time limits.
4. Candidates are classified by centipawn loss vs. the best: _good_ (≤ `goodWindowCp`), _mistake_, _blunder_ (bounded by the profile's caps).
5. With probability `blunderRate` / `mistakeRate` a candidate from that band is chosen; otherwise a good move, weighted `exp(-rank / randomness)`.
6. Never chosen on purpose: a move that allows a forced mate against the bot (unless every move does). A forced mate for the bot is always played at ≥1000.
7. Everything returned is verified legal against `chess-core`; illegal engine output falls back safely.

Deterministic: same position + `seed` + engine output ⇒ same move (fixed-depth Stockfish is deterministic; tests use fake engines for exact reproducibility).

Self-play sanity check (`pnpm --filter @chess/server selfplay 1600 400`), 8 games each, capped plies, material adjudication: 1600 beat 400 8–0; 1200 beat 800 7–1; 2200 beat 1600 7–0 (1 draw). This shows **ordering only** — it is not an Elo calibration.

## API

`POST /api/bot/move` `{ fen, targetRating (100..2500 int), seed? }` → `{ move (UCI), san, quality, thinkMs }`.
Errors: 400 invalid request/FEN/finished game · 429 rate limit (60/min/IP default) · 503 `engine_busy` (+`Retry-After`) or `engine_unavailable` · 504 `engine_timeout`.
The search is cancelled when the client disconnects (watch the _response_ `close`; `req.raw` `close` fires after the body is read since Node 16).

## Operational behaviour

- `StockfishProcess`: lazy start, serialized searches, `stop` on abort, hard timeout (`movetime`/`maxSearchMs` + grace) then kill + automatic restart, crash detection, input FEN sanitised before reaching stdin.
- `EnginePool`: N processes (`ENGINE_POOL_SIZE`, default 2), bounded queue (`ENGINE_MAX_QUEUE`, default 20) → `busy` instead of unbounded latency; aborted waiters are removed.
- Env: `STOCKFISH_PATH` (default `stockfish`; Debian/Ubuntu apt installs to `/usr/games/stockfish`).
- Client: `useBotDriver` requests a move when it is the bot's turn, ignores stale replies (`applyBotMove` checks the FEN), cancels on new game/undo/unmount, shows a Retry button on failure.

## Known limits

- Bots never offer/accept draws; Draw is hidden in bot games.
- No opening repertoire yet (Phase 5 plugs into `BookProvider`).
- Single-process-per-engine, CPU bound: capacity ≈ pool size × searches per second; scale pool/instances for load.

## Stockfish licensing (release gate)

- Stockfish is GPL-3.0. npm `stockfish` 19.0.0 is GPL-3.0; `stockfish-web` 0.1.0 is AGPL-3.0-or-later (verified from the npm registry, 2026-10-02).
- Current integration: the unmodified distro binary (apt: Stockfish 16 on Ubuntu 24.04; Debian bookworm image used by the Dockerfile ships an older 15.x) launched as a separate process. No Stockfish code is vendored in this repository.
- **No legal conclusion is made here.** Before any public/commercial distribution, have the exact deployment reviewed (server-side process use, any future client-side WASM/native redistribution, source-offer obligations, and the AGPL network clause if `stockfish-web` is ever adopted).
