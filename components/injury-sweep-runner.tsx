"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SweepStats {
  iterations: number;
  total_checked: number;
  total_flagged: number;
  total_cleared: number;
  total_unchanged: number;
  total_errors: number;
  remaining: number;
  status: "idle" | "running" | "complete" | "stopped" | "error";
  message?: string;
  sample_errors: string[];
  started_at: string | null;
}

const INITIAL: SweepStats = {
  iterations: 0,
  total_checked: 0,
  total_flagged: 0,
  total_cleared: 0,
  total_unchanged: 0,
  total_errors: 0,
  remaining: 0,
  status: "idle",
  sample_errors: [],
  started_at: null,
};

const MAX_ITERATIONS = 30;
const PAUSE_BETWEEN_RUNS_MS = 1000;

/**
 * Drives a multi-iteration sweep of /api/admin/sync-injuries from
 * the browser. Each iteration is a single ~40-second function call;
 * the loop chains them together until every active player has been
 * refreshed since the sweep started, then stops.
 *
 * Termination:
 *   - Server reports remaining === 0 (every active player has
 *     injury_updated_at >= sweep_start)
 *   - User taps "Stop sweep"
 *   - Network/HTTP error
 *   - Hit MAX_ITERATIONS (safety net for runaway sweeps)
 */
export function InjurySweepRunner() {
  const [stats, setStats] = useState<SweepStats>(INITIAL);
  const stopRef = useRef(false);

  const startSweep = async () => {
    stopRef.current = false;
    const startedAt = new Date().toISOString();
    let working: SweepStats = {
      ...INITIAL,
      status: "running",
      started_at: startedAt,
    };
    setStats(working);

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (stopRef.current) {
        setStats({ ...working, status: "stopped" });
        return;
      }

      let res: Response;
      try {
        res = await fetch(
          `/api/admin/sync-injuries?format=json&since=${encodeURIComponent(
            startedAt,
          )}`,
          { method: "POST" },
        );
      } catch (err) {
        setStats({
          ...working,
          status: "error",
          message:
            err instanceof Error ? err.message : "network error",
        });
        return;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStats({
          ...working,
          status: "error",
          message: `HTTP ${res.status}${text ? ` — ${text.slice(0, 120)}` : ""}`,
        });
        return;
      }

      const data: {
        ok: boolean;
        checked?: number;
        flagged?: number;
        cleared?: number;
        unchanged?: number;
        errors?: number;
        remaining?: number;
        sample_errors?: string[];
      } = await res.json();

      if (!data.ok) {
        setStats({
          ...working,
          status: "error",
          message: "API returned ok=false",
        });
        return;
      }

      working = {
        ...working,
        iterations: working.iterations + 1,
        total_checked: working.total_checked + (data.checked ?? 0),
        total_flagged: working.total_flagged + (data.flagged ?? 0),
        total_cleared: working.total_cleared + (data.cleared ?? 0),
        total_unchanged:
          working.total_unchanged + (data.unchanged ?? 0),
        total_errors: working.total_errors + (data.errors ?? 0),
        remaining: data.remaining ?? 0,
        sample_errors: dedupe([
          ...working.sample_errors,
          ...(data.sample_errors ?? []),
        ]).slice(0, 5),
      };
      setStats({ ...working });

      // Done? remaining === 0 means every player has been refreshed
      // since the sweep started.
      if ((data.remaining ?? 0) === 0) {
        setStats({ ...working, status: "complete" });
        return;
      }

      // Or done if the server processed nothing (defensive)
      if ((data.checked ?? 0) === 0) {
        setStats({
          ...working,
          status: "complete",
          message: "API returned 0 checked — likely caught up.",
        });
        return;
      }

      await sleep(PAUSE_BETWEEN_RUNS_MS);
    }

    setStats({
      ...working,
      status: "complete",
      message: `Hit safety cap of ${MAX_ITERATIONS} iterations.`,
    });
  };

  const stopSweep = () => {
    stopRef.current = true;
  };

  const isRunning = stats.status === "running";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Full injury sweep</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-sm text-ice-300">
          Repeatedly calls the injury sync endpoint until every active
          player has been checked since the sweep started.
        </p>
        <p className="mb-4 text-xs text-ice-500">
          Each iteration takes ~40 seconds because the NHL public API
          rate-limits us to ~1.25 requests/sec. A full sweep of an
          ~800-player pool takes <strong>roughly 13–20 minutes</strong>.
          You can leave this tab open in the background and check
          back; closing the tab stops the sweep but any progress
          already saved persists.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          {isRunning ? (
            <Button variant="danger" onClick={stopSweep}>
              Stop sweep
            </Button>
          ) : (
            <Button onClick={startSweep}>
              {stats.iterations > 0 ? "Run again" : "Start full sweep"}
            </Button>
          )}
          {isRunning && (
            <span className="self-center text-xs text-ice-400">
              Running… {stats.iterations} iteration
              {stats.iterations === 1 ? "" : "s"} so far
            </span>
          )}
        </div>

        {stats.iterations > 0 && (
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Stat label="Iterations" value={stats.iterations} />
            <Stat label="Players checked" value={stats.total_checked} />
            <Stat label="Newly flagged" value={stats.total_flagged} />
            <Stat label="Cleared" value={stats.total_cleared} />
            <Stat label="Errors" value={stats.total_errors} />
            <Stat label="Remaining" value={stats.remaining} />
          </dl>
        )}

        {stats.sample_errors.length > 0 && (
          <div className="mt-4 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
            <div className="mb-1 font-semibold uppercase tracking-wider text-yellow-300">
              Sample sync errors
            </div>
            <ul className="list-disc space-y-0.5 pl-4 font-mono">
              {stats.sample_errors.map((m, i) => (
                <li key={i} className="break-all">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        )}

        {stats.status === "complete" && (
          <div className="mt-4 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-300">
            ✅ Sweep complete{stats.message ? ` — ${stats.message}` : ""}
          </div>
        )}
        {stats.status === "stopped" && (
          <div className="mt-4 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
            ⏹ Stopped after {stats.iterations} iteration
            {stats.iterations === 1 ? "" : "s"}.
          </div>
        )}
        {stats.status === "error" && (
          <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            ❌ {stats.message ?? "Unknown error"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-puck-border bg-puck-bg px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-ice-400">
        {label}
      </div>
      <div className="text-lg font-semibold text-ice-50">{value}</div>
    </div>
  );
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
