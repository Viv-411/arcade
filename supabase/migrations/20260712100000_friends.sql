-- Friendships: one row per relationship. requester sends, addressee accepts.
-- Declined/cancelled/removed relationships are DELETED (no tombstones).
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

-- One relationship per pair regardless of direction.
create unique index friendships_pair_idx
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );
create index friendships_addressee_pending_idx
  on public.friendships (addressee_id) where status = 'pending';

alter table public.friendships enable row level security;

-- Only the two people involved can see the relationship.
create policy "friendships_select_own"
  on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- You can only send requests AS yourself, and only as 'pending'.
create policy "friendships_insert_request"
  on public.friendships for insert
  with check (auth.uid() = requester_id and status = 'pending');

-- Only the addressee can act on a pending request, and only to accept it.
create policy "friendships_update_accept"
  on public.friendships for update
  using (auth.uid() = addressee_id and status = 'pending')
  with check (auth.uid() = addressee_id and status = 'accepted');

-- Either side can delete: decline (addressee), cancel (requester), unfriend.
create policy "friendships_delete_own"
  on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create trigger friendships_updated_at
  before update on public.friendships
  for each row execute function public.set_updated_at();
