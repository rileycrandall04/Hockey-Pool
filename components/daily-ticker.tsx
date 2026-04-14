import { createServiceClient } from "@/lib/supabase/server";
import type { DailyRecap } from "@/lib/types";

/**
 * Horizontally scrollable ticker shown at the top of the landing page.
 *
 * Reads the most recent daily_recaps date that has any rows and renders
 * one card per game with the final score and goal scorers. If no rows
 * exist (pre-playoffs, freshly seeded DB, or NHL API hiccup), the
 * component renders nothing.
 *
 * Implemented as a server component so anonymous visitors can see it
 * without bouncing through Supabase auth. Uses the service client to
 * bypass RLS — the daily_recaps policy already grants SELECT to anon,
 * but using the service client lets us avoid coupling the ticker to
 * auth at all.
 */
export async function DailyTicker() {
  const svc = createServiceClient();

  // Find the most recent date with any recap rows.
  const { data: latest } = await svc
    .from("daily_recaps")
    .select("game_date")
    .order("game_date", { ascending: false })
    .limit(1);

  const date = latest?.[0]?.game_date as string | undefined;
  if (!date) return null;

  const { data: recaps } = await svc
    .from("daily_recaps")
    .select("*")
    .eq("game_date", date)
    .order("game_id", { ascending: true });

  const rows = (recaps ?? []) as DailyRecap[];
  if (rows.length === 0) return null;

  return (
    <section className="border-y border-puck-border bg-puck-card">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-ice-300">
            Last night&rsquo;s scores
          </div>
          <div className="text-xs text-ice-400">{prettyDate(date)}</div>
        </div>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
          {rows.map((g) => (
            <RecapCard key={g.game_id} game={g} />
          ))}
        </div>
      </div>
    </section>
  );
}

function RecapCard({ game }: { game: DailyRecap }) {
  const awayWon = game.away_team_score > game.home_team_score;
  const homeWon = game.home_team_score > game.away_team_score;
  return (
    <div className="min-w-[220px] flex-shrink-0 rounded-lg border border-puck-border bg-puck-bg p-3">
      <div className="mb-2 flex items-center justify-between text-sm">
        <div className={awayWon ? "font-semibold text-ice-50" : "text-ice-300"}>
          {game.away_team_abbrev}
        </div>
        <div className="font-mono text-ice-100">
          {game.away_team_score}–{game.home_team_score}
          {game.was_overtime && (
            <span className="ml-1 text-xs text-ice-400">OT</span>
          )}
        </div>
        <div className={homeWon ? "font-semibold text-ice-50" : "text-ice-300"}>
          {game.home_team_abbrev}
        </div>
      </div>
      {game.scorers.length > 0 ? (
        <ul className="space-y-0.5 text-[11px] text-ice-300">
          {game.scorers.slice(0, 5).map((s) => (
            <li key={s.player_id} className="flex justify-between gap-2">
              <span className="truncate">{s.name}</span>
              <span className="flex-shrink-0 text-ice-400">
                {s.goals > 0 && `${s.goals}G`}
                {s.goals > 0 && s.assists > 0 && " "}
                {s.assists > 0 && `${s.assists}A`}
              </span>
            </li>
          ))}
          {game.scorers.length > 5 && (
            <li className="text-[10px] text-ice-500">
              +{game.scorers.length - 5} more
            </li>
          )}
        </ul>
      ) : (
        <div className="text-[11px] text-ice-500">No scoring summary</div>
      )}
    </div>
  );
}

function prettyDate(iso: string): string {
  // Render as "Apr 13" without timezone conversion (the date is stored
  // in Eastern as a YYYY-MM-DD string).
  const [, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[(m ?? 1) - 1]} ${d ?? 1}`;
}
