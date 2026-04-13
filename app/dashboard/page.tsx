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

export default async function DashboardPage() {
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

  return (
    <>
      <NavBar displayName={profile?.display_name ?? user.email ?? "Player"} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-ice-50">Your leagues</h1>
            <p className="text-sm text-ice-300">
              Draft, manage, and track every Stanley Cup pool you&rsquo;re in.
            </p>
          </div>
          <div className="flex gap-2">
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
