-- 0008_match_clock.sql
-- Live match clock: store the API-reported minute and detailed status code
-- (1H, HT, 2H, ET, BT, P, …) so the UI can show "67'", "HT", "ET" during a
-- game. Both are null until a match goes live.

alter table public.matches
  add column if not exists elapsed int,
  add column if not exists status_detail text;
