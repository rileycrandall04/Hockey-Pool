-- Phase 5b: let the API drive team/group/rank data, with manual override.
--
-- When a commissioner/admin edits a country (name, group, or FIFA rank) in
-- the admin country editor, we set manual_override = true so the nightly
-- API sync stops touching that country's group/rank/name (it still backfills
-- external_id and flag).
--
-- Re-runnable.

alter table public.countries
  add column if not exists manual_override boolean not null default false;
