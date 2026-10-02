# Accounts, sessions and saved data

## Endpoints (all JSON; bearer access token unless noted)

|                                                                                                               |                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/register` `{email, username, password}`                                                       | 201 `{user, accessToken, refreshToken, expiresIn}`; 400 validation; 409 `email_taken` / `username_taken`               |
| `POST /api/auth/login` `{identifier, password}`                                                               | identifier = email or username (case-insensitive); 401 `invalid_credentials`; 429 `too_many_attempts` (+`Retry-After`) |
| `POST /api/auth/refresh` `{refreshToken}`                                                                     | rotates; 401 `invalid_refresh_token`; 409 `refresh_conflict`                                                           |
| `POST /api/auth/logout` `{refreshToken}`                                                                      | always 204; revokes the session family                                                                                 |
| `GET /api/me`, `PATCH /api/me`, `DELETE /api/me`                                                              | profile (username, avatar); delete needs the password and removes owned games                                          |
| `GET/PUT /api/me/preferences`                                                                                 | board settings, validated by the shared `preferencesSchema`                                                            |
| `GET /api/me/stats`                                                                                           | games/wins/losses/draws/win rate (BOT and ONLINE games only), favourite openings, recent games                         |
| `POST/GET /api/games`, `GET/DELETE /api/games/:id`, `GET /api/games/:id/pgn`, `PUT/GET /api/games/:id/review` | history                                                                                                                |
| `POST/GET /api/saved-games`, `GET/PATCH/DELETE /api/saved-games/:id`, `GET …/pgn`                             | saved games (max 500 per user)                                                                                         |

## Passwords

argon2id, m = 19 MiB, t = 2, p = 1 (OWASP baseline), per-hash salt. Length 10–128, a small deny-list of very common passwords, no composition rules.
Login always runs one verification (against a dummy hash for unknown accounts) so timing does not reveal which accounts exist.
Responses are identical for "wrong password" and "no such account".

## Tokens

- **Access token**: JWT HS256 (`jose`), 15 min by default, claims `sub`, `fid`, `iss`, `aud`, `exp`; only HS256 is accepted (no `none`, no algorithm confusion). Stateless, so a stolen access token works until it expires.
- **Refresh token**: 256-bit random, single use, 30 days. Only its SHA-256 is stored (`sessions.token_hash`). Each use issues a successor in the same _family_.
- **Reuse detection**: presenting an already-used token after a 30 s grace window revokes the whole family (the thief and the victim are both signed out). Inside the grace window it is a _concurrent refresh_ (two tabs): rejected with 409 and nothing revoked; the client re-reads its stored token and retries.
- Logout revokes the family. Expired sessions can be purged with `deleteExpiredSessions` (index `sessions_expires_idx`).

## Brute-force and abuse controls

Per-IP rate limits on auth routes (`AUTH_RATE_LIMIT_MAX`, default 30/min); per-account failed-login counter in Redis (`LOGIN_MAX_FAILURES` = 5 per 15 min, case-insensitive identifier) that fails open if Redis is down;
`@fastify/helmet` headers; request log redaction of `authorization`, `cookie`, `password`, `refreshToken`, `identifier`. All SQL is parameterised.

## CORS

Explicit allow-list (`CORS_ORIGINS`), methods `GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS`, headers `authorization, content-type, x-request-id`. (The library default only allows `GET/HEAD/POST`, which silently blocks every `PUT/PATCH/DELETE` from a browser; there is a preflight test per method.)

## Client

Access token in memory only. Refresh token: OS keychain via `expo-secure-store` on Android/iOS; **`localStorage` on web**, which any script on the page can read. It is single-use and rotated with reuse detection, but XSS hardening (no `dangerouslySetInnerHTML`, strict CSP at the web host) matters. Hosting the API under the web app's own domain would allow an `HttpOnly` cookie instead; that is a possible follow-up.
`api()` refreshes once on 401 (single-flight, so a single-use token is never replayed by parallel requests). Preferences: server wins on the first sync after sign-in, otherwise this device seeds the server; later changes upload debounced (1 s).
Finished BOT/LOCAL games are saved automatically for signed-in users; the save is idempotent (`clientId`).

## Data model (migrations `0001`, `0002`)

`users`, `sessions`, `user_preferences`, `games`, `game_players`, `game_moves`, `saved_games`, `analysis_results`. Case-insensitive unique indexes on email and username; every index is annotated with the query it serves in `0001_init.sql`.
Opening/bot data lives in code (`@chess/openings`, `@chess/engine`), so there are no `openings` / `opening_variations` / `bot_profiles` tables; games store `opening_id` / `opening_name` / `eco` instead.
Client-submitted games (BOT/LOCAL) are **not authoritative**: the server replays the PGN and only accepts results the board (or a plausible resignation/timeout/agreement) can explain. ONLINE games will be created by the server (Phase 8).
Migrations run on boot (advisory-locked, transactional); disable with `MIGRATE_ON_START=false`.

## Not built (follow-ups)

Email verification and password reset (they need an email provider), Google/Apple sign-in, session list / "sign out everywhere" UI, 2FA, account lockout notifications.
