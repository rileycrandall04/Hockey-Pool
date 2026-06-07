import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { isAppOwner } from "@/lib/auth";
import Link from "next/link";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SyncButton } from "@/components/sync-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

async function addAdminAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const user = await getUser();
  if (!user || !isAppOwner(user.email)) redirect(`/leagues/${leagueId}/admin?error=Owner+only`);

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (!profile) {
    redirect(`/leagues/${leagueId}/admin?error=${encodeURIComponent("No user with that email has signed up yet")}`);
  }
  await svc.from("app_admins").upsert({ user_id: profile.id, added_by: user.id }, { onConflict: "user_id" });
  revalidatePath(`/leagues/${leagueId}/admin`);
  redirect(`/leagues/${leagueId}/admin`);
}

async function removeAdminAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  const user = await getUser();
  if (!user || !isAppOwner(user.email)) redirect(`/leagues/${leagueId}/admin?error=Owner+only`);
  const svc = createServiceClient();
  await svc.from("app_admins").delete().eq("user_id", userId);
  revalidatePath(`/leagues/${leagueId}/admin`);
  redirect(`/leagues/${leagueId}/admin`);
}

async function resetDraftAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const user = await getUser();
  if (!user) redirect("/login");

  const svc = createServiceClient();
  const { data: league } = await svc
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) {
    redirect(`/leagues/${leagueId}/admin?error=Commissioner+only`);
  }

  await svc.from("draft_picks").delete().eq("league_id", leagueId);
  await svc
    .from("leagues")
    .update({ draft_status: "pending", draft_current_team: null, draft_round: 1 })
    .eq("id", leagueId);
  await svc.from("teams").update({ draft_position: null }).eq("league_id", leagueId);

  revalidatePath(`/leagues/${leagueId}/admin`);
  redirect(`/leagues/${leagueId}/draft`);
}

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { leagueId } = await params;
  const { error } = await searchParams;
  const user = await getUser();
  if (!user) redirect("/login");

  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");
  if (!access.isCommissioner) redirect(`/leagues/${leagueId}`);

  const { league, teams, displayName } = access;
  const svc = createServiceClient();
  const isOwner = isAppOwner(user.email);

  // Current app-admins (owner-only section).
  let adminList: Array<{ user_id: string; name: string; email: string | null }> = [];
  if (isOwner) {
    const { data: admins } = await svc.from("app_admins").select("user_id");
    const ids = (admins ?? []).map((a) => a.user_id as string);
    if (ids.length > 0) {
      const { data: profiles } = await svc.from("profiles").select("id, display_name, email").in("id", ids);
      adminList = (profiles ?? []).map((p) => ({
        user_id: p.id as string,
        name: (p.display_name as string) ?? "Player",
        email: (p.email as string) ?? null,
      }));
    }
  }

  return (
    <>
      <NavBar
        displayName={displayName}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner
      />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold text-ice-50">Commissioner tools</h1>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>League</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-ice-200">
            <p>
              Join code:{" "}
              <span className="font-mono font-semibold text-ice-50">{league.join_code}</span>
            </p>
            <p>Draft status: {league.draft_status.replace("_", " ")}</p>
            <p>Teams: {teams.length} · Roster size: {league.roster_size}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Match results &amp; data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-ice-400">
              Pull fixtures, scores and the Golden Boot race from API-Football
              (needs <code>API_FOOTBALL_KEY</code> set; app-owner only), or
              enter/correct results by hand. Manual edits lock a match so the
              sync won&rsquo;t overwrite it.
            </p>
            <SyncButton />
            <div className="flex flex-wrap gap-3 pt-1 text-sm">
              <Link href={`/leagues/${leagueId}/admin/matches`} className="text-ice-400 hover:underline">
                ✏️ Edit match results
              </Link>
              <Link href={`/leagues/${leagueId}/schedule`} className="text-ice-400 hover:underline">
                🥅 Enter goals (via a game)
              </Link>
              <Link href={`/leagues/${leagueId}/golden-boot`} className="text-ice-400 hover:underline">
                ⚽ Golden Boot race
              </Link>
            </div>
          </CardContent>
        </Card>

        {isOwner && (
          <Card>
            <CardHeader>
              <CardTitle>App admins</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-ice-400">
                Admins can enter goals and edit match data across the whole
                pool. Add someone by the email they signed up with.
              </p>
              <form action={addAdminAction} className="flex items-end gap-2">
                <input type="hidden" name="league_id" value={leagueId} />
                <Input name="email" type="email" placeholder="friend@example.com" required className="max-w-xs" />
                <Button type="submit">Add admin</Button>
              </form>
              {adminList.length > 0 && (
                <ul className="space-y-1">
                  {adminList.map((a) => (
                    <li key={a.user_id} className="flex items-center justify-between rounded border border-puck-border bg-puck-bg px-3 py-1.5 text-sm">
                      <span className="text-ice-100">{a.name} <span className="text-xs text-ice-500">{a.email}</span></span>
                      <form action={removeAdminAction} className="inline">
                        <input type="hidden" name="league_id" value={leagueId} />
                        <input type="hidden" name="user_id" value={a.user_id} />
                        <button type="submit" className="text-xs text-red-400 hover:underline">remove</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Reset draft</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-ice-400">
              Deletes every pick, clears the draft order, and returns the
              league to the pre-draft lobby. Use this to re-run a test draft.
            </p>
            <form action={resetDraftAction}>
              <input type="hidden" name="league_id" value={leagueId} />
              <Button type="submit" variant="danger">
                Reset draft
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
