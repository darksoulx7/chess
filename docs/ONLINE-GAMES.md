# Online games (Phase 8)

Server-authoritative 1v1 games over REST + WebSocket. The server decides turn, legality, clocks and result; the client only renders and proposes moves.

## Flow

1. Signed-in user `POST /api/online/games` (colour, clock, public flag) → game in `WAITING`, creator gets an invite `code`.
2. Opponent joins with the code (`POST /api/online/games/join`) or from the public lobby (`POST /api/online/games/:id/join`). The row is locked while joining, so only one joiner wins (by id: `409 not_open`; by code: `404`).
3. Both clients open `/ws`, send `auth`, then `sub` for the game and receive a full `state` snapshot. From then on they get `move`, `draw`, `ended` and `presence` events.

REST: `GET /api/online/lobby`, `GET /api/online/active`, `GET /api/online/games/:id`, `DELETE /api/online/games/:id` (cancel a waiting game).

## WebSocket protocol (`packages/game-types/src/online.ts`)

Client → server (zod validated, ≤ 4096 bytes): `auth`, `sub`, `unsub`, `move {uci, ply, cid?}`, `resign`, `draw {offer|accept|decline}`, `abort`, `ping`.
Server → client: `auth_ok`, `state`, `move`, `draw`, `ended`, `presence`, `ack`, `error {code}`, `pong`.

Hardening: first message must be `auth` (5 s timeout, close 4008), token expiry is checked on every command (`auth_expired`, client refreshes and re-auths on the same socket), token-bucket rate limit per connection (`rate_limited`), 16 KiB frame limit, close codes 4001 (unauthenticated), 4008 (timeout), 1009 (too big). Players may only subscribe to games they play.

## Correctness rules

- `move.ply` is the number of moves the client has seen. A move for an old ply is `stale`; the exact same move already applied is acknowledged with `duplicate: true` and **not** applied again, so retries and resends after a reconnect are safe.
- Persistence uses optimistic concurrency on `games.version`; a conflicting writer retries (4×) against fresh state.
- Clocks use the shared pure `createClock` (increment, first-move window of 60 s before the clock starts). Clients display `server clock + (serverTime − local receive time)`.
- Timeouts: a sweeper (`ONLINE_SWEEP_MS`, default 1 s) finds games whose `turn_deadline` passed and ends them; moves also check the flag. Untimed games expire after 3 days idle; unjoined games are purged.
- Abort only before both sides have moved. Draw: offer → accept/decline; a counter-offer while one is pending is an agreement.
- Finished games are stored in the same tables as saved games and appear in both players' history (`status = 'FINISHED'` and the user is in `game_players`).

## Scaling

No per-game in-memory state. Events go through Redis channels `online:game:{id}`; presence is a TTL key (40 s) refreshed by heartbeats. Two server instances are covered by a test that plays across both.

## Client (`apps/client/src/features/online`)

- `online-model.ts`: pure reducer folding server messages into state (optimistic move, rollback, resync, draw/presence/end).
- `online-socket.ts`: auth-first connection with backoff + jitter, ping/pong dead-connection detection, reconnect on foreground/`online`, token refresh.
- `online-store.ts`: zustand store; resends an unconfirmed move after a reconnect.
- Screens: `app/play/online` (create, join by code, lobby, resume), `app/play/online-game` (board, server clocks, resign/abort/draw), `app/join/[code]` (invite deep link).

## Verification

- `online-domain.test.ts` (rules), `online.test.ts` (REST/persistence/sweeper), `online-ws.test.ts` (real sockets incl. reconnect, hardening and a second instance).
- Client unit tests for the model and socket; `e2e/online.e2e.ts` drives two browser contexts against the built server (real-time play, lobby, draw, resign, history, abort, dropped connection with resync and resend, reload resume, clocks).

## Known limits

- No rematch, spectators, chat, matchmaking queue or ratings.
- Render's free tier sleeps; online play needs an always-on instance.
- Cannot be exercised on iOS/Android here; the logic is platform-neutral and the web build is what is verified.
