# Build context is the repo root: docker build -f apps/server/Dockerfile .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/server/package.json apps/server/
COPY packages/config/package.json packages/config/
COPY packages/chess-core/package.json packages/chess-core/
COPY packages/game-types/package.json packages/game-types/
COPY packages/engine/package.json packages/engine/
COPY packages/openings/package.json packages/openings/
RUN pnpm install --frozen-lockfile --filter @chess/server...
COPY packages packages
COPY apps/server apps/server
RUN pnpm --filter @chess/server build

FROM base AS runtime
ENV NODE_ENV=production
# Stockfish runs as a separate native process (see docs/BOT.md for licensing notes).
RUN apt-get update && apt-get install -y --no-install-recommends stockfish \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo /repo
USER node
EXPOSE 4000
CMD ["node", "apps/server/dist/main.js"]
