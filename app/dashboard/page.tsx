import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { League, Team } from "@/lib/types";

type LeagueWithTeam = League & { team: Team | null };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    seeded?: string;
    seed_error?: string;
    seed_warning?: string;
    left?: string;
    league_deleted?: string;
  }>;
}) {
  const { seeded, seed_error, seed_warning, left, league_deleted } =
    await searchParams;
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

  // Leagues this user is a commissioner of OR has a team in.
  const { data: myTeams } = await supabase
    .from("teams")
    .select("*, leagues(*)")
    .eq("owner_id", user.id);

  const { data: commishLeagues } = await supabase
    .from("leagues")
    .select("*")
    .eq("commissioner_id", user.id);

  // Dedupe into a single list of leagues.
  const leaguesById = new Map<string, LeagueWithTeam>();
  for (const row of myTeams ?? []) {
    const l = (row as unknown as { leagues: League }).leagues;
    if (l) leaguesById.set(l.id, { ...l, team: row as unknown as Team });
  }
  for (const l of commishLeagues ?? []) {
    if (!leaguesById.has(l.id)) leaguesById.set(l.id, { ...l, team: null });
  }
  const leagues = [...leaguesById.values()];

  // First-run setup: is the player pool seeded yet? If not, any signed-in
  // user can kick off the seed from here.
  const { count: playerCount } = await supabase
    .from("players")
    .select("id", { count: "exact", head: true });
  const poolEmpty = (playerCount ?? 0) === 0;

  return (
    <>
      <NavBar displayName={profile?.display_name ?? user.email ?? "Player"} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {seeded && (
          <div className="mb-6 rounded-md border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-200">
            ✅ Player pool seeded: {seeded}. You&rsquo;re ready to draft.
          </div>
        )}
        {seed_warning && (
          <div className="mb-6 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
            ⚠️ {seed_warning}
          </div>
        )}
        {seed_error && (
          <div className="mb-6 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            ❌ Seed failed: {seed_error}
          </div>
        )}
        {left && (
          <div className="mb-6 rounded-md border border-ice-500/40 bg-ice-500/10 px-4 py-3 text-sm text-ice-200">
            👋 {left}
          </div>
        )}
        {league_deleted && (
          <div className="mb-6 rounded-md border border-ice-500/40 bg-ice-500/10 px-4 py-3 text-sm text-ice-200">
            🗑️ {league_deleted}
          </div>
        )}
        {poolEmpty && !seeded && (
          <Card className="mb-6 border-ice-500/60 bg-ice-500/5">
            <CardHeader>
              <CardTitle>One-time setup: seed the player pool</CardTitle>
              <CardDescription>
                The NHL player pool is empty. Click below to fetch every
                current NHL team roster from the league&rsquo;s public API
                (~30–45 seconds). You only need to do this once. Once the
                playoff field is locked in, a commissioner can trim the
                pool from the Supabase dashboard or the cron endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action="/api/admin/seed" method="post">
                <Button type="submit">Seed player pool</Button>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-ice-50">Your leagues</h1>
            <p className="text-sm text-ice-300">
              Draft, manage, and track every Stanley Cup pool you&rsquo;re in.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action="/api/admin/reseed" method="post">
              <Button type="submit" variant="secondary">
                ↻ Refresh NHL data
              </Button>
            </form>
            <Link href="/leagues/join">
              <Button variant="secondary">Join league</Button>
            </Link>
            <Link href="/leagues/new">
              <Button>Create league</Button>
            </Link>
          </div>
        </div>

        {leagues.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-ice-300">
              <p className="mb-4">You&rsquo;re not in any leagues yet.</p>
              <div className="flex justify-center gap-2">
                <Link href="/leagues/new">
                  <Button>Create a league</Button>
                </Link>
                <Link href="/leagues/join">
                  <Button variant="secondary">Join with a code</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {leagues.map((l) => (
              <Card key={l.id}>
                <CardHeader>
                  <CardTitle>{l.name}</CardTitle>
                  <CardDescription>
                    Season {l.season} &middot; Draft:{" "}
                    <span className="font-medium text-ice-100">
                      {l.draft_status.replace("_", " ")}
                    </span>
                    {l.commissioner_id === user.id && " · Commissioner"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Link href={`/leagues/${l.id}`}>
                    <Button size="sm">Standings</Button>
                  </Link>
                  <Link href={`/leagues/${l.id}/draft`}>
                    <Button size="sm" variant="secondary">
                      Draft room
                    </Button>
                  </Link>
                  {l.team && (
                    <Link href={`/leagues/${l.id}/team/${l.team.id}`}>
                      <Button size="sm" variant="secondary">
                        My team
                      </Button>
                    </Link>
                  )}
                  {l.commissioner_id === user.id && (
                    <Link href={`/leagues/${l.id}/admin`}>
                      <Button size="sm" variant="ghost">
                        Admin
                      </Button>
                    </Link>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
