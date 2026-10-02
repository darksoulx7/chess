-- Server-authoritative online games.
alter table games
  add column invite_code      text,
  add column is_public        boolean not null default false,
  add column clock            jsonb,                               -- authoritative ClockState (timestamps in server ms)
  add column draw_offer_by    char(1) check (draw_offer_by in ('w', 'b')),
  add column last_activity_at timestamptz,
  add column turn_deadline    timestamptz;                         -- when the sweeper should end the game if nothing happens

-- Invite codes are unique while present; join-by-code lookup.
create unique index games_invite_code_idx on games (invite_code) where invite_code is not null;
-- Sweeper: finds active games whose deadline passed (timeout / abandonment).
create index games_deadline_idx on games (turn_deadline) where status = 'ACTIVE' and turn_deadline is not null;
-- Lobby: newest open public games first.
create index games_lobby_idx on games (created_at desc) where status = 'WAITING' and is_public;
