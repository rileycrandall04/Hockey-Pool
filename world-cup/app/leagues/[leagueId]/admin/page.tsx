import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

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
