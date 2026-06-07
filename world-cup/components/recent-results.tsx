import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { loadScorersByMatch } from "@/lib/match-scorers";
import { Flag } from "@/components/flag";
import { ScorerList } from "@/components/scorer-list";
import type { Country, Match } from "@/lib/types";

const STAGE_LABEL: Record<string, string> = {
  group: "Group", r32: "Round of 32", r16: "Round of 16", qf: "Quarterfinal",
  sf: "Semifinal", third: "Third place", final: "Final",
};

/**
 * Compact scoreboard of the most recently completed matches, for the league
 * home page. Shows score + goal scorers; each card links to the game
 * breakdown. Server component — loads its own data.
 */
export async function RecentResults({
  leagueId,
  limit = 6,
}: {
  leagueId: string;
  limit?: number;
}) {
  const svc = createServiceClient();
  const { data: matchRows } = await svc
    .from("matches")
    .select("*")
    .eq("status", "final")
    .not("home_goals", "is", null)
    .order("kickoff_utc", { ascending: false, nullsFirst: false })
    .limit(limit);
  const matches = (matchRows ?? []) as Match[];
  if (matches.length === 0) return null;

  const { data: countryRows } = await svc.from("countries").select("id, name, code, flag_url");
  const countryById = new Map((countryRows ?? []).map((c) => [c.id as number, c as Country]));
  const scorers = await loadScorersByMatch(svc, matches.map((m) => m.id));

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ice-400">Recent results</h2>
        <Link href={`/leagues/${leagueId}/schedule`} className="text-xs text-ice-400 hover:underline">
          Full schedule →
        </Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {matches.map((m) => {
          const h = countryById.get(m.home_country_id);
          const a = countryById.get(m.away_country_id);
          return (
            <div key={m.id} className="rounded-md border border-puck-border bg-puck-bg p-2.5">
              <Link href={`/leagues/${leagueId}/games/${m.id}`} className="group block">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-ice-500 group-hover:text-ice-300">
                  {STAGE_LABEL[m.stage] ?? m.stage} →
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex flex-1 items-center gap-1.5 text-ice-100">
                    <Flag code={h?.code} url={h?.flag_url} />
                    <span className="truncate">{h?.name ?? "TBD"}</span>
                  </span>
                  <span className="px-2 font-semibold tabular-nums text-ice-50">
                    {m.home_goals}–{m.away_goals}
                  </span>
                  <span className="flex flex-1 flex-row-reverse items-center gap-1.5 text-right text-ice-100">
                    <Flag code={a?.code} url={a?.flag_url} />
                    <span className="truncate">{a?.name ?? "TBD"}</span>
                  </span>
                </div>
                {m.went_to_shootout && (
                  <div className="mt-0.5 text-center text-[10px] text-ice-400">{m.home_pens}–{m.away_pens} pens</div>
                )}
              </Link>
              <ScorerList leagueId={leagueId} lines={scorers.get(m.id) ?? []} countryById={countryById} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
