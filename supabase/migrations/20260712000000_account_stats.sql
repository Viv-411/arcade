-- 1) Backfill profiles for users created BEFORE the signup trigger existed
--    (same username derivation as handle_new_user).
do $$
declare
  r record;
  base text;
  candidate text;
begin
  for r in
    select u.id, u.email, u.raw_user_meta_data
    from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
  loop
    base := coalesce(
      nullif(r.raw_user_meta_data ->> 'username', ''),
      split_part(coalesce(r.email, ''), '@', 1),
      'player'
    );
    base := lower(regexp_replace(base, '[^a-z0-9_]+', '', 'g'));
    if base is null or char_length(base) < 3 then
      base := 'player';
    end if;
    base := left(base, 20);
    candidate := base;
    while exists (select 1 from public.profiles where username = candidate) loop
      candidate := left(base, 14) || '_' || floor(random() * 10000)::int;
    end loop;
    insert into public.profiles (id, username, display_name)
    values (
      r.id,
      candidate,
      coalesce(
        nullif(r.raw_user_meta_data ->> 'display_name', ''),
        nullif(r.raw_user_meta_data ->> 'full_name', ''),
        candidate
      )
    );
  end loop;
end $$;

-- 2) Per-account game statistics, written ONLY by the game server (service
--    role) when a game finishes with signed-in players. Durable in Postgres —
--    unlike the local SQLite file, these survive redeploys.
create table public.player_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  games_played int not null default 0,
  wins int not null default 0,
  -- { "mindmeld": {"played": 3, "wins": 1}, "trivia": {...}, ... }
  per_game jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.player_stats enable row level security;

-- Owner can read their own stats; nobody can write via the API keys — the
-- server records results through the function below with the service role.
create policy "player_stats_select_own"
  on public.player_stats for select
  using (auth.uid() = user_id);

create or replace function public.record_game_result(
  p_user_id uuid,
  p_game text,
  p_won boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.player_stats (user_id, games_played, wins, per_game)
  values (
    p_user_id,
    1,
    case when p_won then 1 else 0 end,
    jsonb_build_object(
      p_game,
      jsonb_build_object('played', 1, 'wins', case when p_won then 1 else 0 end)
    )
  )
  on conflict (user_id) do update set
    games_played = player_stats.games_played + 1,
    wins = player_stats.wins + case when p_won then 1 else 0 end,
    per_game = jsonb_set(
      player_stats.per_game,
      array[p_game],
      jsonb_build_object(
        'played',
        coalesce((player_stats.per_game -> p_game ->> 'played')::int, 0) + 1,
        'wins',
        coalesce((player_stats.per_game -> p_game ->> 'wins')::int, 0)
          + case when p_won then 1 else 0 end
      )
    ),
    updated_at = now();
end;
$$;

-- Service role only: clients must not be able to inflate their own stats.
revoke execute on function public.record_game_result(uuid, text, boolean)
  from public, anon, authenticated;
