import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLeagueForMember } from "@/lib/league-access";
import { isAppOwner } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { PlayoffBracket } from "@/components/playoff-bracket";
import type { League, PlayoffGame, PlayoffSeries } from "@/lib/types";

/**
 * Dedicated Stanley Cup bracket page. Accessible under any league so
 * users have a natural path in from their league home, but the data
 * itself is global — every league reads the same shared
 * `playoff_series` / `playoff_games` tables refreshed by the 6am ET
 * cron. We keep the page under the league path so the NavBar keeps
 * its league-aware items (Draft, Admin, etc.) instead of reverting
 * to the global dashboard nav.
 */
export default async function LeagueBracketPage({
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

  const isCommissioner = league.commissioner_id === user.id;

  const { data: seriesRows } = await supabase
    .from("playoff_series")
    .select("*")
    .order("round", { ascending: true })
    .order("sort_order", { ascending: true });
  const { data: gameRows } = await supabase
    .from("playoff_games")
    .select("*")
    .order("start_time_utc", { ascending: true });

  const series = (seriesRows ?? []) as PlayoffSeries[];
  const games = (gameRows ?? []) as PlayoffGame[];

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={isCommissioner}
        isOwner={isAppOwner(user.email)}
      />
      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-ice-50 sm:text-3xl">
            Stanley Cup Bracket
          </h1>
          <span className="text-[10px] uppercase tracking-wider text-ice-500">
            Updates 6am ET
          </span>
        </div>
        {series.length === 0 && (
          <p className="mb-4 rounded-md border border-dashed border-puck-border bg-puck-card/60 px-3 py-2 text-xs text-ice-400">
            The bracket hasn&rsquo;t been populated yet. Matchups,
            series scores, and broadcast info will appear here after
            the next nightly sync.
          </p>
        )}
        <PlayoffBracket series={series} games={games} />
      </main>
    </>
  );
}
