# Chess

Cross-platform chess platform: one Expo (React Native) client for web, Android and iOS, and a Fastify backend.
See `docs/IMPLEMENTATION-PLAN.md` for the roadmap and `docs/ARCHITECTURE.md` for structure.

## Requirements

Node >= 22, pnpm 10, PostgreSQL 16, Redis 7.

## Local setup

```bash
pnpm install
docker compose up -d                      # Postgres + Redis (or run them natively)
cp .env.example apps/server/.env          # server env
cp apps/client/.env.example apps/client/.env
pnpm dev                                  # server on :4000, web client via Expo
```

## Commands

| Command                                                     | What it does                       |
| ----------------------------------------------------------- | ---------------------------------- |
| `pnpm dev`                                                  | server (watch) + Expo web          |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` | verification, all workspaces       |
| `pnpm --filter @chess/client android` / `ios`               | native dev build (needs SDK/Xcode) |

Server tests need Postgres and Redis reachable via `DATABASE_URL` / `REDIS_URL`
(defaults: `postgres://chess:chess@127.0.0.1:5432/chess`, `redis://127.0.0.1:6379`).

## Deployment

- **Backend → Render:** create a Blueprint from `render.yaml`. Set `CORS_ORIGINS` to the Vercel URL.
- **Frontend → Vercel:** import the repo (project root = repo root; `vercel.json` provides build settings).
  Set `EXPO_PUBLIC_API_URL` to the Render service URL for the Production/Preview environments (baked in at build time).
