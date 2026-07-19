-- Trivia set sharing (content layer). Sets stay 'private' by default; sharing
-- grants READ access to specific friends via trivia_set_shares — visibility is
-- never changed by sharing. Composition copies questions (source_set_id keeps
-- lightweight provenance; no behavior depends on it).

-- ========================== trivia_set_shares =============================

create table public.trivia_set_shares (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.trivia_sets (id) on delete cascade,
  shared_with uuid not null references public.profiles (id) on delete cascade,
  shared_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (set_id, shared_with)
);

create index trivia_set_shares_with_idx on public.trivia_set_shares (shared_with);

alter table public.trivia_set_shares enable row level security;

-- Visible to both ends of the share. (No table subqueries here — this policy
-- is the recursion-free base the trivia_sets policy below builds on.)
create policy "trivia_set_shares_select_involved"
  on public.trivia_set_shares for select
  using (shared_by = auth.uid() or shared_with = auth.uid());

-- Only a set's OWNER may share it, always as themselves, never to themselves.
create policy "trivia_set_shares_insert_owner"
  on public.trivia_set_shares for insert
  with check (
    shared_by = auth.uid()
    and shared_with <> auth.uid()
    and exists (
      select 1 from public.trivia_sets s
      where s.id = set_id and s.owner_id = auth.uid()
    )
  );

-- The owner revokes; the recipient may also remove a share from their own list.
create policy "trivia_set_shares_delete"
  on public.trivia_set_shares for delete
  using (
    shared_with = auth.uid()
    or exists (
      select 1 from public.trivia_sets s
      where s.id = set_id and s.owner_id = auth.uid()
    )
  );

-- ===================== provenance for copied questions ====================

alter table public.questions
  add column source_set_id uuid
    references public.trivia_sets (id) on delete set null;

-- Defense-in-depth for the editor's validation (NOT VALID: enforced for new
-- writes only, so any pre-existing rows can't block the migration).
alter table public.questions
  add constraint questions_options_shape check (
    jsonb_typeof(options) = 'array'
    and jsonb_array_length(options) between 2 and 4
    and correct_index >= 0
    and correct_index < jsonb_array_length(options)
    and char_length(question_text) between 1 and 300
  ) not valid;

-- ================== read access now includes shared users =================

drop policy "trivia_sets_select" on public.trivia_sets;
create policy "trivia_sets_select"
  on public.trivia_sets for select
  using (
    owner_id = auth.uid()
    or (
      is_removed = false
      and (
        visibility <> 'private'
        or exists (
          select 1 from public.trivia_set_shares sh
          where sh.set_id = id and sh.shared_with = auth.uid()
        )
      )
    )
  );

drop policy "questions_select_via_set" on public.questions;
create policy "questions_select_via_set"
  on public.questions for select
  using (
    exists (
      select 1 from public.trivia_sets s
      where s.id = set_id
        and (
          s.owner_id = auth.uid()
          or (
            s.is_removed = false
            and (
              s.visibility <> 'private'
              or exists (
                select 1 from public.trivia_set_shares sh
                where sh.set_id = s.id and sh.shared_with = auth.uid()
              )
            )
          )
        )
    )
  );
