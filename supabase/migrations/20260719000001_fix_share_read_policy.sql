-- Fix 20260719000000: in the trivia_sets select policy the subquery's
-- unqualified `id` resolved to trivia_set_shares.id (the inner relation),
-- so `sh.set_id = id` compared a share row to itself and shared reads never
-- matched. Qualify the outer column explicitly.

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
          where sh.set_id = trivia_sets.id and sh.shared_with = auth.uid()
        )
      )
    )
  );
