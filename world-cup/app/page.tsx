import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Logged-in users skip the marketing landing. Send them to their
  // last-visited league, else the most recent one, else the dashboard.
  if (user) {
    const svc = createServiceClient();
    const [{ data: myTeams }, { data: myCommLeagues }] = await Promise.all([
      svc.from("teams").select("league_id").eq("owner_id", user.id),
      svc.from("leagues").select("id").eq("commissioner_id", user.id),
    ]);

    const leagueIds = new Set<string>();
    for (const t of myTeams ?? []) leagueIds.add(t.league_id as string);
    for (const l of myCommLeagues ?? []) leagueIds.add(l.id as string);

    if (leagueIds.size === 0) redirect("/dashboard");

    const cookieStore = await cookies();
    const cookieLeagueId = cookieStore.get("current_league_id")?.value;
    if (cookieLeagueId && leagueIds.has(cookieLeagueId)) {
      redirect(`/leagues/${cookieLeagueId}`);
    }

    const { data: recent } = await svc
      .from("leagues")
      .select("id")
      .in("id", [...leagueIds])
      .order("created_at", { ascending: false })
      .limit(1);
    if (recent && recent.length > 0) redirect(`/leagues/${recent[0].id}`);

    redirect("/dashboard");
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <div className="mb-12 flex items-center justify-between">
        <div className="text-xl font-semibold tracking-tight text-ice-50">
          🌍 World Cup Pool
        </div>
        <div className="flex gap-2">
          <Link href="/login">
            <Button variant="secondary" size="sm">
              Log in
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Sign up</Button>
          </Link>
        </div>
      </div>

      <section className="mb-16">
        <h1 className="mb-4 text-5xl font-bold tracking-tight text-ice-50">
          Draft the world. Win the pool.
        </h1>
        <p className="max-w-2xl text-lg text-ice-300">
          Run a real-time 2026 FIFA World Cup pool with your friends. Snake-
          draft the entire 48-team field — four countries each — and score
          every match from the group stage through the final, with upset
          bonuses, clean sheets, a Golden Boot race, and advancement payouts.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/signup">
            <Button size="lg">Create an account</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="secondary">
              I already have one
            </Button>
          </Link>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <Feature
          title="Snake draft"
          body="12 owners, four countries apiece — the full 48-team field, drafted live."
        />
        <Feature
          title="Match-by-match scoring"
          body="Wins, goals ±, clean sheets, group-stage upsets, shootouts and advancement bonuses."
        />
        <Feature
          title="Live updates"
          body="Results and the Golden Boot race pull from API-Football, with commissioner overrides."
        />
      </section>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-puck-border bg-puck-card p-5">
      <div className="mb-2 text-lg font-semibold text-ice-50">{title}</div>
      <div className="text-sm text-ice-300">{body}</div>
    </div>
  );
}
