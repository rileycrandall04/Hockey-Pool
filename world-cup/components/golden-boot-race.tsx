import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { GOLDEN_BOOT_POINTS } from "@/lib/scoring";
import { Flag } from "@/components/flag";
import type { Country } from "@/lib/types";

interface ScorerRow {
  player_name: string;
  country_id: number | null;
  goals: number;
}

/**
 * Compact Golden Boot race for the standings page: the top scorers, who owns
 * each, and which owner currently holds the +5 bonus (🥾). Links to the full
 * leaderboard.
 */
export async function GoldenBootRace({ leagueId }: { leagueId: string }) {
  const svc = createServiceClient();
  const [{ data: scorerRows }, { data: countryRows }, { data: pickRows }, { data: teams }] = await Promise.all([
    svc.from("top_scorers").select("player_name, country_id, goals").order("rank", { ascending: true }).limit(5),
    svc.from("countries").select("id, name, code, flag_url"),
    svc.from("draft_picks").select("country_id, team_id").eq("league_id", leagueId),
    svc.from("teams").select("id, name").eq("league_id", leagueId),
  ]);
  const scorers = (scorerRows ?? []) as ScorerRow[];
  if (scorers.length === 0 || scorers[0].goals === 0) return null;

  const countryById = new Map((countryRows ?? []).map((c) => [c.id as number, c as Country]));
  const teamName = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]));
  const ownerOf = new Map<number, string>();
  for (const p of pickRows ?? []) ownerOf.set(p.country_id as number, teamName.get(p.team_id as string) ?? "");

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ice-400">
          🥾 Golden Boot race <span className="font-normal normal-case text-ice-500">· +{GOLDEN_BOOT_POINTS} to the leader&rsquo;s owner</span>
        </h2>
        <Link href={`/leagues/${leagueId}/golden-boot`} className="text-xs text-ice-400 hover:underline">Full race →</Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-puck-border">
        <table className="w-full text-sm">
          <tbody>
            {scorers.map((s, i) => {
              const c = s.country_id != null ? countryById.get(s.country_id) : null;
              const owner = s.country_id != null ? ownerOf.get(s.country_id) : null;
              return (
                <tr key={i} className={"border-t border-puck-border first:border-t-0 " + (i === 0 ? "bg-ice-500/10" : "bg-puck-bg")}>
                  <td className="px-3 py-1.5 text-ice-50">
                    <span className="inline-flex items-center gap-1.5">
                      {i === 0 && "🥾 "}
                      <Flag code={c?.code} url={c?.flag_url} />
                      {s.player_name}
                      <span className="text-xs text-ice-500">{c?.code ?? ""}</span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold text-ice-100">{s.goals}</td>
                  <td className="px-3 py-1.5 text-ice-300">{owner ? <span className="text-ice-100">{owner}</span> : <span className="text-ice-500">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
