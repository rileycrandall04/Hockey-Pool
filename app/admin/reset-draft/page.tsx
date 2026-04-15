import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { getCurrentLeagueContext } from "@/lib/current-league";
import { NavBar } from "@/components/nav-bar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DraftStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * App-owner-only cross-league draft reset page.
 *
 * Regular drafts can be reset by the league's commissioner from the
 * per-league /leagues/{id}/admin page. This page gives the app owner
 * the same capability in any league they're a member of — without
 * having to be promoted to commissioner first. Useful when a
 * commissioner is asleep / AFK and the pool needs to re-roll the
 * draft immediately, or when the owner is troubleshooting multiple
 * test leagues at once.
 *
 * Guarded at three levels:
 *   1. APP_OWNER_EMAIL gate on the page render (this function)
 *   2. Same gate re-checked inside the server action
 *   3. Owner must ALSO have a team in the league being reset —
 *      "any league I'm in" per the feature request. No drive-by
 *      resets of leagues the owner hasn't joined.
 *   4. Plus the usual "type RESET to confirm" textbox.
 */

interface LeagueRow {
  id: string;
  name: string;
  draft_status: DraftStatus;
  commissioner_id: string;
  roster_size: number;
  commissioner_display_name?: string | null;
  pick_count: number;
  team_count: number;
}

async function resetDraftAsOwnerAction(formData: FormData) {
  "use server";

  const leagueId = String(formData.get("league_id") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();

  if (confirm !== "RESET") {
    redirect(
      `/admin/reset-draft?error=${encodeURIComponent("Type RESET to confirm.")}`,
    );
  }

  // Re-check owner auth inside the action. Don't trust that the
  // caller actually reached this action through the rendered page —
  // a rogue POST from anywhere else should 403 just the same.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) redirect("/dashboard");

  // Require owner-has-a-team-in-this-league, matching "any league I'm in".
  const { data: myTeam } = await supabase
    .from("teams")
    .select("id")
    .eq("league_id", leagueId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!myTeam) {
    redirect(
      `/admin/reset-draft?error=${encodeURIComponent(
        "You don't have a team in that league.",
      )}`,
    );
  }

  const svc = createServiceClient();

  const { data: leagueRow, error: leagueLookupError } = await svc
    .from("leagues")
    .select("id, name")
    .eq("id", leagueId)
    .single<{ id: string; name: string }>();
  if (leagueLookupError || !leagueRow) {
    redirect(
      `/admin/reset-draft?error=${encodeURIComponent(
        `League lookup failed: ${leagueLookupError?.message ?? "not found"}`,
      )}`,
    );
  }

  const { count: pickCount, error: countError } = await svc
    .from("draft_picks")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId);
  if (countError) {
    redirect(
      `/admin/reset-draft?error=${encodeURIComponent(
        `Count failed: ${countError.message}`,
      )}`,
    );
  }

  const { error: deleteError } = await svc
    .from("draft_picks")
    .delete()
    .eq("league_id", leagueId);
  if (deleteError) {
    redirect(
      `/admin/reset-draft?error=${encodeURIComponent(
        `Delete failed: ${deleteError.message}`,
      )}`,
    );
  }

  const { error: leagueUpdateError } = await svc
    .from("leagues")
    .update({
      draft_status: "pending",
      draft_current_team: null,
      draft_round: 1,
      draft_started_at: null,
      draft_on_clock_since: null,
      draft_stale_notified_for: null,
    })
    .eq("id", leagueId);
  if (leagueUpdateError) {
    redirect(
      `/admin/reset-draft?error=${encodeURIComponent(
        `League update failed: ${leagueUpdateError.message}`,
      )}`,
    );
  }

  const { error: teamsError } = await svc
    .from("teams")
    .update({ draft_position: null })
    .eq("league_id", leagueId);
  if (teamsError) {
    redirect(
      `/admin/reset-draft?error=${encodeURIComponent(
        `Team reset failed: ${teamsError.message}`,
      )}`,
    );
  }

  // Blow through every read cache that could show stale draft state.
  revalidatePath("/admin/reset-draft");
  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/leagues/${leagueId}/draft`);
  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath("/dashboard");

  redirect(
    `/admin/reset-draft?success=${encodeURIComponent(
      `Reset "${leagueRow.name}". Removed ${pickCount ?? 0} pick${
        pickCount === 1 ? "" : "s"
      }.`,
    )}`,
  );
}

export default async function OwnerResetDraftPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) redirect("/dashboard");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const leagueCtx = await getCurrentLeagueContext(user.id);

  // Find every league this user has a team in, then hydrate with
  // commissioner display name and live pick/team counts.
  const svc = createServiceClient();

  const { data: myTeams } = await svc
    .from("teams")
    .select("league_id")
    .eq("owner_id", user.id);
  const leagueIds = Array.from(
    new Set(((myTeams ?? []) as { league_id: string }[]).map((t) => t.league_id)),
  );

  let leagues: LeagueRow[] = [];
  if (leagueIds.length > 0) {
    const { data: leagueRows } = await svc
      .from("leagues")
      .select("id, name, draft_status, commissioner_id, roster_size")
      .in("id", leagueIds)
      .order("name");

    const typedLeagueRows = (leagueRows ?? []) as Array<{
      id: string;
      name: string;
      draft_status: DraftStatus;
      commissioner_id: string;
      roster_size: number;
    }>;

    const commissionerIds = Array.from(
      new Set(typedLeagueRows.map((l) => l.commissioner_id)),
    );
    const { data: commishProfiles } = await svc
      .from("profiles")
      .select("id, display_name")
      .in("id", commissionerIds);
    const commishById = new Map(
      ((commishProfiles ?? []) as Array<{ id: string; display_name: string | null }>).map(
        (p) => [p.id, p.display_name],
      ),
    );

    // Fetch pick counts + team counts in parallel for all leagues.
    const counts = await Promise.all(
      typedLeagueRows.map(async (l) => {
        const [{ count: pickCount }, { count: teamCount }] = await Promise.all([
          svc
            .from("draft_picks")
            .select("id", { count: "exact", head: true })
            .eq("league_id", l.id),
          svc
            .from("teams")
            .select("id", { count: "exact", head: true })
            .eq("league_id", l.id),
        ]);
        return { id: l.id, pickCount: pickCount ?? 0, teamCount: teamCount ?? 0 };
      }),
    );
    const countsById = new Map(counts.map((c) => [c.id, c]));

    leagues = typedLeagueRows.map((l) => ({
      ...l,
      commissioner_display_name: commishById.get(l.commissioner_id) ?? null,
      pick_count: countsById.get(l.id)?.pickCount ?? 0,
      team_count: countsById.get(l.id)?.teamCount ?? 0,
    }));
  }

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueCtx.leagueId}
        draftStatus={leagueCtx.draftStatus}
        isCommissioner={leagueCtx.isCommissioner}
        isOwner
      />
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-ice-400 hover:underline"
          >
            ← Dashboard
          </Link>
          <h1 className="my-2 text-2xl font-bold text-ice-50 sm:text-3xl">
            Reset draft
          </h1>
          <p className="text-sm text-ice-300">
            App-owner override. Wipes every pick in the selected league
            and flips it back to the pre-draft pending state — same as
            the commissioner&rsquo;s reset tool, but available in any
            league you&rsquo;re a member of. The commissioner can
            re-start the draft afterwards as usual.
          </p>
        </div>

        {success && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-300">
            ✅ {success}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            ❌ {error}
          </div>
        )}

        {leagues.length === 0 && (
          <Card>
            <CardContent className="py-6 text-sm text-ice-300">
              You don&rsquo;t have a team in any league yet. Join or
              create one first, then come back here.
            </CardContent>
          </Card>
        )}

        {leagues.map((l) => (
          <Card key={l.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
                <span>{l.name}</span>
                <span className="text-xs font-normal text-ice-400">
                  {l.draft_status.replace("_", " ")}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-ice-400">
                Commissioner:{" "}
                <span className="text-ice-200">
                  {l.commissioner_display_name ?? "—"}
                </span>
                <span className="mx-2 text-ice-600">·</span>
                {l.team_count} team{l.team_count === 1 ? "" : "s"}
                <span className="mx-2 text-ice-600">·</span>
                {l.pick_count} pick{l.pick_count === 1 ? "" : "s"} made
              </div>

              <form
                action={resetDraftAsOwnerAction}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="league_id" value={l.id} />
                <div className="flex-1 min-w-[140px]">
                  <label className="mb-1 block text-[11px] uppercase tracking-wide text-ice-400">
                    Type <span className="font-mono">RESET</span> to confirm
                  </label>
                  <Input
                    type="text"
                    name="confirm"
                    placeholder="RESET"
                    autoComplete="off"
                    required
                  />
                </div>
                <Button type="submit" variant="danger">
                  Reset draft
                </Button>
              </form>

              <div className="flex gap-3 text-xs">
                <Link
                  href={`/leagues/${l.id}`}
                  className="text-ice-400 hover:underline"
                >
                  View standings
                </Link>
                <Link
                  href={`/leagues/${l.id}/draft`}
                  className="text-ice-400 hover:underline"
                >
                  Draft room
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </main>
    </>
  );
}
