import { redirect } from "next/navigation";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { NavBar } from "@/components/nav-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  WIN_POINTS, DRAW_POINTS, LOSS_POINTS, GOAL_FOR_POINTS, GOAL_AGAINST_POINTS,
  CLEAN_SHEET_POINTS, UPSET_POINTS, SHOOTOUT_WIN_BONUS, SHOOTOUT_LOSS_BONUS,
  GOLDEN_BOOT_POINTS, ADVANCEMENT_POINTS, CHAMPION_POINTS,
} from "@/lib/scoring";
import { fmtPoints } from "@/lib/utils";

export const dynamic = "force-dynamic";

function sign(n: number): string {
  return n > 0 ? `+${fmtPoints(n)}` : fmtPoints(n);
}

export default async function RulesPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");
  const { league, isCommissioner, displayName } = access;

  return (
    <>
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner={isCommissioner} />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold text-ice-50">Scoring rules</h1>
          <p className="text-sm text-ice-300">
            You draft 4 countries. Your score is the sum of all the points
            your countries earn across the whole World Cup.
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle>Every match</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-ice-400">Each of your countries earns these in every match it plays — group stage and knockouts.</p>
            <RuleTable rows={[
              ["Win", sign(WIN_POINTS)],
              ["Draw", sign(DRAW_POINTS)],
              ["Loss", sign(LOSS_POINTS)],
              ["Each goal scored", sign(GOAL_FOR_POINTS)],
              ["Each goal conceded", sign(GOAL_AGAINST_POINTS)],
              ["Clean sheet (concede 0)", sign(CLEAN_SHEET_POINTS)],
            ]} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Group-stage upset</CardTitle></CardHeader>
          <CardContent className="text-sm text-ice-200">
            <p className="mb-2">
              <span className="font-semibold text-ice-50">{sign(UPSET_POINTS)}</span> when your
              country wins a <span className="font-semibold">group-stage</span> match against an
              opponent ranked higher (better FIFA rank at kickoff).
            </p>
            <p className="text-xs text-ice-400">Wins only — a draw isn&rsquo;t an upset. Knockout games don&rsquo;t pay an upset bonus.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Knockout shootouts</CardTitle></CardHeader>
          <CardContent className="text-sm text-ice-200">
            <p className="mb-1">A shootout counts as a draw after 120&rsquo; (both get {sign(DRAW_POINTS)}), then:</p>
            <RuleTable rows={[
              ["Win the shootout", `${sign(SHOOTOUT_WIN_BONUS)} (→ ${fmtPoints(DRAW_POINTS + SHOOTOUT_WIN_BONUS)} total)`],
              ["Lose the shootout", `${sign(SHOOTOUT_LOSS_BONUS)} (→ ${fmtPoints(DRAW_POINTS + SHOOTOUT_LOSS_BONUS)} total)`],
            ]} />
            <p className="mt-2 text-xs text-ice-400">Penalty-kick goals in a shootout don&rsquo;t count as goals.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Advancement bonuses</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-ice-400">One-time, the moment your country reaches each round.</p>
            <RuleTable rows={[
              ["Reach the Round of 32", sign(ADVANCEMENT_POINTS.r32)],
              ["Reach the Round of 16", sign(ADVANCEMENT_POINTS.r16)],
              ["Reach the Quarterfinal", sign(ADVANCEMENT_POINTS.qf)],
              ["Reach the Semifinal", sign(ADVANCEMENT_POINTS.sf)],
              ["Reach the Final", sign(ADVANCEMENT_POINTS.final)],
              ["Win the World Cup", sign(CHAMPION_POINTS)],
            ]} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Golden Boot</CardTitle></CardHeader>
          <CardContent className="text-sm text-ice-200">
            <span className="font-semibold text-ice-50">{sign(GOLDEN_BOOT_POINTS)}</span> to the
            owner of the country whose player wins the Golden Boot (most goals; ties broken by
            assists, then fewer minutes).
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Tiebreakers</CardTitle></CardHeader>
          <CardContent className="text-sm text-ice-200">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Total points</li>
              <li>Total goals scored by your countries</li>
              <li>Your furthest-advancing country</li>
              <li>Closest pre-draft over/under guess to your final total</li>
            </ol>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

function RuleTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([label, val]) => (
          <tr key={label} className="border-t border-puck-border first:border-t-0">
            <td className="py-1.5 text-ice-200">{label}</td>
            <td className="py-1.5 text-right font-semibold text-ice-50">{val}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
