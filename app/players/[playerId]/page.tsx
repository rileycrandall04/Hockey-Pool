import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InjuryBadge } from "@/components/injury-badge";

export const dynamic = "force-dynamic";

/**
 * Global player detail page.
 *
 * Shows everything we know about an NHL player: identity, current team,
 * regular-season totals, playoff totals (computed from player_stats),
 * and computed points-per-game for both stints. Linked from the draft
 * room, league standings, team rosters, and player directory.
 */
export default async function PlayerPage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  const id = Number(playerId);
  if (!Number.isFinite(id)) notFound();

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

  const { data: player } = await supabase
    .from("players")
    .select(
      "id, full_name, position, jersey_number, headshot_url, season_goals, season_assists, season_points, season_games_played, injury_status, injury_description, nhl_teams(abbrev, name)",
    )
    .eq("id", id)
    .single();
  if (!player) notFound();

  const { data: stats } = await supabase
    .from("player_stats")
    .select("goals, assists, ot_goals, fantasy_points, games_played")
    .eq("player_id", id)
    .maybeSingle();

  const team = Array.isArray(player.nhl_teams)
    ? player.nhl_teams[0]
    : player.nhl_teams;

  const seasonGames = player.season_games_played ?? 0;
  const seasonPoints = player.season_points ?? 0;
  const seasonPpg =
    seasonGames > 0 ? (seasonPoints / seasonGames).toFixed(2) : "—";

  const playoffGoals = stats?.goals ?? 0;
  const playoffAssists = stats?.assists ?? 0;
  const playoffOt = stats?.ot_goals ?? 0;
  const playoffFp = stats?.fantasy_points ?? 0;
  const playoffGames = stats?.games_played ?? 0;
  const playoffPpg =
    playoffGames > 0 ? (playoffFp / playoffGames).toFixed(2) : "—";

  return (
    <>
      <NavBar displayName={profile?.display_name ?? user.email ?? "Player"} />
      <main className="mx-auto max-w-3xl px-6 py-10 space-y-6">
        <Link
          href="/dashboard"
          className="text-sm text-ice-400 hover:underline"
        >
          ← Dashboard
        </Link>

        <div className="flex items-start gap-4">
          {player.headshot_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.headshot_url}
              alt={player.full_name}
              className="h-24 w-24 rounded-full border border-puck-border bg-puck-card object-cover"
            />
          )}
          <div>
            <h1 className="flex items-center text-3xl font-bold text-ice-50">
              {player.full_name}
              <InjuryBadge
                status={player.injury_status}
                description={player.injury_description}
              />
            </h1>
            <p className="text-sm text-ice-300">
              {player.position}
              {player.jersey_number ? ` · #${player.jersey_number}` : ""}
              {team?.abbrev ? ` · ${team.name}` : ""}
            </p>
            {player.injury_status && (
              <p className="mt-1 text-sm text-red-300">
                🚑 {player.injury_status}
                {player.injury_description
                  ? ` — ${player.injury_description}`
                  : ""}
              </p>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Regular season ({player.season_games_played} GP)</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <Stat label="Goals" value={player.season_goals ?? 0} />
              <Stat label="Assists" value={player.season_assists ?? 0} />
              <Stat label="Points" value={player.season_points ?? 0} highlight />
              <Stat label="Games" value={seasonGames} />
              <Stat label="P / GP" value={seasonPpg} highlight />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Playoffs ({playoffGames} GP)</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
              <Stat label="Goals" value={playoffGoals} />
              <Stat label="Assists" value={playoffAssists} />
              <Stat label="OT Goals" value={playoffOt} />
              <Stat label="Pool PTS" value={playoffFp} highlight />
              <Stat label="Games" value={playoffGames} />
              <Stat label="P / GP" value={playoffPpg} highlight />
            </dl>
            <p className="mt-3 text-xs text-ice-500">
              Pool points = goals + assists + (OT goals × 2). An OT goal
              is worth 3 total since the OT goal is also counted as a
              regular goal.
            </p>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-md border border-puck-border bg-puck-bg px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-ice-400">
        {label}
      </div>
      <div
        className={
          highlight
            ? "text-xl font-bold text-ice-50"
            : "text-xl font-semibold text-ice-100"
        }
      >
        {value}
      </div>
    </div>
  );
}
