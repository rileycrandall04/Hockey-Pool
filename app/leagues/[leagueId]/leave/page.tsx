import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getLeagueForMember } from "@/lib/league-access";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { League, Team } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Dedicated "leave league" confirmation page.
 *
 * Linked from:
 *   - The Leave league entry in the NavBar dropdown (commissioner
 *     users don't see that entry).
 *   - The dashboard kebab menu on each non-commissioned league row.
 *
 * Previously the form lived at the bottom of the standings page but
 * it wasn't discoverable and cluttered the main scoreboard view.
 * Moving it here keeps the destructive action off the common
 * surfaces but still one tap away via the menu.
 */

async function leaveLeagueAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const confirm = String(formData.get("confirm") ?? "").trim();

  if (confirm !== "LEAVE") {
    redirect(
      `/leagues/${leagueId}/leave?leave_error=${encodeURIComponent("Type LEAVE to confirm.")}`,
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const svc = createServiceClient();
  const { data: league } = await svc
    .from("leagues")
    .select("commissioner_id, draft_status")
    .eq("id", leagueId)
    .single();

  if (!league) {
    redirect(
      `/dashboard?leave_error=${encodeURIComponent("League not found.")}`,
    );
  }

  if (league.commissioner_id === user.id) {
    redirect(
      `/leagues/${leagueId}/leave?leave_error=${encodeURIComponent(
        "Commissioners must delete the league instead of leaving.",
      )}`,
    );
  }

  if (league.draft_status === "in_progress") {
    redirect(
      `/leagues/${leagueId}/leave?leave_error=${encodeURIComponent(
        "Cannot leave during an active draft. Wait for the draft to finish or ask the commissioner to reset it.",
      )}`,
    );
  }

  const { error } = await svc
    .from("teams")
    .delete()
    .eq("league_id", leagueId)
    .eq("owner_id", user.id);

  if (error) {
    redirect(
      `/leagues/${leagueId}/leave?leave_error=${encodeURIComponent(error.message)}`,
    );
  }

  redirect(
    `/dashboard?left=${encodeURIComponent("You left the league. Your players are back in the draft pool.")}`,
  );
}

export default async function LeaveLeaguePage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ leave_error?: string }>;
}) {
  const { leagueId } = await params;
  const { leave_error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const league = await getLeagueForMember(supabase, leagueId, user.id);
  if (!league) notFound();

  // Commissioners don't belong on this page — bounce them at the admin
  // page's delete-league section instead.
  if (league.commissioner_id === user.id) {
    redirect(`/leagues/${leagueId}/admin#delete-league`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  // Pull the user's team in this league so the confirmation message
  // can name it explicitly ("Removes Gordie's Ghosts...").
  const { data: team } = await supabase
    .from("teams")
    .select("*")
    .eq("league_id", leagueId)
    .eq("owner_id", user.id)
    .maybeSingle<Team>();

  if (!team) {
    // Not a commissioner AND not a team owner — RLS should've blocked
    // them getting this far, but fall back to the league page.
    redirect(`/leagues/${leagueId}`);
  }

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={false}
      />
      <main className="mx-auto max-w-xl px-4 py-8">
        <Link
          href={`/leagues/${leagueId}`}
          className="text-sm text-ice-400 hover:underline"
        >
          ← {league.name}
        </Link>
        <Card className="mt-4 border-red-500/30 bg-red-500/5">
          <CardHeader>
            <CardTitle className="text-red-300">Leave league</CardTitle>
            <CardDescription>
              Removes <strong>{team.name}</strong> from {league.name}.
              Other teams stay exactly as they are. Any players you
              drafted go back into the pool. Allowed before the draft
              starts and after it&rsquo;s complete — not during an
              active draft.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {leave_error && (
              <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                ❌ {leave_error}
              </div>
            )}
            <form
              action={leaveLeagueAction}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="league_id" value={leagueId} />
              <div className="space-y-1">
                <Label htmlFor="leave_confirm">
                  Type <span className="font-mono">LEAVE</span> to confirm
                </Label>
                <Input
                  id="leave_confirm"
                  name="confirm"
                  placeholder="LEAVE"
                  className="max-w-[180px] font-mono"
                />
              </div>
              <Button
                type="submit"
                variant="danger"
                disabled={league.draft_status === "in_progress"}
              >
                Leave league
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
