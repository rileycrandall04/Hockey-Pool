import Link from "next/link";
import { Flag } from "@/components/flag";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtKickoff } from "@/lib/utils";
import type { ScorerLine } from "@/lib/match-scorers";
import type { Country, Match } from "@/lib/types";

/** One-line "who scored" summary: "⚽ Mbappé 23' · Kane 41' (pen)". */
function scorerSummary(lines: ScorerLine[], countryById: Map<number, Country>): string {
  return lines
    .filter((l) => !l.is_shootout)
    .map((l) => {
      const code = l.country_id != null ? countryById.get(l.country_id)?.code : null;
      const who = l.player_name ?? (code ? code : "Goal");
      const min = l.minute != null ? ` ${l.minute}'` : "";
      const og = l.type === "own_goal" ? " (OG)" : l.type === "penalty" ? " (pen)" : "";
      return `${who}${min}${og}`;
    })
    .join(" · ");
}

const STAGE_LABEL: Record<string, string> = {
  group: "Group", r32: "Round of 32", r16: "Round of 16", qf: "Quarterfinal",
  sf: "Semifinal", third: "Third place", final: "Final",
};

/**
 * Standings-page card for the current day's fixtures: kickoff time before a
 * game, a live badge + running score while it's on, and the final score once
 * it's done. Each row links to the full game page.
 */
export function TodaysGames({
  leagueId,
  games,
  countryById,
  scorers,
}: {
  leagueId: string;
  games: Match[];
  countryById: Map<number, Country>;
  scorers: Map<string, ScorerLine[]>;
}) {
  const anyLive = games.some((m) => m.status === "live");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Today&rsquo;s games
          {anyLive && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-red-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
              </span>
              Live
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {games.map((m) => {
          const home = countryById.get(m.home_country_id);
          const away = countryById.get(m.away_country_id);
          const live = m.status === "live";
          const played = m.status === "final" && m.home_goals != null && m.away_goals != null;
          const hasScore = (live || played) && m.home_goals != null && m.away_goals != null;
          const goalLine = scorerSummary(scorers.get(m.id) ?? [], countryById);
          return (
            <Link
              key={m.id}
              href={`/leagues/${leagueId}/games/${m.id}`}
              className={
                "group block rounded-md border p-2.5 " +
                (live ? "border-red-500/40 ring-1 ring-red-500/20" : "border-puck-border bg-puck-bg")
              }
            >
              <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-ice-500">
                <span className="group-hover:text-ice-300">{STAGE_LABEL[m.stage] ?? m.stage}</span>
                {live ? (
                  <span className="font-semibold text-red-300">Live</span>
                ) : (
                  <span>{played ? "Final" : fmtKickoff(m.kickoff_utc)}</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex flex-1 items-center gap-2 text-sm text-ice-100">
                  <Flag code={home?.code} url={home?.flag_url} />
                  <span className="truncate">{home?.name ?? "TBD"}</span>
                </span>
                <span
                  className={
                    "shrink-0 px-2 text-sm font-semibold " +
                    (hasScore ? "text-ice-50" : "text-ice-500")
                  }
                >
                  {hasScore ? `${m.home_goals} – ${m.away_goals}` : "v"}
                </span>
                <span className="flex flex-1 flex-row-reverse items-center gap-2 text-right text-sm text-ice-100">
                  <Flag code={away?.code} url={away?.flag_url} />
                  <span className="truncate">{away?.name ?? "TBD"}</span>
                </span>
              </div>
              {goalLine && (
                <div className="mt-1 truncate text-center text-[11px] text-ice-400">
                  ⚽ {goalLine}
                </div>
              )}
              {m.went_to_shootout && played && (
                <div className="mt-1 text-center text-[11px] text-ice-400">
                  {m.home_pens}–{m.away_pens} on penalties
                </div>
              )}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
