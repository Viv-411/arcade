-- Friend DMs + group chats. ALL access goes through the game server (service
-- role) which validates friendship/membership — so RLS is enabled with NO
-- policies: the anon/authenticated keys can neither read nor write these
-- tables directly.

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'group')),
  name text check (name is null or char_length(name) between 1 and 40),
  created_by uuid not null references public.profiles (id) on delete cascade,
  -- canonical "least:greatest" user-id pair; enforces one DM per friendship
  dm_key text unique,
  created_at timestamptz not null default now()
);

create table public.chat_members (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create index chat_members_user_idx on public.chat_members (user_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'invite')),
  body text not null check (char_length(body) between 1 and 500),
  -- game invites: { "game": "trivia", "code": "ABCD" }
  invite jsonb,
  created_at timestamptz not null default now()
);

create index chat_messages_chat_idx on public.chat_messages (chat_id, created_at);

alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
-- deliberately NO policies: server-only tables.
