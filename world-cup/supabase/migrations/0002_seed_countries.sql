-- Seed the 48-team field for the draft pool.
--
-- IMPORTANT: this is PLACEHOLDER data for testing the app end-to-end now.
-- The team list, FIFA ranks, and group letters here are approximate and
-- NOT the official 2026 draw. Phase 4 (API-Football ingestion) will
-- upsert the real field, ranks, groups, and fixtures by `code`/external_id.
--
-- Re-runnable: ON CONFLICT (code) DO NOTHING. To re-seed fresh values,
-- `delete from public.countries;` first (only safe before any drafts).

insert into public.countries (name, code, confederation, group_letter, fifa_rank) values
  ('Argentina',     'ARG', 'CONMEBOL',  'A', 1),
  ('France',        'FRA', 'UEFA',      'B', 2),
  ('Spain',         'ESP', 'UEFA',      'C', 3),
  ('England',       'ENG', 'UEFA',      'D', 4),
  ('Brazil',        'BRA', 'CONMEBOL',  'E', 5),
  ('Portugal',      'POR', 'UEFA',      'F', 6),
  ('Netherlands',   'NED', 'UEFA',      'G', 7),
  ('Belgium',       'BEL', 'UEFA',      'H', 8),
  ('Italy',         'ITA', 'UEFA',      'I', 9),
  ('Germany',       'GER', 'UEFA',      'J', 10),
  ('Croatia',       'CRO', 'UEFA',      'K', 11),
  ('Morocco',       'MAR', 'CAF',       'L', 12),
  ('Colombia',      'COL', 'CONMEBOL',  'A', 13),
  ('Uruguay',       'URU', 'CONMEBOL',  'B', 14),
  ('USA',           'USA', 'CONCACAF',  'C', 15),
  ('Mexico',        'MEX', 'CONCACAF',  'D', 16),
  ('Switzerland',   'SUI', 'UEFA',      'E', 17),
  ('Senegal',       'SEN', 'CAF',       'F', 18),
  ('Japan',         'JPN', 'AFC',       'G', 19),
  ('Denmark',       'DEN', 'UEFA',      'H', 20),
  ('Iran',          'IRN', 'AFC',       'I', 21),
  ('Korea Republic','KOR', 'AFC',       'J', 22),
  ('Australia',     'AUS', 'AFC',       'K', 23),
  ('Ecuador',       'ECU', 'CONMEBOL',  'L', 24),
  ('Austria',       'AUT', 'UEFA',      'A', 25),
  ('Ukraine',       'UKR', 'UEFA',      'B', 26),
  ('Canada',        'CAN', 'CONCACAF',  'C', 27),
  ('Nigeria',       'NGA', 'CAF',       'D', 28),
  ('Egypt',         'EGY', 'CAF',       'E', 29),
  ('Poland',        'POL', 'UEFA',      'F', 30),
  ('Serbia',        'SRB', 'UEFA',      'G', 31),
  ('Wales',         'WAL', 'UEFA',      'H', 32),
  ('Peru',          'PER', 'CONMEBOL',  'I', 33),
  ('Tunisia',       'TUN', 'CAF',       'J', 34),
  ('Costa Rica',    'CRC', 'CONCACAF',  'K', 35),
  ('Ghana',         'GHA', 'CAF',       'L', 36),
  ('Cameroon',      'CMR', 'CAF',       'A', 37),
  ('Algeria',       'ALG', 'CAF',       'B', 38),
  ('Norway',        'NOR', 'UEFA',      'C', 39),
  ('Paraguay',      'PAR', 'CONMEBOL',  'D', 40),
  ('Ivory Coast',   'CIV', 'CAF',       'E', 41),
  ('Saudi Arabia',  'KSA', 'AFC',       'F', 42),
  ('Qatar',         'QAT', 'AFC',       'G', 43),
  ('Panama',        'PAN', 'CONCACAF',  'H', 44),
  ('New Zealand',   'NZL', 'OFC',       'I', 45),
  ('Jordan',        'JOR', 'AFC',       'J', 46),
  ('Uzbekistan',    'UZB', 'AFC',       'K', 47),
  ('Cape Verde',    'CPV', 'CAF',       'L', 48)
on conflict (code) do nothing;
