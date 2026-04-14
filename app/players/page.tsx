import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import { DailyTicker } from "@/components/daily-ticker";
import {
  PlayersTable,
  type PlayersTableRow,
} from "@/components/players-table";
import type { Position } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Global player list.
 *
 * Fetches up to 500 active players on non-eliminated teams ordered by
 * season points, then hands them to <PlayersTable> which does all the
 * filtering client-side. Search and position filter are live — no
 * form submit, no Filter button.
 */
export default async function PlayersIndexPage() {
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

  const { data: rows } = await supabase
    .from("players")
    .select(
      "id, full_name, position, season_goals, season_assists, season_points, season_games_played, injury_status, injury_description, nhl_teams!inner(abbrev, eliminated), player_stats(fantasy_points)",
    )
    .eq("active", true)
    .eq("nhl_teams.eliminated", false)
    .order("season_points", { ascending: false })
    .limit(500);

  type RawRow = {
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

  const players: PlayersTableRow[] = ((rows ?? []) as RawRow[]).map((p) => {
    const team = Array.isArray(p.nhl_teams) ? p.nhl_teams[0] : p.nhl_teams;
    const stats = Array.isArray(p.player_stats)
      ? p.player_stats[0]
      : p.player_stats;
    return {
      id: p.id,
      full_name: p.full_name,
      position: (p.position as Position) ?? "F",
      team_abbrev: team?.abbrev ?? null,
      season_goals: p.season_goals ?? 0,
      season_assists: p.season_assists ?? 0,
      season_points: p.season_points ?? 0,
      season_games_played: p.season_games_played ?? 0,
      playoff_points: stats?.fantasy_points ?? 0,
      injury_status: p.injury_status,
      injury_description: p.injury_description,
    };
  });

  return (
    <>
      <NavBar displayName={profile?.display_name ?? user.email ?? "Player"} />
      <DailyTicker />
      <main className="mx-auto max-w-4xl px-3 py-6 sm:px-6 sm:py-8">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-ice-50 sm:text-3xl">
            Players
          </h1>
          <p className="text-xs text-ice-300 sm:text-sm">
            Every active NHL player on a non-eliminated team. Tap a
            name for full stats and PPG.
          </p>
        </div>

        <PlayersTable players={players} />
      </main>
    </>
  );
}
