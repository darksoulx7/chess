# Architecture

Modular monolith + one universal client. See `docs/IMPLEMENTATION-PLAN.md` §3 for the package map.

- `apps/client`: Expo Router app (web SPA export on Vercel; Android/iOS via Expo).
- `apps/server`: Fastify. `src/modules/*` per domain, `src/infrastructure` (Postgres, Redis), `src/shared` (env, errors).
  `GET /health` = liveness (Render health check); `GET /health/ready` = Postgres + Redis readiness (503 when degraded).
- `packages/chess-core`, `game-types`, `engine`: framework-free TypeScript shared by client and server.

Boundaries enforced by ESLint (`no-restricted-imports`): only `chess-core` imports `chess.js`; nothing imports Stockfish directly.
