import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { League, Team } from "@/lib/types";

type LeagueWithTeam = League & { team: Team | null };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string; league_deleted?: string }>;
}) {
  const { left, league_deleted } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  // Leagues this user is a commissioner of OR has a team in. Query teams
  // first, then fetch their leagues via the service client to sidestep
  // RLS quirks on embedded joins (same pattern as the hockey app).
  const { data: myTeams } = await supabase
    .from("teams")
    .select("*")
    .eq("owner_id", user.id);

  const svc = createServiceClient();
  const teamLeagueIds = [
    ...new Set((myTeams ?? []).map((t) => t.league_id as string)),
  ];
  const memberLeagues: League[] = [];
  if (teamLeagueIds.length > 0) {
    const { data } = await svc.from("leagues").select("*").in("id", teamLeagueIds);
    if (data) memberLeagues.push(...(data as League[]));
  }

  const { data: commishLeagues } = await supabase
    .from("leagues")
    .select("*")
    .eq("commissioner_id", user.id);

  const leaguesById = new Map<string, LeagueWithTeam>();
  const teamsByLeague = new Map<string, Team>();
  for (const t of (myTeams ?? []) as Team[]) teamsByLeague.set(t.league_id, t);
  for (const l of memberLeagues) {
    leaguesById.set(l.id, { ...l, team: teamsByLeague.get(l.id) ?? null });
  }
  for (const l of (commishLeagues ?? []) as League[]) {
    if (!leaguesById.has(l.id)) leaguesById.set(l.id, { ...l, team: null });
  }
  const leagues = [...leaguesById.values()];

  return (
    <>
      <NavBar displayName={profile?.display_name ?? user.email ?? "Player"} />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        {left && (
          <div className="mb-4 rounded-md border border-ice-500/40 bg-ice-500/10 px-4 py-3 text-sm text-ice-200">
            👋 {left}
          </div>
        )}
        {league_deleted && (
          <div className="mb-4 rounded-md border border-ice-500/40 bg-ice-500/10 px-4 py-3 text-sm text-ice-200">
            🗑️ {league_deleted}
          </div>
        )}

        <h1 className="mb-4 text-2xl font-bold text-ice-50">Your leagues</h1>

        {leagues.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-10">
              <p className="text-sm text-ice-300">
                You&rsquo;re not in any leagues yet.
              </p>
              <div className="flex gap-3">
                <Link href="/leagues/join">
                  <Button>Join a league</Button>
                </Link>
                <Link href="/leagues/new">
                  <Button variant="secondary">Create a league</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {leagues.map((l) => {
              const isCommish = l.commissioner_id === user.id;
              return (
                <li
                  key={l.id}
                  className="flex items-center gap-2 rounded-md border border-puck-border bg-puck-card"
                >
                  <Link
                    href={`/leagues/${l.id}`}
                    className="flex min-w-0 flex-1 flex-col px-4 py-3 hover:bg-puck-border/40"
                  >
                    <span className="truncate text-base font-semibold text-ice-50">
                      {l.name}
                    </span>
                    <span className="truncate text-xs text-ice-400">
                      Season {l.season} &middot; {l.draft_status.replace("_", " ")}
                      {isCommish && " · commissioner"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
