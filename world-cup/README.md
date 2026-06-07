# 🌍 World Cup Draft Pool

A real-time 2026 FIFA World Cup pool, built on the same Next.js 15 +
Supabase stack as the Stanley Cup pool in the parent repo. 12 owners
snake-draft the entire 48-team field (4 countries each), and the app
scores every match — group stage through the final — pulling results
nightly from API-Football with commissioner manual override.

## Scoring rules

**Group stage** (per match, per owned country)

| Event | Points |
| --- | --- |
| Win | 3 |
| Draw | 1 |
| Loss | 0 |
| Goal scored | +1 |
| Goal conceded | −0.5 |
| Clean sheet | +1 |
| **Upset win** (beat a better FIFA-ranked* side) | +5 |

\* FIFA ranking frozen at kickoff. Win only — a draw is not an upset.

**Advancement** (one-time, the moment the bracket places you in the round)

| Round of 32 | R16 | QF | SF | Final | Champion |
| --- | --- | --- | --- | --- | --- |
| +1 | +2 | +3 | +4 | +5 | +8 |

**Knockout matches** are scored like group matches (win 3 / goals ±, clean
sheet) except a **shootout** counts as a draw after 120′ (both +1), then the
**shootout winner gets +4** and the **loser +2**. Shootout PKs never count as
goals. The third-place playoff is scored as a match but grants no
advancement bonus.

**Golden Boot** — +5 to the owner of the tournament's top scorer (live
leaderboard from goal events; tiebreak goals → assists → fewer minutes).

**Tiebreakers** (in order): total points → total goals scored by owned
countries → furthest-advancing country → closest pre-draft over/under guess.

All of this lives in [`lib/scoring.ts`](lib/scoring.ts) and is covered by
[`lib/scoring.test.ts`](lib/scoring.test.ts). Every number is derived from
the `matches` table + each country's `fifa_rank`, so scores fully recompute
on each ingest — there are no running totals to drift out of sync.

## Data model

- `countries` — the 48-team field and the entire draft pool (FIFA rank,
  group, flag, API id).
- `matches` — 104 fixtures (group + knockout), scores in regulation + ET,
  shootout flag + PK tally.
- `match_goals` / `players` — per-goal rows for the Golden Boot race;
  players are upserted lazily from goal events.
- `leagues` / `teams` / `draft_picks` — accounts, rosters (4 countries
  each), snake-draft picks. `teams.over_under_guess` is the secret
  tiebreaker.
- `score_adjustments` — commissioner deltas (numeric, supports −0.5 steps).
- `golden_boot` — the locked-in official top scorer per league.

Row-level security mirrors the hockey app: tournament data is public-read
to authenticated users; league/team/pick data is readable only by members;
all writes go through server routes using the service-role key.

## Data source

[API-Football](https://www.api-football.com/) (api-sports.io) free tier —
100 requests/day, covers the 2026 World Cup with fixtures, match events
(goalscorers), and top scorers. A nightly Vercel Cron ingests results;
the commissioner can manually correct any match.

## Build status

- [x] **Phase 0** — project scaffold (configs, theme, env)
- [x] **Phase 1** — schema + types
- [x] **Phase 2** — scoring engine (`scoreCountry`, `scoreOwner`,
      `rankOwners`) + tests
- [x] **Phase 3** — auth, leagues, **live snake draft of 48 countries**,
      standings, country list, team breakdown, commissioner tools
- [x] **Phase 4** — **API-Football ingestion** (nightly cron + on-demand
      sync) and a **manual match editor** that locks results from being
      overwritten
- [x] **Phase 5** — **group tables**, **schedule** (date picker) + **game**
      pages, **country** match-history pages, **players** directory (live
      search) + **player** pages, **Golden Boot** leaderboard, **manual
      goal entry** with assignable app-admins, and **per-match goal-scorer
      ingestion** in the nightly sync
- [ ] **Phase 6** — knockout bracket view, push notifications, standings
      snapshots
- [ ] **Polish backlog** — official 2026 groups + FIFA ranks (replace the
      placeholder seed); make wide tables fit/scroll on mobile

## Match data (Phase 4)

Two ways in, and they cooperate:

1. **API-Football sync.** `lib/sync-matches.ts` pulls every World Cup
   fixture and the top-scorers leaderboard in two requests. Run it
   nightly via Vercel Cron (`/api/cron/update-matches`, see `vercel.json`)
   or on demand from **Admin → Sync from API-Football** (app-owner only).
   Country names are matched to our rows by a normalized-name + alias map,
   backfilling each country's `external_id` on first match.
2. **Manual editor.** **Admin → Edit match results** lets the commissioner
   add or correct any match. A manual edit sets `locked = true`, so the
   nightly sync never overwrites it.

Standings recompute from `matches` on every page load — no stored totals —
so either path moves the table immediately.

## What works today

Sign up → create/join a league → (commissioner) randomize order & start
the draft → snake-draft all 48 countries live (manual click or
auto-pick) → standings, per-country score breakdowns, and a secret
over/under guess per team. Match scoring is wired through the engine but
reads zero until Phase 4 feeds it results.

## Run it locally

```bash
cd world-cup
npm install
cp .env.example .env.local      # fill in the Supabase keys (API-Football
                                # is only needed for Phase 4 ingestion)
npm test                        # scoring engine (14 cases)
npm run dev                     # http://localhost:3000
```

### Supabase setup (one time)

1. Create a project at <https://supabase.com>.
2. In the SQL editor, run the migrations in order:
   **`0001_initial_schema.sql`**, **`0002_seed_countries.sql`** (48-team
   placeholder field), **`0003_ingestion.sql`** (match locks + top-scorers
   cache).
3. **Database → Replication:** add `draft_picks` and `leagues` to the
   `supabase_realtime` publication so the draft board updates live for
   everyone. (Without this, use the **↻ Refresh** button in the draft room.)
4. Copy the project URL + anon key + service-role key into `.env.local`.

### To pull live results (optional — manual entry works without it)

5. Get a free key at <https://www.api-football.com/> and set
   `API_FOOTBALL_KEY` in `.env.local` (and your Vercel project).
6. Set `CRON_SECRET` to a long random string. Vercel Cron sends it as a
   Bearer token to `/api/cron/update-matches` on the schedule in
   `vercel.json` (08:00 UTC = 4am ET).
7. Set `APP_OWNER_EMAIL` to your signup email so only you can trigger the
   on-demand sync.

Without an API key you can still test everything: use **Admin → Edit match
results** to enter scores by hand and watch the standings move.

Then sign up, create a league, open the **Draft** lobby, **Start draft**,
and pick. To re-run a draft, use **Admin → Reset draft**.
