"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Commissioner button to (re)compute preseason win odds. */
export function OddsButton({ leagueId, recompute }: { leagueId: string; recompute?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/league/${leagueId}/odds`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Failed");
      else router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={run} disabled={busy}>
        {busy ? "Simulating…" : recompute ? "↻ Recompute odds" : "Compute win odds"}
      </Button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </span>
  );
}
