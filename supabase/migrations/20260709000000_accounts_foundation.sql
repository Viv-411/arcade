-- Accounts foundation: profiles + trivia set schema with RLS.
-- Trivia-set posting UI ships in a later phase; the schema is defined now so
-- it stays stable.

-- ============================== profiles ==================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (char_length(username) between 3 and 24 and username ~ '^[a-z0-9_]+$'),
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Readable by anyone (including the anon key) — usernames are public identity.
create policy "profiles_select_all"
  on public.profiles for select
  using (true);

-- Writable only by the owner. No client insert/delete: rows are created by the
-- signup trigger below and removed via the auth.users cascade.
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row on signup (trigger on auth.users; the alternative
-- — a server call on first login — was rejected so profiles exist even before
-- the app server ever sees the user). Username comes from the signup form's
-- metadata, falling back to the email local part, de-duplicated with a suffix.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
begin
  base := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(coalesce(new.email, ''), '@', 1),
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
    new.id,
    candidate,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      candidate
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================= trivia_sets ================================

create type public.set_visibility as enum ('private', 'unlisted', 'public');

create table public.trivia_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text,
  category text,
  visibility public.set_visibility not null default 'private',
  is_removed boolean not null default false, -- future moderation flag
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trivia_sets_owner_idx on public.trivia_sets (owner_id);
create index trivia_sets_public_idx
  on public.trivia_sets (visibility) where is_removed = false;

alter table public.trivia_sets enable row level security;

-- Owner always sees their own sets; others see them only when the set is not
-- private AND not removed by moderation.
create policy "trivia_sets_select"
  on public.trivia_sets for select
  using (
    owner_id = auth.uid()
    or (visibility <> 'private' and is_removed = false)
  );

create policy "trivia_sets_insert_own"
  on public.trivia_sets for insert
  with check (owner_id = auth.uid());

create policy "trivia_sets_update_own"
  on public.trivia_sets for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "trivia_sets_delete_own"
  on public.trivia_sets for delete
  using (owner_id = auth.uid());

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trivia_sets_updated_at
  before update on public.trivia_sets
  for each row execute function public.set_updated_at();

-- ============================== questions =================================

-- NOTE: options and correct_index are intentionally readable by anyone who can
-- read the parent set — future solo play scores CLIENT-side. Fine for
-- practice; never feed solo results into a competitive leaderboard without
-- server-side checking.
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.trivia_sets (id) on delete cascade,
  position int not null default 0,
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  correct_index int not null default 0,
  created_at timestamptz not null default now()
);

create index questions_set_idx on public.questions (set_id, position);

alter table public.questions enable row level security;

-- Questions inherit their set's access rules.
create policy "questions_select_via_set"
  on public.questions for select
  using (
    exists (
      select 1 from public.trivia_sets s
      where s.id = set_id
        and (
          s.owner_id = auth.uid()
          or (s.visibility <> 'private' and s.is_removed = false)
        )
    )
  );

create policy "questions_insert_own_set"
  on public.questions for insert
  with check (
    exists (
      select 1 from public.trivia_sets s
      where s.id = set_id and s.owner_id = auth.uid()
    )
  );

create policy "questions_update_own_set"
  on public.questions for update
  using (
    exists (
      select 1 from public.trivia_sets s
      where s.id = set_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.trivia_sets s
      where s.id = set_id and s.owner_id = auth.uid()
    )
  );

create policy "questions_delete_own_set"
  on public.questions for delete
  using (
    exists (
      select 1 from public.trivia_sets s
      where s.id = set_id and s.owner_id = auth.uid()
    )
  );
