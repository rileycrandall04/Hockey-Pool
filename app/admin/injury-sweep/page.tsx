import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { getCurrentLeagueContext } from "@/lib/current-league";
import { NavBar } from "@/components/nav-bar";
import { InjurySweepRunner } from "@/components/injury-sweep-runner";

export const dynamic = "force-dynamic";

/**
 * App-owner only page that drives a multi-iteration injury sweep
 * across the entire active player pool. The single-shot
 * /api/admin/sync-injuries endpoint can only check ~40 players per
 * call (NHL API rate limit + 60s function budget), so this page
 * loops it from the browser until every player has been refreshed
 * since the sweep started.
 *
 * Server-rendered shell + a client component (<InjurySweepRunner>)
 * that does the actual fetch loop.
 */
export default async function InjurySweepPage() {
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

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueCtx.leagueId}
        draftStatus={leagueCtx.draftStatus}
        isCommissioner={leagueCtx.isCommissioner}
        isOwner
      />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/dashboard"
          className="text-sm text-ice-400 hover:underline"
        >
          ← Dashboard
        </Link>
        <h1 className="my-3 text-2xl font-bold text-ice-50 sm:text-3xl">
          Injury sweep
        </h1>
        <p className="mb-6 text-sm text-ice-300">
          Cycle through every active player in the pool to refresh
          injury status from the NHL public API in a single pass. The
          normal nightly cron only checks 40 players per run; this
          page repeatedly hits the same endpoint from the browser
          until everyone&rsquo;s been touched.
        </p>
        <InjurySweepRunner />
      </main>
    </>
  );
}
