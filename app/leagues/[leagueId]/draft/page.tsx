import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single<League>();
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

  return (
    <>
      <NavBar displayName={profile?.display_name ?? user.email ?? "Player"} />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <DraftRoom
          league={league}
          teams={(teams ?? []) as Team[]}
          currentUserId={user.id}
          isCommissioner={league.commissioner_id === user.id}
        />
      </main>
    </>
  );
}
