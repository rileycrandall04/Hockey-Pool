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
- [ ] **Phase 3** — auth, leagues, snake draft room (48 countries)
- [ ] **Phase 4** — API-Football ingestion cron + manual override editor
- [ ] **Phase 5** — pages: standings, my team, countries, fixtures,
      bracket, Golden Boot leaderboard
- [ ] **Phase 6** — push notifications, over/under, standings snapshots

## Development

```bash
cd world-cup
npm install
cp .env.example .env.local   # fill in Supabase + API-Football keys
npm run dev
npm test                     # scoring engine
```
