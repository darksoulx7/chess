-- Accounts, sessions, preferences, games, saved games, analysis results.
-- Indexes are deliberate; each one names the query it serves.

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  username      text not null,
  password_hash text not null,
  avatar        text not null default 'knight',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Case-insensitive uniqueness; serves login lookups and prevents "Bob" / "bob" duplicates.
create unique index users_email_lower_idx on users (lower(email));
create unique index users_username_lower_idx on users (lower(username));

-- One row per issued refresh token. Tokens are single-use; rotation keeps `family_id`, so a replayed
-- (already used) token revokes the whole family.
create table sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  family_id   uuid not null,
  token_hash  text not null,          -- sha256 of the refresh token; the token itself is never stored
  user_agent  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,            -- set when rotated
  revoked_at  timestamptz
);
create unique index sessions_token_hash_idx on sessions (token_hash);   -- refresh lookup
create index sessions_user_idx on sessions (user_id);                   -- revoke-all / listing
create index sessions_family_idx on sessions (family_id);               -- family revocation
create index sessions_expires_idx on sessions (expires_at);             -- expired-session cleanup

create table user_preferences (
  user_id    uuid primary key references users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,   -- validated board/settings object
  updated_at timestamptz not null default now()
);

create table games (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid references users(id) on delete set null,
  mode             text not null check (mode in ('BOT', 'LOCAL', 'ONLINE')),
  status           text not null default 'FINISHED' check (status in ('WAITING', 'ACTIVE', 'PAUSED', 'FINISHED')),
  initial_fen      text not null,
  current_fen      text not null,
  pgn              text not null,
  result           text not null check (result in ('1-0', '0-1', '1/2-1/2', '*')),
  termination      text,
  opening_id       text,
  opening_name     text,
  eco              text,
  time_base_ms     integer check (time_base_ms is null or time_base_ms > 0),
  time_increment_ms integer check (time_increment_ms is null or time_increment_ms >= 0),
  white_time_ms    integer,
  black_time_ms    integer,
  bot_rating       integer check (bot_rating is null or bot_rating between 100 and 2500),
  ply_count        integer not null default 0 check (ply_count >= 0),
  version          integer not null default 0,    -- sequence number (online games)
  source           text not null default 'client' check (source in ('client', 'server')),
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  ended_at         timestamptz
);
-- History list: a user's games newest first (keyset pagination on (ended_at, id)).
create index games_owner_ended_idx on games (owner_id, ended_at desc, id desc);

create table game_players (
  game_id      uuid not null references games(id) on delete cascade,
  color        char(1) not null check (color in ('w', 'b')),
  user_id      uuid references users(id) on delete set null,
  display_name text not null,
  is_bot       boolean not null default false,
  bot_rating   integer,
  primary key (game_id, color)
);
-- Profile stats: all games of a user.
create index game_players_user_idx on game_players (user_id);

create table game_moves (
  game_id   uuid not null references games(id) on delete cascade,
  ply       integer not null check (ply >= 1),
  uci       text not null,
  san       text not null,
  fen_after text not null,
  primary key (game_id, ply)
);

create table saved_games (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  game_id     uuid references games(id) on delete set null,
  name        text not null check (char_length(name) between 1 and 100),
  pgn         text not null,
  initial_fen text not null,
  ply_count   integer not null default 0,
  result      text not null default '*',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Saved-games list: a user's games, most recently touched first.
create index saved_games_user_updated_idx on saved_games (user_id, updated_at desc, id desc);

create table analysis_results (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  game_id       uuid references games(id) on delete cascade,
  saved_game_id uuid references saved_games(id) on delete cascade,
  kind          text not null default 'review',
  depth         integer not null,
  result        jsonb not null,
  created_at    timestamptz not null default now(),
  check (game_id is not null or saved_game_id is not null)
);
create index analysis_results_game_idx on analysis_results (game_id) where game_id is not null;
create index analysis_results_saved_idx on analysis_results (saved_game_id) where saved_game_id is not null;
create index analysis_results_user_idx on analysis_results (user_id);
