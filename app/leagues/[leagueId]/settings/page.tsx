import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { League } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LeagueSettingsPage({
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

  const isCommissioner = league.commissioner_id === user.id;

  const { data: commissionerProfile } = await supabase
    .from("profiles")
    .select("display_name, email")
    .eq("id", league.commissioner_id)
    .single();

  const benchSlots = league.roster_size - league.scoring_roster_size;

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={isCommissioner}
        isOwner={isAppOwner(user.email)}
      />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-bold text-ice-50 sm:text-3xl">
          League settings
        </h1>

        <Card>
          <CardHeader>
            <CardTitle>League info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <Setting label="League name" value={league.name} />
              <Setting label="Season" value={league.season} />
              <Setting label="Join code" value={league.join_code} mono />
              <Setting
                label="Commissioner"
                value={commissionerProfile?.display_name ?? "—"}
              />
              <Setting
                label="Draft status"
                value={league.draft_status.replace("_", " ")}
              />
              <Setting label="Draft type" value={league.draft_type} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Roster rules</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <Setting
                label="Roster size"
                value={`${league.roster_size} players`}
              />
              <Setting
                label="Scoring roster"
                value={`Top ${league.scoring_roster_size}`}
              />
              <Setting
                label="Bench slots"
                value={`${benchSlots} player${benchSlots === 1 ? "" : "s"}`}
              />
              <Setting
                label="Required defensemen"
                value={`${league.required_defensemen} in scoring lineup`}
              />
            </dl>
            <p className="mt-4 text-xs text-ice-400">
              Each team drafts {league.roster_size} players. The
              top {league.scoring_roster_size} by pool points count
              toward the team score, with at
              least {league.required_defensemen} defensemen required in
              the scoring lineup. The
              remaining {benchSlots} sit on the bench and don&rsquo;t
              count.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scoring system</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border border-puck-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-puck-border bg-puck-bg text-left text-ice-400">
                    <th className="px-4 py-2">Stat</th>
                    <th className="px-4 py-2 text-right">Points</th>
                  </tr>
                </thead>
                <tbody className="text-ice-100">
                  <tr className="border-b border-puck-border">
                    <td className="px-4 py-2">Goal</td>
                    <td className="px-4 py-2 text-right font-mono">1</td>
                  </tr>
                  <tr className="border-b border-puck-border">
                    <td className="px-4 py-2">Assist</td>
                    <td className="px-4 py-2 text-right font-mono">1</td>
                  </tr>
                  <tr className="border-b border-puck-border">
                    <td className="px-4 py-2">
                      Overtime goal bonus
                    </td>
                    <td className="px-4 py-2 text-right font-mono">+2</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 text-ice-300">
                      OT goal total value
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-ice-50">
                      3
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-ice-400">
              Pool points = Goals + Assists + (OT Goals &times; 2). An
              overtime goal is also counted as a regular goal, so it&rsquo;s
              worth 3 total points (1 for the goal + 2 bonus).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Draft format</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-ice-300">
            <p>
              <span className="font-semibold text-ice-100">Snake draft</span>{" "}
              &mdash; the pick order reverses every round. In a 4-team
              league, the team picking 1st in round 1 picks 4th in
              round 2, 1st again in round 3, and so on.
            </p>
            <p>
              <span className="font-semibold text-ice-100">
                {league.roster_size} rounds
              </span>{" "}
              &mdash; one pick per round per team until every roster
              is full.
            </p>
            {league.draft_type === "auto" && (
              <p>
                <span className="font-semibold text-ice-100">Auto-draft</span>{" "}
                &mdash; each pick is automatically assigned to the best
                available player by regular-season points.
              </p>
            )}
            {league.draft_type === "manual" && (
              <p>
                <span className="font-semibold text-ice-100">Manual draft</span>{" "}
                &mdash; each team owner picks their own player when
                they&rsquo;re on the clock. The commissioner can
                auto-pick for AFK players.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}

function Setting({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-ice-400">
        {label}
      </dt>
      <dd
        className={
          "mt-0.5 text-ice-100 " + (mono ? "font-mono" : "")
        }
      >
        {value}
      </dd>
    </div>
  );
}
