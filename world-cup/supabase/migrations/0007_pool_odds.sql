-- Preseason win odds.
--
-- Stores each team's simulated probability of winning the pool (a JSON map of
-- team_id -> win %), computed on demand by the commissioner from the drafted
-- rosters + FIFA ranks. Refreshable.
--
-- Re-runnable.

alter table public.leagues
  add column if not exists odds jsonb,
  add column if not exists odds_computed_at timestamptz;
