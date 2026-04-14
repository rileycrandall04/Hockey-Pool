import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { League } from "@/lib/types";

export default async function PlayersPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ q?: string; pos?: string }>;
}) {
  const { leagueId } = await params;
  const { q, pos } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single<League>();
  if (!league) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  let query = supabase
    .from("players")
    .select(
      "id, full_name, position, nhl_teams(abbrev), player_stats(goals, assists, ot_goals, fantasy_points)",
    )
    .eq("active", true)
    .limit(500);

  if (q) query = query.ilike("full_name", `%${q}%`);
  if (pos && pos !== "ALL") query = query.eq("position", pos);

  const { data: rows } = await query;

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
      />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Link
              href={`/leagues/${leagueId}`}
              className="text-sm text-ice-400 hover:underline"
            >
              ← {league.name}
            </Link>
            <h1 className="text-3xl font-bold text-ice-50">
              Player directory
            </h1>
            <p className="text-sm text-ice-300">
              Full playoff player pool with NHL IDs for commissioner use.
            </p>
          </div>
        </div>

        <form className="mb-4 flex gap-2" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name..."
            className="w-full rounded-md border border-puck-border bg-puck-bg px-3 py-2 text-sm text-ice-50 placeholder:text-ice-400 focus:outline-none focus:ring-2 focus:ring-ice-500"
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
          <CardHeader>
            <CardTitle>{rows?.length ?? 0} players</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-puck-border text-left text-ice-400">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-2 py-2">Pos</th>
                  <th className="px-2 py-2">Team</th>
                  <th className="px-2 py-2 text-right">G</th>
                  <th className="px-2 py-2 text-right">A</th>
                  <th className="px-2 py-2 text-right">OT</th>
                  <th className="px-2 py-2 text-right">PTS</th>
                  <th className="px-2 py-2 text-right">NHL ID</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map(
                  (
                    p: {
                      id: number;
                      full_name: string;
                      position: string;
                      nhl_teams: { abbrev: string } | { abbrev: string }[] | null;
                      player_stats:
                        | {
                            goals: number;
                            assists: number;
                            ot_goals: number;
                            fantasy_points: number;
                          }
                        | {
                            goals: number;
                            assists: number;
                            ot_goals: number;
                            fantasy_points: number;
                          }[]
                        | null;
                    },
                  ) => {
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
                        <td className="px-4 py-2 text-ice-100">
                          <Link
                            href={`/players/${p.id}`}
                            className="hover:underline"
                          >
                            {p.full_name}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-ice-300">{p.position}</td>
                        <td className="px-2 py-2 text-ice-300">
                          {team?.abbrev ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-right text-ice-300">
                          {stats?.goals ?? 0}
                        </td>
                        <td className="px-2 py-2 text-right text-ice-300">
                          {stats?.assists ?? 0}
                        </td>
                        <td className="px-2 py-2 text-right text-ice-300">
                          {stats?.ot_goals ?? 0}
                        </td>
                        <td className="px-2 py-2 text-right font-semibold text-ice-100">
                          {stats?.fantasy_points ?? 0}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-ice-400">
                          {p.id}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
