# Live scoring (5-minute polling)

The front-end auto-refreshes any page with a live match every 30s, but it only
shows what's in the database. To make scores truly live, run the ingestion
endpoint frequently during match days.

## Endpoint

```
POST/GET  /api/cron/update-matches?mode=light
Header:   Authorization: Bearer <CRON_SECRET>
```

- `mode=light` skips the `/teams` and `/standings` API-Football calls (team
  list, group letters, logos rarely change intra-day) and refreshes live
  scorers. A light poll is ~1–2 API calls when nothing is live, plus 1 call
  per in-progress match.
- Omit `mode` (or `mode=full`) for the nightly run that also refreshes the
  team list, groups, and FIFA ranks.

## Two cadences

| When | How | Mode |
| --- | --- | --- |
| Once nightly | Vercel cron (`vercel.json`, `0 8 * * *`) | full |
| Every 5 min, match days | External pinger (below) | light |

Vercel's Hobby plan caps crons at once per day, so the 5-minute live poll runs
from an external scheduler. (Vercel Pro can run it natively instead.)

## External pinger — cron-job.org (free)

1. Create a free account at https://cron-job.org.
2. New cronjob:
   - **URL**: `https://<your-app>.vercel.app/api/cron/update-matches?mode=light`
   - **Schedule**: every 5 minutes (`*/5 * * * *`). Optionally restrict to
     match-window hours (e.g. 09:00–24:00 MT) to be frugal.
   - **Request method**: `GET`
   - **Headers**: add `Authorization` = `Bearer <CRON_SECRET>` (the same
     `CRON_SECRET` set in Vercel env vars).
3. Save. Use "Run now" to test — a `200` with `{"ok":true,"mode":"light",...}`
   means it's working.

## Call budget

At every-5-min, 24/7 that's 288 polls/day → roughly 600–2,000 API-Football
calls/day during the tournament, well inside the paid Pro tier (7,500/day).
Restricting to match-window hours cuts it further.
