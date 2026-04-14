-- 0005: daily standings snapshots for overnight-delta indicators
--
-- Every morning the cron writes one row per team per league with the
-- current total_points and rank. The standings page compares the two
-- most recent snapshot dates to render:
--   - ▲ green up-arrow  (team moved up in rank overnight)
--   - ▼ red down-arrow  (team moved down in rank overnight)
--   - 🔥 fire          (team's overnight points delta is >= 1.3x the
--                        league-average overnight delta)

create table if not exists public.team_standings_snapshots (
  league_id     uuid not null references public.leagues(id) on delete cascade,
  team_id       uuid not null references public.teams(id)   on delete cascade,
  snapshot_date date not null,
  total_points  int  not null,
  rank          int  not null,
  created_at    timestamptz not null default now(),
  primary key (snapshot_date, team_id)
);

create index if not exists team_standings_snapshots_league_date_idx
  on public.team_standings_snapshots (league_id, snapshot_date desc);

alter table public.team_standings_snapshots enable row level security;

drop policy if exists "league members can read snapshots"
  on public.team_standings_snapshots;
create policy "league members can read snapshots"
  on public.team_standings_snapshots for select
  to authenticated
  using (
    public.is_league_member(league_id, auth.uid())
    or public.is_league_commissioner(league_id, auth.uid())
  );

-- Writes go through the service client in the nightly cron, so we
-- intentionally do NOT grant insert/update/delete to the
-- authenticated role here.
