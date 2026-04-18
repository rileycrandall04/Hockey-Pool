-- 0011: stat conflict detection
--
-- When the cron ingests NHL game stats but a user has already entered
-- manual stats for that player+game, the cron skips the delta to avoid
-- double-counting.  If the values differ, a row is inserted here so the
-- app owner can review and resolve the discrepancy.

create table if not exists public.stat_conflicts (
  id              uuid primary key default gen_random_uuid(),
  game_id         bigint not null,
  player_id       bigint not null references public.players(id) on delete cascade,
  -- What the user entered (already applied to player_stats)
  manual_goals    int not null,
  manual_assists  int not null,
  manual_ot_goals int not null,
  -- What the NHL API returned
  cron_goals      int not null,
  cron_assists    int not null,
  cron_ot_goals   int not null,
  -- Resolution
  resolved        boolean not null default false,
  resolution      text,          -- 'accepted_cron' | 'kept_manual'
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique(game_id, player_id)
);

alter table public.stat_conflicts enable row level security;

create policy "app owner can read stat conflicts"
  on public.stat_conflicts for select
  to authenticated using (true);
