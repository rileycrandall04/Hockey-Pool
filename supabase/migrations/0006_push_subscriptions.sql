-- 0006: web push subscriptions for "you're on the clock" draft alerts
--
-- Stores one row per (user, device) pair. Populated by the
-- /api/push/subscribe endpoint when a draft-room user taps "Enable
-- push notifications". Drained by /api/push/unsubscribe and by the
-- push sender helper when an endpoint returns 404/410 Gone (expired
-- subscription).
--
-- The endpoint column is UNIQUE because each browser instance maps
-- to exactly one push endpoint URL from the browser's push service;
-- re-subscribing on the same device simply overwrites the old row.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Users can read their own subscription rows (useful if we ever show
-- a "manage devices" list). They cannot read anyone else's.
drop policy if exists "users can read their push subscriptions"
  on public.push_subscriptions;
create policy "users can read their push subscriptions"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

-- Writes go through the subscribe/unsubscribe routes with the
-- service-role key, so we intentionally do NOT grant insert/update/
-- delete to the authenticated role here.
