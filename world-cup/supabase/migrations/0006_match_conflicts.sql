-- Sync vs manual reconciliation.
--
-- When a match is locked (hand-edited) and the API later reports a DIFFERENT
-- result, we don't overwrite the manual value — instead we record the
-- disagreement here so a commissioner can see it and decide which source is
-- right. One row per match; cleared automatically when the two agree again.
--
-- Re-runnable.

create table if not exists public.match_conflicts (
  match_id uuid primary key references public.matches(id) on delete cascade,
  manual_home_goals int,
  manual_away_goals int,
  manual_went_to_shootout boolean,
  manual_home_pens int,
  manual_away_pens int,
  api_home_goals int,
  api_away_goals int,
  api_went_to_shootout boolean,
  api_home_pens int,
  api_away_pens int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.match_conflicts enable row level security;

drop policy if exists "match conflicts are readable" on public.match_conflicts;
create policy "match conflicts are readable" on public.match_conflicts
  for select to authenticated using (true);
