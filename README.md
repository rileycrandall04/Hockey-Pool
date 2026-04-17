# 🏒 Stanley Cup Pool

A real-time Stanley Cup playoff pool built with Next.js 15, Supabase, and
the public NHL API. Run it for your buddies: draft 12 players per team
from the playoff pool, score the top 10 nightly (with 2 defensemen
required), and let the app pull game data from the NHL every night at
4am Eastern.

## Features

- **Accounts & leagues.** Email/password auth, unlimited leagues per user,
  one team per user per league (completely independent rosters).
- **Snake draft.** Manual click-to-pick, one-click auto-pick (best
  available, with D-fallback logic), real-time updates via Supabase
  Realtime.
- **Rule-aware scoring.** Goals + assists, OT goals worth 3, top 10 of
  12 count, and the top 10 must include at least 2 defensemen — if a D's
  raw points aren't high enough, the scorer swaps in the highest-scoring
  D from the bench.
- **Nightly stat ingestion.** A Vercel Cron hits `/api/cron/update-stats`
  at 04:00 America/New_York every day. It pulls every finalized NHL game
  from the previous date and increments cumulative player totals.
- **Commissioner tools.** Edit any roster, drop picks, add arbitrary
  players, and log scoring adjustments (with a reason) to fix ingestion
  mistakes.

## Tech stack

- **Next.js 15 (App Router) + TypeScript + Tailwind.** Server components
  for data fetching, server actions for mutations, a client component
  for the live draft room.
- **Supabase Postgres + Auth + Realtime.** Row-level security enforces
  that only league members can read league data. Writes to rosters run
  through server routes using the service-role key so we can validate
  draft order atomically.
- **NHL API (`api-web.nhle.com`).** Unofficial but stable. The client
  lives in `lib/nhl-api.ts` and wraps `/standings/now`, `/roster/{abbrev}/current`,
  `/schedule/{date}`, and `/gamecenter/{id}/boxscore`.

## Directory layout

```
app/                      # Next.js routes
  page.tsx                # landing
  login/, signup/         # auth forms (server actions)
  dashboard/              # list of leagues
  leagues/
    new/, join/           # create / join
    [leagueId]/
      page.tsx            # standings
      draft/              # live draft room (client)
      team/[teamId]/      # roster + top-10 scoring
      players/            # player directory (has NHL IDs)
      admin/              # commissioner controls
  api/
    draft/start|pick|autopick/   # draft mutations
    cron/sync-players/          # seed playoff pool (one-shot)
    cron/update-stats/          # nightly stats (vercel cron)

lib/
  scoring.ts              # scoreTeam(): top-10 + 2D rule
  draft.ts                # snake order helpers
  nhl-api.ts              # NHL API client
  supabase/               # browser, server, middleware clients
  types.ts                # shared TS types

components/
  draft-room.tsx          # live draft (client + realtime)
  nav-bar.tsx
  ui/                     # button, card, input primitives

supabase/migrations/
  0001_initial_schema.sql # tables, RLS, triggers, view

middleware.ts             # refresh session + gate private routes
vercel.json               # cron schedule
```

## Data model (highlights)

- `profiles` — 1:1 with `auth.users` (filled by a trigger on signup).
- `leagues` — name, season, commissioner, join code, draft settings.
- `teams` — one per user per league; unique `(league_id, owner_id)`.
- `players` / `player_stats` / `nhl_teams` — the cached NHL pool.
- `draft_picks` — one row per roster spot, unique per `(league, player)`.
- `score_adjustments` — commissioner-logged deltas (+/- points) with a
  reason.
- `v_team_rosters` — convenience view joining picks + player + stats,
  used by the team/standings pages.

Row-level security policies:
- Leagues are readable only by members or the commissioner.
- Teams/picks/adjustments are readable only by league members.
- Writes to `draft_picks` and `score_adjustments` are **not** open to
  authenticated clients — they go through server routes that use the
  service-role key, which lets us validate draft order, player legality,
  and commissioner-only invariants on the server.

## Getting started

### 1. Clone & install

```bash
git clone ... && cd Hockey-Pool
npm install
cp .env.example .env.local
```

### 2. Create a Supabase project

1. Create a new project at <https://supabase.com>.
2. In the SQL editor paste `supabase/migrations/0001_initial_schema.sql`
   and run it.
3. Under **Database → Replication**, add `draft_picks`, `leagues`, and
   `teams` to the `supabase_realtime` publication so the draft room can
   subscribe to live updates.
4. Copy the URL and anon key into `.env.local` as
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. Copy the service-role key into `SUPABASE_SERVICE_ROLE_KEY`.
   **Never** commit this.
6. Generate a long random string and put it in `CRON_SECRET`.

### 3. Seed the playoff player pool

Once you know the 16 teams that clinched, hit the sync endpoint:

```bash
curl -X POST https://your-app.vercel.app/api/cron/sync-players \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"abbrevs":["TOR","BOS","TBL","FLA","NYR","NYI","CAR","WSH",
                  "EDM","VAN","DAL","COL","WPG","NSH","VGK","LAK"]}'
```

That single call:
- upserts the `nhl_teams` rows,
- pulls each team's current roster from the NHL API,
- upserts the `players` rows and initializes `player_stats` at zero.

### 4. Run locally

```bash
npm run dev
```

Open <http://localhost:3000>, sign up, create a league, share the join
code, and start drafting.

### 5. Deploy

Push to Vercel. Set the same env vars in the project settings.

The cron in `vercel.json` runs at `0 8 * * *` UTC which is
**4:00am EDT** (the Stanley Cup playoffs run April–June, so EDT is in
effect). If you ever run this during standard time, bump to `0 9 * * *`.

Vercel Cron sends a GET, which the route accepts, but you still need to
set `CRON_SECRET` in your Vercel environment — Vercel automatically
sends an `Authorization: Bearer <value>` header on cron calls using the
`CRON_SECRET` env var.

## Scoring rules

| Stat          | Points |
| ------------- | ------ |
| Goal          | 1      |
| Assist        | 1      |
| OT goal       | 3 (=1 goal + 2 OT bonus) |

Each team rosters 12 players; only the top 10 by points count toward
the team score, and those 10 must include **at least 2 defensemen**.
The algorithm:

1. Sort the roster by `fantasy_points` desc, tiebreak by goals then
   games played.
2. Take the top 10.
3. If that set has fewer than 2 D, swap the lowest-scoring non-D for
   the highest-scoring D on the bench until the D requirement is met.

All 12 players are displayed on the team page — the bottom 2 (or more,
if D-swaps happen) are shown as "bench" with their points visible but
not counted.

## Troubleshooting

- **"No players match your filters" in the draft room.** You haven't
  run `/api/cron/sync-players` yet. Seed the pool first.
- **Cron not running.** Confirm `CRON_SECRET` is set in Vercel and that
  the route URL matches `vercel.json`.
- **OT goals not showing up as 3 points.** The `fantasy_points` column
  is a generated column; it recomputes every write. Double check that
  your ingestion wrote `ot_goals > 0` — check `lib/nhl-api.ts`'s OT
  detection if a game isn't being picked up.
- **Draft order feels wrong.** Order is randomized on start (see
  `randomizeDraftOrder`). Commissioner can reset by deleting all
  `draft_picks` and setting `draft_status = 'pending'` in SQL, then
  pressing "Start draft" again.

## Next steps

Things that are easy extensions if you want to keep building:

- Invite links (pre-filled join codes).
- In-draft chat via Supabase Realtime presence.
- Emailed daily summaries using the same cron.
- Trade proposals + commissioner approval flow.
- Goalie scoring (shutouts / wins).
