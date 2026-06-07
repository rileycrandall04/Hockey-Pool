-- Phase 5: admins + manual goal entry support.
--
-- 1. app_admins — users (besides the APP_OWNER_EMAIL) allowed to enter goals
--    and run global data tools. The app owner manages this list.
-- 2. match_goals.manual — distinguishes hand-entered goals from API-synced
--    ones, so the nightly events sync only replaces its own (non-manual) rows.
--
-- Re-runnable.

create table if not exists public.app_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.match_goals
  add column if not exists manual boolean not null default false;

-- Marks a final match whose goal events have already been pulled, so the
-- nightly events sync doesn't re-fetch 0-0 games forever. Cleared if you
-- want to force a re-pull.
alter table public.matches
  add column if not exists goals_synced boolean not null default false;

create index if not exists match_goals_country_idx on public.match_goals (country_id);

-- RLS: admin list is readable by any signed-in user (so the UI can show who
-- has access); writes go through service-role server actions.
alter table public.app_admins enable row level security;

drop policy if exists "app admins are readable" on public.app_admins;
create policy "app admins are readable" on public.app_admins
  for select to authenticated using (true);
