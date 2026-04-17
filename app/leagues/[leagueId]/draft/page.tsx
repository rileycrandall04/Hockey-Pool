import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLeagueForMember } from "@/lib/league-access";
import { isAppOwner } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { DraftRoom } from "@/components/draft-room";
import type { League, Team } from "@/lib/types";

export default async function DraftPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const league = await getLeagueForMember(supabase, leagueId, user.id);
  if (!league) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const { data: teams } = await supabase
    .from("teams")
    .select("*")
    .eq("league_id", leagueId)
    .order("draft_position", { ascending: true, nullsFirst: false });

  const isCommissioner = league.commissioner_id === user.id;

  // Read the VAPID public key server-side and hand it to the client
  // component as a prop. This is intentionally NOT read from
  // process.env inside the client component — doing that would
  // inline the value at `next build` time, meaning an existing build
  // never picks up a newly-added env var until the project is
  // rebuilt with build cache disabled. Reading on the server means
  // a new deploy or even a new request picks up the current value.
  const vapidPublicKey =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
    process.env.VAPID_PUBLIC_KEY ??
    null;

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={isCommissioner}
        isOwner={isAppOwner(user.email)}
      />
      <main className="mx-auto max-w-6xl px-2 py-6 sm:px-4">
        <DraftRoom
          league={league}
          teams={(teams ?? []) as Team[]}
          currentUserId={user.id}
          isCommissioner={isCommissioner}
          vapidPublicKey={vapidPublicKey}
        />
      </main>
    </>
  );
}
