"use client";

import Link from "next/link";
import { Flag } from "@/components/flag";

export interface TickerItem {
  matchId: string;
  date: string;
  homeCode: string | null;
  homeFlag: string | null;
  awayCode: string | null;
  awayFlag: string | null;
  center: string; // score, "LIVE", or kickoff time
  live: boolean;
}

/** Scrolling marquee of recent / live / upcoming games. */
export function TickerClient({ leagueId, items }: { leagueId: string; items: TickerItem[] }) {
  if (items.length === 0) return null;

  const row = (copy: string) =>
    items.map((it, i) => (
      <Link
        key={`${copy}-${i}`}
        href={`/leagues/${leagueId}/games/${it.matchId}`}
        className="inline-flex shrink-0 items-center gap-1.5 border-r border-puck-border px-3 py-1.5 text-xs text-ice-200 hover:bg-puck-card"
      >
        {it.date && <span className="mr-0.5 text-[10px] text-ice-500">{it.date}</span>}
        <Flag code={it.homeCode} url={it.homeFlag} />
        <span className="font-medium text-ice-100">{it.homeCode}</span>
        <span className={"px-1 font-semibold tabular-nums " + (it.live ? "text-green-300" : "text-ice-50")}>{it.center}</span>
        <span className="font-medium text-ice-100">{it.awayCode}</span>
        <Flag code={it.awayCode} url={it.awayFlag} />
      </Link>
    ));

  return (
    <div className="ticker-wrap overflow-hidden border-b border-puck-border bg-puck-bg">
      <div className="flex w-max animate-ticker whitespace-nowrap">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}
