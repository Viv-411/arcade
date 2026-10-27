-- Hotlap (single-player time trial) records. Every row is a time the GAME
-- SERVER computed by re-simulating the player's uploaded inputs — clients
-- never write here. One best record per (player, track, track version,
-- simulation version); a physics or track change starts a fresh board.
--
-- ALL access goes through the game server (service role), so RLS is enabled
-- with NO policies: the anon/authenticated keys can neither read nor write
-- this table directly (leaderboards are served by /api/hotlap).

create table public.hotlap_records (
  -- Doubles as the public run id for fetching the replay (ghost); the server
  -- assigns a fresh id whenever a record is improved.
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  track_id text not null check (char_length(track_id) between 1 and 64),
  track_version int not null check (track_version >= 1),
  sim_version int not null check (sim_version >= 1),
  time_ms int not null check (time_ms > 0),
  -- encodeInputs() output (base64url run-length inputs), capped at 128 KB.
  replay text not null check (char_length(replay) between 1 and 131072),
  set_at timestamptz not null default now(),
  unique (user_id, track_id, track_version, sim_version)
);

-- Leaderboard order: time ascending, earlier record wins ties.
create index hotlap_records_board_idx
  on public.hotlap_records (track_id, track_version, sim_version, time_ms, set_at);

alter table public.hotlap_records enable row level security;
-- deliberately NO policies: server-only table.
