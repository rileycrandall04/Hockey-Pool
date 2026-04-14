import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import { Card, CardContent } from "@/components/ui/card";
import { InjuryBadge } from "@/components/injury-badge";

export const dynamic = "force-dynamic";

/**
 * Global player list. Search by name, optional position filter, sorted
 * by current-season points descending. Each row links to /players/[id].
 *
 * Distinct from /leagues/[leagueId]/players which is the league-scoped
 * directory used for finding NHL IDs to add to a roster manually.
 */
export default async function PlayersIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pos?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { q, pos } = await searchParams;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  let query = supabase
    .from("players")
    .select(
      "id, full_name, position, season_goals, season_assists, season_points, season_games_played, injury_status, injury_description, nhl_teams!inner(abbrev, eliminated), player_stats(goals, assists, ot_goals, fantasy_points)",
    )
    .eq("active", true)
    .eq("nhl_teams.eliminated", false)
    .order("season_points", { ascending: false })
    .limit(500);

  if (q && q.trim().length > 0) {
    query = query.ilike("full_name", `%${q.trim()}%`);
  }
  if (pos && pos !== "ALL") {
    query = query.eq("position", pos);
  }

  const { data: rows } = await query;

  type PlayerRow = {
    id: number;
    full_name: string;
    position: string;
    season_goals: number | null;
    season_assists: number | null;
    season_points: number | null;
    season_games_played: number | null;
    injury_status: string | null;
    injury_description: string | null;
    nhl_teams: { abbrev: string } | { abbrev: string }[] | null;
    player_stats:
      | { fantasy_points: number }
      | { fantasy_points: number }[]
      | null;
  };

  return (
    <>
      <NavBar displayName={profile?.display_name ?? user.email ?? "Player"} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-ice-50">Players</h1>
          <p className="text-sm text-ice-300">
            Every active NHL player on a non-eliminated team. Tap a name
            for full stats and PPG.
          </p>
        </div>

        <form className="mb-4 flex flex-wrap gap-2" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name..."
            className="min-w-[180px] flex-1 rounded-md border border-puck-border bg-puck-bg px-3 py-2 text-sm text-ice-50 placeholder:text-ice-400 focus:outline-none focus:ring-2 focus:ring-ice-500"
          />
          <select
            name="pos"
            defaultValue={pos ?? "ALL"}
            className="rounded-md border border-puck-border bg-puck-bg px-3 py-2 text-sm text-ice-50"
          >
            {["ALL", "C", "L", "R", "D", "G"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button className="rounded-md bg-ice-500 px-4 py-2 text-sm font-medium text-white hover:bg-ice-600">
            Filter
          </button>
        </form>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-puck-border text-left text-ice-400">
                  <th className="px-3 py-2">Player</th>
                  <th className="px-2 py-2">Pos</th>
                  <th className="px-2 py-2">Team</th>
                  <th className="px-2 py-2 text-right">GP</th>
                  <th className="px-2 py-2 text-right">G</th>
                  <th className="px-2 py-2 text-right">A</th>
                  <th className="px-2 py-2 text-right">PTS</th>
                  <th className="px-2 py-2 text-right">PO</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-6 text-center text-ice-400"
                    >
                      No players match your filters.
                    </td>
                  </tr>
                )}
                {((rows ?? []) as PlayerRow[]).map((p) => {
                  const team = Array.isArray(p.nhl_teams)
                    ? p.nhl_teams[0]
                    : p.nhl_teams;
                  const stats = Array.isArray(p.player_stats)
                    ? p.player_stats[0]
                    : p.player_stats;
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-puck-border last:border-0"
                    >
                      <td className="px-3 py-1.5">
                        <Link
                          href={`/players/${p.id}`}
                          className="inline-flex items-center font-medium text-ice-100 hover:underline"
                        >
                          {p.full_name}
                          <InjuryBadge
                            status={p.injury_status}
                            description={p.injury_description}
                          />
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 text-ice-300">{p.position}</td>
                      <td className="px-2 py-1.5 text-ice-300">
                        {team?.abbrev ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-ice-300">
                        {p.season_games_played ?? 0}
                      </td>
                      <td className="px-2 py-1.5 text-right text-ice-300">
                        {p.season_goals ?? 0}
                      </td>
                      <td className="px-2 py-1.5 text-right text-ice-300">
                        {p.season_assists ?? 0}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold text-ice-50">
                        {p.season_points ?? 0}
                      </td>
                      <td className="px-2 py-1.5 text-right text-ice-300">
                        {stats?.fantasy_points ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
