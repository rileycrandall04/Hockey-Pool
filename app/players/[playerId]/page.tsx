import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InjuryBadge } from "@/components/injury-badge";

export const dynamic = "force-dynamic";

/**
 * Set or clear a player's injury_status. Allowed for any user who
 * commissions at least one league — injury status is a global
 * column shared by every league, and the existing /admin injury
 * override form already has the same rule.
 *
 * Pass an empty status field to clear the flag.
 */
async function flagInjuryAction(formData: FormData) {
  "use server";
  const playerId = Number(formData.get("player_id"));
  const status = String(formData.get("status") ?? "").trim() || null;
  const description =
    String(formData.get("description") ?? "").trim() || null;

  if (!Number.isFinite(playerId)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Allow if the user commissions at least one league.
  const { count: commCount } = await supabase
    .from("leagues")
    .select("id", { count: "exact", head: true })
    .eq("commissioner_id", user.id);
  if ((commCount ?? 0) === 0) {
    redirect(
      `/players/${playerId}?injury_error=${encodeURIComponent("Only league commissioners can flag injuries.")}`,
    );
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from("players")
    .update({
      injury_status: status,
      injury_description: status
        ? description ?? "(commissioner-flagged)"
        : null,
      injury_updated_at: new Date().toISOString(),
    })
    .eq("id", playerId);

  if (error) {
    redirect(
      `/players/${playerId}?injury_error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath(`/players/${playerId}`);
  redirect(
    `/players/${playerId}?injury_success=${encodeURIComponent(
      status ? `Flagged as: ${status}` : "Injury cleared.",
    )}`,
  );
}

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
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{
    injury_success?: string;
    injury_error?: string;
  }>;
}) {
  const { playerId } = await params;
  const { injury_success, injury_error } = await searchParams;
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

  // Show the injury override form if the user is a commissioner of at
  // least one league. (Injury status is global, not per-league.)
  const { count: commCount } = await supabase
    .from("leagues")
    .select("id", { count: "exact", head: true })
    .eq("commissioner_id", user.id);
  const canFlagInjury = (commCount ?? 0) > 0;

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

        {canFlagInjury && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Injury override</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-ice-400">
                The auto NHL injury feed is unreliable. As a commissioner
                you can manually flag this player as injured (or clear
                the flag). This applies to <strong>every league</strong>{" "}
                that has them rostered. Leave the status blank to clear.
              </p>
              {injury_success && (
                <div className="mb-3 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
                  ✅ {injury_success}
                </div>
              )}
              {injury_error && (
                <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  ❌ {injury_error}
                </div>
              )}
              <form action={flagInjuryAction} className="space-y-3">
                <input type="hidden" name="player_id" value={id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="status">
                      Status (e.g. &ldquo;Day-to-day&rdquo;)
                    </Label>
                    <Input
                      id="status"
                      name="status"
                      defaultValue={player.injury_status ?? ""}
                      placeholder="Leave blank to clear"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="description">
                      Description (optional)
                    </Label>
                    <Input
                      id="description"
                      name="description"
                      defaultValue={
                        player.injury_description &&
                        player.injury_description !== "(commissioner-flagged)"
                          ? player.injury_description
                          : ""
                      }
                      placeholder="Lower body, week-to-week"
                    />
                  </div>
                </div>
                <Button type="submit">Save</Button>
              </form>
              {player.injury_status && (
                <form action={flagInjuryAction} className="mt-2">
                  <input type="hidden" name="player_id" value={id} />
                  <input type="hidden" name="status" value="" />
                  <input type="hidden" name="description" value="" />
                  <Button type="submit" variant="ghost">
                    Clear flag
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}
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
