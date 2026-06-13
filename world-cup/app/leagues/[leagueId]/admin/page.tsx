import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { isAppOwner } from "@/lib/auth";
import { isAppAdmin } from "@/lib/admin";
import Link from "next/link";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { SyncButton } from "@/components/sync-button";
import { ShareLink } from "@/components/share-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Country } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Apply the API's result to a conflicting match (the API was right). */
async function useApiAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const matchId = String(formData.get("match_id") ?? "");
  const user = await getUser();
  if (!user) redirect("/login");
  const svc = createServiceClient();
  if (!(await isAppAdmin(svc, user.id, user.email))) redirect(`/leagues/${leagueId}/admin?error=Admins+only`);

  const { data: c } = await svc.from("match_conflicts").select("*").eq("match_id", matchId).maybeSingle();
  if (c) {
    await svc.from("matches").update({
      home_goals: c.api_home_goals,
      away_goals: c.api_away_goals,
      went_to_shootout: c.api_went_to_shootout,
      home_pens: c.api_home_pens,
      away_pens: c.api_away_pens,
      status: "final",
      locked: false, // let the sync keep it fresh from here
      goals_synced: false, // re-pull scorers
    }).eq("id", matchId);
    await svc.from("match_conflicts").delete().eq("match_id", matchId);
  }
  revalidatePath(`/leagues/${leagueId}/admin`);
  redirect(`/leagues/${leagueId}/admin`);
}

/** Dismiss a conflict, keeping the manual (locked) result. */
async function keepManualAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const matchId = String(formData.get("match_id") ?? "");
  const user = await getUser();
  if (!user) redirect("/login");
  const svc = createServiceClient();
  if (!(await isAppAdmin(svc, user.id, user.email))) redirect(`/leagues/${leagueId}/admin?error=Admins+only`);
  await svc.from("match_conflicts").delete().eq("match_id", matchId);
  revalidatePath(`/leagues/${leagueId}/admin`);
  redirect(`/leagues/${leagueId}/admin`);
}

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

/**
 * Commissioner-only: create an account on someone's behalf (email + password)
 * and add them to the league. If the email already has an account, just adds
 * that person. Only allowed before the draft starts.
 */
async function addMemberAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const teamName = String(formData.get("team_name") ?? "").trim();
  const back = (msg: string): never => redirect(`/leagues/${leagueId}/admin?error=${encodeURIComponent(msg)}#add-member`);

  const user = await getUser();
  if (!user) redirect("/login");
  const svc = createServiceClient();
  const { data: league } = await svc
    .from("leagues")
    .select("commissioner_id, draft_status")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) back("Commissioner only");
  if (league!.draft_status !== "pending") back("Members can only be added before the draft starts");
  if (!email || !password || !teamName) back("Email, password and team name are all required");
  if (password.length < 6) back("Password must be at least 6 characters");

  // Reuse an existing account for this email, otherwise create one.
  let userId: string | null = null;
  const { data: existing } = await svc.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (existing) {
    userId = existing.id as string;
  } else {
    const { data: created, error } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: email.split("@")[0] },
    });
    const newUser = created?.user;
    if (error || !newUser) back(error?.message ?? "Could not create the account");
    userId = newUser!.id;
    await svc.from("profiles").upsert(
      { id: userId, display_name: email.split("@")[0], email },
      { onConflict: "id" },
    );
  }

  const { data: alreadyIn } = await svc
    .from("teams")
    .select("id")
    .eq("league_id", leagueId)
    .eq("owner_id", userId!)
    .maybeSingle();
  if (alreadyIn) back("That person is already in this league");

  const { error: teamErr } = await svc.from("teams").insert({ league_id: leagueId, owner_id: userId, name: teamName });
  if (teamErr) back(teamErr.message);

  revalidatePath(`/leagues/${leagueId}/admin`);
  redirect(`/leagues/${leagueId}/admin?added=${encodeURIComponent(teamName)}#add-member`);
}

/**
 * Commissioner-only: trade two drafted countries between their owners
 * (one-for-one, so every roster keeps the same size).
 */
async function swapTeamsAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const ca = Number(formData.get("country_a"));
  const cb = Number(formData.get("country_b"));
  const back = (msg: string): never => redirect(`/leagues/${leagueId}/admin?error=${encodeURIComponent(msg)}#trade`);

  const user = await getUser();
  if (!user) redirect("/login");
  const svc = createServiceClient();
  const { data: league } = await svc.from("leagues").select("commissioner_id").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) back("Commissioner only");
  if (!ca || !cb || ca === cb) back("Pick two different countries");

  const { data: pickA } = await svc.from("draft_picks").select("id, team_id").eq("league_id", leagueId).eq("country_id", ca).maybeSingle();
  const { data: pickB } = await svc.from("draft_picks").select("id, team_id").eq("league_id", leagueId).eq("country_id", cb).maybeSingle();
  if (!pickA || !pickB) back("Both countries must be drafted");
  if (pickA!.team_id === pickB!.team_id) back("Those countries already have the same owner");

  // Swap owners.
  await svc.from("draft_picks").update({ team_id: pickB!.team_id }).eq("id", pickA!.id);
  await svc.from("draft_picks").update({ team_id: pickA!.team_id }).eq("id", pickB!.id);

  revalidatePath(`/leagues/${leagueId}/admin`);
  redirect(`/leagues/${leagueId}/admin?swapped=1#trade`);
}

/** Commissioner-only: rename a team in this league (owner is unchanged). */
async function renameTeamAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const teamId = String(formData.get("team_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const back = (msg: string): never =>
    redirect(`/leagues/${leagueId}/admin?error=${encodeURIComponent(msg)}#team-names`);

  const user = await getUser();
  if (!user) redirect("/login");
  const svc = createServiceClient();
  const { data: league } = await svc.from("leagues").select("commissioner_id").eq("id", leagueId).single();
  if (!league || league.commissioner_id !== user.id) back("Commissioner only");
  if (!teamId) back("Missing team");
  if (!name) back("Team name can't be empty");
  if (name.length > 60) back("Team name is too long (60 characters max)");

  // Scope the update to this league so a commissioner can't rename foreign teams.
  const { error } = await svc.from("teams").update({ name }).eq("id", teamId).eq("league_id", leagueId);
  if (error) back(error.message);

  revalidatePath(`/leagues/${leagueId}/admin`);
  redirect(`/leagues/${leagueId}/admin?renamed=1#team-names`);
}

/** Commissioner-only: permanently delete the league (cascades teams + picks). */
async function deleteLeagueAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim().toUpperCase();
  const user = await getUser();
  if (!user) redirect("/login");

  const svc = createServiceClient();
  const { data: league } = await svc
    .from("leagues")
    .select("commissioner_id, name")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) {
    redirect(`/leagues/${leagueId}/admin?error=Commissioner+only`);
  }
  if (confirm !== "DELETE") {
    redirect(`/leagues/${leagueId}/admin?error=${encodeURIComponent('Type DELETE to confirm')}`);
  }

  // Cascades teams, draft_picks, score_adjustments, golden_boot per schema.
  await svc.from("leagues").delete().eq("id", leagueId);
  redirect(`/dashboard?league_deleted=${encodeURIComponent(`Deleted "${league.name}"`)}`);
}

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ error?: string; added?: string; swapped?: string; renamed?: string }>;
}) {
  const { leagueId } = await params;
  const { error, added, swapped, renamed } = await searchParams;
  const user = await getUser();
  if (!user) redirect("/login");

  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");
  if (!access.isCommissioner) redirect(`/leagues/${leagueId}`);

  const { league, teams, ownerNames, displayName } = access;
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

  // Open sync vs manual conflicts (global; surfaced to any league admin).
  const { data: conflictRows } = await svc
    .from("match_conflicts")
    .select("*, matches(home_country_id, away_country_id)")
    .order("updated_at", { ascending: false });
  const conflicts = conflictRows ?? [];
  let conflictCountries = new Map<number, Country>();
  if (conflicts.length > 0) {
    const { data: cs } = await svc.from("countries").select("id, name, code, flag_url");
    conflictCountries = new Map((cs ?? []).map((c) => [c.id as number, c as Country]));
  }

  // Drafted countries (for the trade tool), labelled with their current owner.
  const { data: tradePicks } = await svc
    .from("draft_picks")
    .select("country_id, team_id")
    .eq("league_id", leagueId);
  let tradeOptions: Array<{ countryId: number; label: string }> = [];
  if ((tradePicks ?? []).length > 0) {
    const { data: allC } = await svc.from("countries").select("id, name");
    const cName = new Map((allC ?? []).map((c) => [c.id as number, c.name as string]));
    const tName = new Map(teams.map((t) => [t.id, t.name]));
    tradeOptions = (tradePicks ?? [])
      .map((p) => ({
        countryId: p.country_id as number,
        label: `${cName.get(p.country_id as number) ?? "?"} — ${tName.get(p.team_id as string) ?? "?"}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
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
        {added && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
            ✅ Added {added} to the league.
          </div>
        )}
        {swapped && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
            ✅ Trade completed.
          </div>
        )}
        {renamed && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
            ✅ Team name updated.
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
            <div className="pt-2">
              <p className="mb-1 text-xs text-ice-400">
                Read-only share link — anyone with it can view this league
                without an account (they can&rsquo;t draft, guess, or change
                anything).
              </p>
              <ShareLink token={league.public_view_token} />
            </div>
          </CardContent>
        </Card>

        {teams.length > 0 && (
          <Card id="team-names" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>Team names</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="mb-1 text-xs text-ice-400">
                Rename any team in the league. Owners aren&rsquo;t changed.
              </p>
              {teams.map((t) => (
                <form key={t.id} action={renameTeamAction} className="flex items-end gap-2">
                  <input type="hidden" name="league_id" value={leagueId} />
                  <input type="hidden" name="team_id" value={t.id} />
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-ice-400">
                      {ownerNames.get(t.owner_id) ?? "Player"}
                    </label>
                    <Input name="name" defaultValue={t.name} required maxLength={60} />
                  </div>
                  <Button type="submit" size="sm" variant="secondary">Save</Button>
                </form>
              ))}
            </CardContent>
          </Card>
        )}

        {league.draft_status === "pending" && (
          <Card id="add-member" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>Add a member</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-ice-400">
                Create an account for someone and add them to the league — set
                their email and a password to share with them. If the email
                already has an account, they&rsquo;re just added. Only works
                before the draft starts.
              </p>
              <form action={addMemberAction} className="space-y-3">
                <input type="hidden" name="league_id" value={leagueId} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input name="email" type="email" placeholder="player@example.com" required autoComplete="off" />
                  <Input name="team_name" placeholder="Their team name" required />
                </div>
                <Input name="password" type="text" placeholder="Password (share with them)" required minLength={6} autoComplete="off" />
                <Button type="submit">Add member</Button>
              </form>
            </CardContent>
          </Card>
        )}

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
              <Link href={`/leagues/${leagueId}/admin/countries`} className="text-ice-400 hover:underline">
                🌍 Edit groups &amp; FIFA ranks
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

        {conflicts.length > 0 && (
          <Card className="border-yellow-500/50">
            <CardHeader>
              <CardTitle>⚠️ Sync vs manual conflicts ({conflicts.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-ice-400">
                These matches were hand-edited, but the API now reports a
                different result. Your manual value is still in effect — pick
                which source is right.
              </p>
              {conflicts.map((c) => {
                const rel = c.matches as { home_country_id: number; away_country_id: number } | { home_country_id: number; away_country_id: number }[] | null;
                const match = Array.isArray(rel) ? rel[0] : rel;
                const h = match ? conflictCountries.get(match.home_country_id) : undefined;
                const a = match ? conflictCountries.get(match.away_country_id) : undefined;
                const fmt = (hg: number | null, ag: number | null, s: boolean | null, hp: number | null, ap: number | null) =>
                  `${hg ?? "?"}–${ag ?? "?"}${s ? ` (${hp}–${ap} pens)` : ""}`;
                return (
                  <div key={c.match_id} className="rounded-md border border-puck-border bg-puck-bg p-3 text-sm">
                    <div className="mb-2 flex items-center gap-1.5 text-ice-100">
                      <Flag code={h?.code} url={h?.flag_url} /> {h?.code ?? "?"} <span className="text-ice-500">v</span> <Flag code={a?.code} url={a?.flag_url} /> {a?.code ?? "?"}
                    </div>
                    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span>Manual: <span className="font-semibold text-ice-100">{fmt(c.manual_home_goals, c.manual_away_goals, c.manual_went_to_shootout, c.manual_home_pens, c.manual_away_pens)}</span></span>
                      <span>API: <span className="font-semibold text-ice-100">{fmt(c.api_home_goals, c.api_away_goals, c.api_went_to_shootout, c.api_home_pens, c.api_away_pens)}</span></span>
                    </div>
                    <div className="flex gap-2">
                      <form action={useApiAction}>
                        <input type="hidden" name="league_id" value={leagueId} />
                        <input type="hidden" name="match_id" value={c.match_id as string} />
                        <Button type="submit" size="sm">Use API</Button>
                      </form>
                      <form action={keepManualAction}>
                        <input type="hidden" name="league_id" value={leagueId} />
                        <input type="hidden" name="match_id" value={c.match_id as string} />
                        <Button type="submit" size="sm" variant="secondary">Keep manual</Button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

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

        {tradeOptions.length >= 2 && (
          <Card id="trade" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>Trade teams</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-ice-400">
                Swap two drafted countries between their owners (one-for-one, so
                rosters stay the same size). Each option shows its current owner.
              </p>
              <form action={swapTeamsAction} className="space-y-3">
                <input type="hidden" name="league_id" value={leagueId} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-ice-400">Country A</label>
                    <Select name="country_a" defaultValue="">
                      <option value="" disabled>Pick a country…</option>
                      {tradeOptions.map((o) => (
                        <option key={o.countryId} value={o.countryId}>{o.label}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-ice-400">Country B</label>
                    <Select name="country_b" defaultValue="">
                      <option value="" disabled>Pick a country…</option>
                      {tradeOptions.map((o) => (
                        <option key={o.countryId} value={o.countryId}>{o.label}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                <Button type="submit">Swap owners</Button>
              </form>
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

        <Card id="delete-league" className="scroll-mt-20 border-red-500/40">
          <CardHeader>
            <CardTitle>Delete league</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-ice-400">
              Permanently deletes this league and every team, roster, and pick
              in it. This can&rsquo;t be undone. Type <strong>DELETE</strong> to
              confirm.
            </p>
            <form action={deleteLeagueAction} className="flex items-center gap-2">
              <input type="hidden" name="league_id" value={leagueId} />
              <Input name="confirm" placeholder="DELETE" className="max-w-[140px]" autoComplete="off" />
              <Button type="submit" variant="danger">
                Delete league
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
