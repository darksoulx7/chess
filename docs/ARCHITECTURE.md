# Architecture

Modular monolith + one universal client. See `docs/IMPLEMENTATION-PLAN.md` §3 for the package map.

- `apps/client`: Expo Router app (web SPA export on Vercel; Android/iOS via Expo).
- `apps/server`: Fastify. `src/modules/*` per domain, `src/infrastructure` (Postgres, Redis), `src/shared` (env, errors).
  `GET /health` = liveness (Render health check); `GET /health/ready` = Postgres + Redis readiness (503 when degraded).
- `packages/chess-core`, `game-types`, `engine`: framework-free TypeScript shared by client and server.

Boundaries enforced by ESLint (`no-restricted-imports`): only `chess-core` imports `chess.js`; nothing imports Stockfish directly.

## Board (apps/client/src/features/chess)

Own cross-platform board (no Chessground; GPL). Layers, back to front: `BoardBackground` (SVG squares + coordinates) → `BoardOverlay` (last move, selection, check glow, legal-move markers) → `PieceView`s (Reanimated-positioned views, SVG glyphs) → `PromotionPicker` (sibling of the gesture area).

Logic is split from rendering so it is unit-testable:

- `geometry.ts` pixel/square math for both orientations.
- `tracked-pieces.ts` replays history to give each piece a stable id, so moves animate (captures, en passant, castling, promotion handled; undo is free).
- `interaction.ts` pure state machine for tap / press / drop / promotion / move-confirmation.
- `board-controller.ts` maps raw pointer events to interaction transitions; `ChessBoard.tsx` only wires gestures, state and layers.
- `themes.ts` board and piece themes as data; `settings/settings-store.ts` holds user settings.

Drag-and-drop moves skip the slide animation (the piece is already where it was dropped). Piece artwork is original to this project.

Tests: `pnpm --filter @chess/client test` (unit) and `pnpm --filter @chess/client e2e` (Playwright against the web export: click-to-move, drag, illegal drop, promotion, flip, undo, checkmate lock).

## UI system (Phase 3)

- Tokens in `src/theme/tokens.ts` (colors, spacing, radius, typography, motion, elevation); shared components in `src/components` (Button, Segmented, ToggleRow, Sheet, Screen). Accessibility state uses `aria-*` props (React Native Web ignores `accessibilityState`).
- Clock logic is pure and shared: `@chess/game-types/clock` takes `now` explicitly, so the server can reuse it as the authority for online games. Local games use it for display and timeout; undo is disabled when a clock is on.
- Settings persist via zustand `persist` + AsyncStorage (`chess.settings.v1`); stored data is sanitised on load.
- Sounds are synthesized by `scripts/generate-sounds.mjs` (original, license-free) and played through `expo-audio`; failures are logged once and never affect play.
- Web keyboard play: arrow keys move a cursor (shown only on `:focus-visible`), Enter/Space select or move, Escape cancels.
- Reduced motion (`AccessibilityInfo`) forces instant moves.
