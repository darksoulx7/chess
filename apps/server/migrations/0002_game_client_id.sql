-- Idempotent game saving: a client may retry POST /api/games with the same client_id.
alter table games add column client_id uuid;
create unique index games_owner_client_idx on games (owner_id, client_id) where client_id is not null;
