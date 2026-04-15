import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
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
import { BackButton } from "@/components/back-button";
import { getCurrentLeagueContext } from "@/lib/current-league";

export const dynamic = "force-dynamic";

/**
 * App-owner-only server action that writes to the GLOBAL injury_status
 * column on the players row. This propagates to every league's
 * draft room, standings, and roster views via the v_team_rosters
 * coalesce(league_player_injuries.status, players.status).
 *
 * Per-league commissioner overrides still live in
 * league_player_injuries and take precedence over this global value
 * inside their own league.
 *
 * Pass action="clear" with empty status to clear the flag.
 */
async function setGlobalInjuryAction(formData: FormData) {
  "use server";
  const playerId = Number(formData.get("player_id"));
  const action = String(formData.get("action") ?? "save");
  const status =
    action === "clear"
      ? null
      : String(formData.get("status") ?? "").trim() || null;
  const description =
    action === "clear"
      ? null
      : String(formData.get("description") ?? "").trim() || null;

  if (!Number.isFinite(playerId)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!isAppOwner(user.email)) {
    redirect(
      `/players/${playerId}?injury_error=${encodeURIComponent("Only the app owner can edit global injury status.")}`,
    );
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from("players")
    .update({
      injury_status: status,
      injury_description: description,
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
 *
 * For the app owner, also renders a form to edit the global injury
 * flag with an optional free-text note (timeline / brief summary).
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

  const leagueCtx = await getCurrentLeagueContext(user.id);
  const canEditInjury = isAppOwner(user.email);

  const { data: player } = await supabase
    .from("players")
    .select(
      "id, full_name, position, jersey_number, headshot_url, season_goals, season_assists, season_points, season_games_played, injury_status, injury_description, injury_updated_at, nhl_teams(abbrev, name)",
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

  const injuryUpdatedAt = player.injury_updated_at as string | null;

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueCtx.leagueId}
        draftStatus={leagueCtx.draftStatus}
        isCommissioner={leagueCtx.isCommissioner}
        isOwner={canEditInjury}
      />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
        <BackButton
          fallbackHref={
            leagueCtx.leagueId
              ? `/leagues/${leagueCtx.leagueId}`
              : "/dashboard"
          }
          className="text-sm text-ice-400 hover:underline"
        >
          ← Back
        </BackButton>

        <div className="flex items-start gap-4">
          {player.headshot_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.headshot_url}
              alt={player.full_name}
              className="h-20 w-20 rounded-full border border-puck-border bg-puck-card object-cover sm:h-24 sm:w-24"
            />
          )}
          <div>
            <h1 className="flex items-center text-2xl font-bold text-ice-50 sm:text-3xl">
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

        {canEditInjury && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Injury status</span>
                {injuryUpdatedAt && (
                  <span className="text-xs font-normal text-ice-500">
                    updated {relativeTime(injuryUpdatedAt)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-ice-400">
                Updates the <strong>global</strong> injury status for
                this player. Every league&rsquo;s draft room, standings,
                and roster views will pick this up automatically. Per-
                league commissioner overrides take precedence inside
                their own league.
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

              <form action={setGlobalInjuryAction} className="space-y-3">
                <input type="hidden" name="player_id" value={id} />
                <input type="hidden" name="action" value="save" />
                <div className="space-y-1">
                  <Label htmlFor="status">Status</Label>
                  <Input
                    id="status"
                    name="status"
                    defaultValue={player.injury_status ?? ""}
                    placeholder='e.g. "Day-to-day", "Out 2-4 weeks", "IR"'
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="description">
                    Note / timeline (optional)
                  </Label>
                  <textarea
                    id="description"
                    name="description"
                    defaultValue={player.injury_description ?? ""}
                    placeholder="Lower-body injury suffered in Game 3. Re-evaluation Friday."
                    rows={3}
                    className="w-full rounded-md border border-puck-border bg-puck-bg px-3 py-2 text-sm text-ice-50 placeholder:text-ice-400 focus:outline-none focus:ring-2 focus:ring-ice-500"
                  />
                </div>
                <Button type="submit">
                  {player.injury_status ? "Update" : "Mark injured"}
                </Button>
              </form>

              {player.injury_status && (
                <form
                  action={setGlobalInjuryAction}
                  className="mt-2"
                >
                  <input type="hidden" name="player_id" value={id} />
                  <input type="hidden" name="action" value="clear" />
                  <Button type="submit" variant="ghost">
                    Clear flag
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        {!canEditInjury && (
          <p className="text-xs text-ice-500">
            Injury status above is from the global NHL feed. Per-league
            commissioner overrides are set from each league&rsquo;s admin
            page and only show inside that league&rsquo;s draft room,
            standings, and roster views.
          </p>
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

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
