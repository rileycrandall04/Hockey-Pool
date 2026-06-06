"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Owner-only button that triggers a World Cup data sync and shows the summary. */
export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/sync-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult(`❌ ${json.error ?? res.status}`);
      } else {
        setResult(
          `✅ ${json.matches_upserted} matches, ${json.top_scorers} scorers` +
            (json.skipped_locked ? `, ${json.skipped_locked} locked skipped` : "") +
            (json.unmatched_teams?.length ? ` · unmatched: ${json.unmatched_teams.join(", ")}` : "") +
            (json.errors?.length ? ` · errors: ${json.errors.join("; ")}` : ""),
        );
        router.refresh();
      }
    } catch {
      setResult("❌ Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={run} disabled={busy}>
        {busy ? "Syncing…" : "Sync from API-Football now"}
      </Button>
      {result && <p className="break-words text-xs text-ice-300">{result}</p>}
    </div>
  );
}
