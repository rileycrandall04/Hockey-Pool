import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <div className="mb-12 flex items-center justify-between">
        <div className="text-xl font-semibold tracking-tight text-ice-50">
          🏒 Stanley Cup Pool
        </div>
        <div className="flex gap-2">
          {user ? (
            <Link href="/dashboard">
              <Button size="sm">Dashboard</Button>
            </Link>
          ) : (
            <>
              <Link href="/login">
                <Button variant="secondary" size="sm">
                  Log in
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Sign up</Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <section className="mb-16">
        <h1 className="mb-4 text-5xl font-bold tracking-tight text-ice-50">
          Draft, watch, and win the Cup.
        </h1>
        <p className="max-w-2xl text-lg text-ice-300">
          Run a real-time Stanley Cup playoff pool with your friends. Draft
          12 players per team from the 16 qualifying clubs, score the top 10
          nightly (with 2 defensemen required), and let the app pull stats
          from the NHL every night at 4am.
        </p>
        <div className="mt-8 flex gap-3">
          {user ? (
            <Link href="/dashboard">
              <Button size="lg">Go to dashboard</Button>
            </Link>
          ) : (
            <>
              <Link href="/signup">
                <Button size="lg">Create an account</Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="secondary">
                  I already have one
                </Button>
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <Feature
          title="Snake draft"
          body="Manual or auto-pick, real-time draft board, and fair snake ordering."
        />
        <Feature
          title="Smart scoring"
          body="Goals + assists, OT goals worth 3, top 10 of 12 count — with 2 D required."
        />
        <Feature
          title="Nightly updates"
          body="Pulls finalized NHL games each night at 4am so standings stay fresh."
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
