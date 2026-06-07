"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Flag } from "@/components/flag";

export interface PlayerItem {
  id: number;
  name: string;
  goals: number;
  country_code: string | null;
  country_name: string | null;
}

/** Alphabetical player directory with real-time client-side filtering. */
export function PlayersSearch({
  leagueId,
  items,
}: {
  leagueId: string;
  items: PlayerItem[];
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.country_name?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query]);

  return (
    <div>
      <Input
        placeholder="Search players or countries…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-3"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-ice-400">No players match &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="divide-y divide-puck-border overflow-hidden rounded-xl border border-puck-border">
          {filtered.map((p) => (
            <li key={p.id}>
              <Link
                href={`/leagues/${leagueId}/players/${p.id}`}
                className="flex items-center justify-between gap-2 bg-puck-bg px-3 py-2 hover:bg-puck-card"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Flag code={p.country_code} />
                  <span className="truncate text-sm text-ice-50">{p.name}</span>
                  <span className="truncate text-xs text-ice-500">{p.country_name ?? ""}</span>
                </span>
                <span className="shrink-0 text-sm text-ice-200">
                  {p.goals} <span className="text-xs text-ice-500">{p.goals === 1 ? "goal" : "goals"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-ice-500">{filtered.length} of {items.length} players</p>
    </div>
  );
}
