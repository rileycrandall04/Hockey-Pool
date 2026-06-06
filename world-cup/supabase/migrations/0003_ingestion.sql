-- Phase 4 ingestion support.
--
-- 1. matches.locked — when a commissioner manually edits a result, lock it
--    so the API sync never overwrites their correction.
-- 2. top_scorers — a small cache of the live Golden Boot leaderboard,
--    refreshed from API-Football's /players/topscorers endpoint. Standings
--    award the +5 to the owner of the current leader's country.
--
-- Re-runnable.

alter table public.matches
  add column if not exists locked boolean not null default false;

create table if not exists public.top_scorers (
  player_external_id int primary key,   -- API-Football player id
  player_id int references public.players(id) on delete set null,
  player_name text not null,
  country_external_id int,              -- API-Football team id
  country_id int references public.countries(id) on delete set null,
  goals int not null default 0,
  assists int not null default 0,
  minutes int not null default 0,
  rank int,                             -- 1 = current leader
  updated_at timestamptz not null default now()
);

create index if not exists top_scorers_rank_idx on public.top_scorers (rank);

alter table public.top_scorers enable row level security;

drop policy if exists "top scorers are public" on public.top_scorers;
create policy "top scorers are public" on public.top_scorers
  for select to authenticated using (true);
