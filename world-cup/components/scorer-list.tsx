import Link from "next/link";
import { Flag } from "@/components/flag";
import type { ScorerLine } from "@/lib/match-scorers";
import type { Country } from "@/lib/types";

/**
 * Renders goal scorers for one match. Each line links to the player page
 * (when we have a player id) and shows the scoring country's flag, the
 * minute, and a tag for penalties / own goals. Server component so it can
 * take the countryById Map directly.
 */
export function ScorerList({
  leagueId,
  lines,
  countryById,
}: {
  leagueId: string;
  lines: ScorerLine[];
  countryById: Map<number, Country>;
}) {
  const goals = lines.filter((l) => !l.is_shootout);
  if (goals.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ice-400">
      {goals.map((l, i) => {
        const country = l.country_id != null ? countryById.get(l.country_id) : null;
        const tag = l.type === "penalty" ? " (P)" : l.type === "own_goal" ? " (OG)" : "";
        const label = (
          <>
            {l.minute != null && <span className="text-ice-500">{l.minute}&rsquo; </span>}
            {l.player_name ?? "Unknown"}
            {tag}
          </>
        );
        return (
          <li key={i} className="inline-flex items-center gap-1">
            <Flag code={country?.code} />
            {l.player_id != null ? (
              <Link
                href={`/leagues/${leagueId}/players/${l.player_id}`}
                className="text-ice-200 hover:underline"
              >
                {label}
              </Link>
            ) : (
              <span className="text-ice-300">{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
