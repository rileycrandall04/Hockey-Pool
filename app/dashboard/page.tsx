import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RowMenu } from "@/components/row-menu";
import type { League, Team } from "@/lib/types";

type LeagueWithTeam = League & { team: Team | null };

/**
 * Server action that flips draft stall alerts on/off for the
 * current user + a given league. Used by the 🔔/🔕 button on each
 * league row — action=watch inserts, action=unwatch deletes.
 *
 * The insert goes through the regular supabase client (authenticated
 * session) so the RLS policy added in migration 0009 enforces that
 * users can only write their own rows.
 */
async function toggleDraftWatchAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const action = String(formData.get("action") ?? "");
  if (!leagueId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (action === "watch") {
    await supabase
      .from("draft_watches")
      .upsert(
        {
          user_id: user.id,
          league_id: leagueId,
          stale_minutes: 15,
        },
        { onConflict: "user_id,league_id" },
      );
  } else if (action === "unwatch") {
    await supabase
      .from("draft_watches")
      .delete()
      .eq("user_id", user.id)
      .eq("league_id", leagueId);
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    seeded?: string;
    seed_error?: string;
    seed_warning?: string;
    sync_errors?: string;
    left?: string;
    league_deleted?: string;
  }>;
}) {
  const {
    seeded,
    seed_error,
    seed_warning,
    sync_errors,
    left,
    league_deleted,
  } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const canRefreshNhlData = isAppOwner(user.email);

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

  // First-run setup: is the player pool seeded yet? If not, and the
  // user happens to be the app owner, show the one-tap seed banner.
  const { count: playerCount } = await supabase
    .from("players")
    .select("id", { count: "exact", head: true });
  const poolEmpty = (playerCount ?? 0) === 0;

  // Which of the user's leagues are they already watching for draft
  // stalls? Powers the 🔔/🔕 toggle next to each league row below.
  const { data: watchRows } = await supabase
    .from("draft_watches")
    .select("league_id")
    .eq("user_id", user.id);
  const watchedLeagueIds = new Set(
    (watchRows ?? []).map((r) => r.league_id as string),
  );

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        isOwner={canRefreshNhlData}
      />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Flash banners */}
        {seeded && (
          <div className="mb-4 rounded-md border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-200">
            ✅ Player pool seeded: {seeded}. You&rsquo;re ready to draft.
          </div>
        )}
        {seed_warning && (
          <div className="mb-4 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
            ⚠️ {seed_warning}
          </div>
        )}
        {sync_errors && (
          <div className="mb-4 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-200">
            <div className="mb-1 font-semibold uppercase tracking-wider text-yellow-300">
              Sample sync errors
            </div>
            <ul className="list-disc space-y-0.5 pl-4 font-mono">
              {sync_errors.split(" || ").map((msg, i) => (
                <li key={i} className="break-all">
                  {msg}
                </li>
              ))}
            </ul>
          </div>
        )}
        {seed_error && (
          <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            ❌ Seed failed: {seed_error}
          </div>
        )}
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

        {/* First-run seed banner — app owner only. Kept here because
            until the pool exists, nothing else in the app is useful. */}
        {poolEmpty && !seeded && canRefreshNhlData && (
          <Card className="mb-4 border-ice-500/60 bg-ice-500/5">
            <CardHeader>
              <CardTitle>One-time setup: seed the player pool</CardTitle>
              <CardDescription>
                The NHL player pool is empty. Tap below to fetch every
                current NHL team roster from the league&rsquo;s public
                API (~30–45 seconds). One time, then the nightly cron
                takes over.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action="/api/admin/seed" method="post">
                <Button type="submit">Seed player pool</Button>
              </form>
            </CardContent>
          </Card>
        )}
        {poolEmpty && !seeded && !canRefreshNhlData && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Waiting for setup</CardTitle>
              <CardDescription>
                The NHL player pool hasn&rsquo;t been seeded yet. The
                app owner needs to do this once before drafts can run.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <h1 className="mb-4 text-2xl font-bold text-ice-50">Your leagues</h1>

        {leagues.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-ice-300">
              You&rsquo;re not in any leagues yet.{" "}
              <span className="block text-xs text-ice-500">
                Open the menu (top-left) to create or join one.
              </span>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {leagues.map((l) => {
              const isCommish = l.commissioner_id === user.id;
              const hasAction = isCommish || Boolean(l.team);
              const watching = watchedLeagueIds.has(l.id);
              // Alerts are only meaningful before a draft finishes.
              const canWatch =
                l.draft_status === "pending" ||
                l.draft_status === "in_progress";
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
                      Season {l.season} &middot;{" "}
                      {l.draft_status.replace("_", " ")}
                      {isCommish && " · commissioner"}
                      {watching && " · 🔔 stall alerts on"}
                    </span>
                  </Link>
                  {canWatch && (
                    <form
                      action={toggleDraftWatchAction}
                      className="flex-shrink-0"
                    >
                      <input type="hidden" name="league_id" value={l.id} />
                      <input
                        type="hidden"
                        name="action"
                        value={watching ? "unwatch" : "watch"}
                      />
                      <button
                        type="submit"
                        title={
                          watching
                            ? "Stop draft stall alerts for this league"
                            : "Get a push notification when a team has been on the clock for 15+ min"
                        }
                        aria-label={
                          watching
                            ? "Unwatch draft stalls"
                            : "Watch draft stalls"
                        }
                        className={
                          "flex h-9 w-9 items-center justify-center rounded-md border text-base transition-colors " +
                          (watching
                            ? "border-ice-400 bg-ice-500/20 text-ice-50 hover:bg-ice-500/30"
                            : "border-puck-border bg-puck-bg text-ice-400 hover:bg-puck-border hover:text-ice-100")
                        }
                      >
                        {watching ? "🔔" : "🔕"}
                      </button>
                    </form>
                  )}
                  {hasAction && (
                    <div className="flex-shrink-0 pr-2">
                      <RowMenu>
                        {isCommish ? (
                          <Link
                            href={`/leagues/${l.id}/admin#delete-league`}
                            role="menuitem"
                            className="block rounded px-3 py-2 text-sm text-red-300 hover:bg-puck-border"
                          >
                            Delete league
                          </Link>
                        ) : (
                          l.team && (
                            <Link
                              href={`/leagues/${l.id}/leave`}
                              role="menuitem"
                              className="block rounded px-3 py-2 text-sm text-red-300 hover:bg-puck-border"
                            >
                              Leave league
                            </Link>
                          )
                        )}
                      </RowMenu>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {leagues.length > 0 && (
          <p className="mt-3 text-[11px] text-ice-500">
            Tap the bell next to a league to get a push notification when
            a team has been on the clock for 15+ minutes. You must have
            push enabled (tap <strong>Enable notifications</strong> once
            from the draft room on each device).
          </p>
        )}
      </main>
    </>
  );
}
