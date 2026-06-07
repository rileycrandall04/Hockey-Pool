import type { Country, ScoringMatch } from "./types";

export interface GroupRow {
  country: Country;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number; // real football points (3/1/0), not our fantasy scoring
}

export interface GroupTable {
  letter: string;
  rows: GroupRow[];
}

/**
 * Build the official-style group tables (P/W/D/L/GF/GA/GD/Pts) from the
 * group-stage matches. Only `final` matches count toward results; teams with
 * no completed games still appear with zeroes.
 */
export function buildGroupTables(
  countries: Country[],
  matches: ScoringMatch[],
): GroupTable[] {
  const byId = new Map<number, Country>();
  for (const c of countries) byId.set(c.id, c);

  // Seed a row for every country that has a group letter.
  const rows = new Map<number, GroupRow>();
  for (const c of countries) {
    if (!c.group_letter) continue;
    rows.set(c.id, {
      country: c,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0,
    });
  }

  for (const m of matches) {
    if (m.stage !== "group" || m.status !== "final") continue;
    const home = rows.get(m.home_country_id);
    const away = rows.get(m.away_country_id);
    if (!home || !away) continue;
    const hg = m.home_goals ?? 0;
    const ag = m.away_goals ?? 0;

    home.played++;
    away.played++;
    home.gf += hg;
    home.ga += ag;
    away.gf += ag;
    away.ga += hg;

    if (hg > ag) {
      home.won++;
      away.lost++;
      home.points += 3;
    } else if (hg < ag) {
      away.won++;
      home.lost++;
      away.points += 3;
    } else {
      home.drawn++;
      away.drawn++;
      home.points += 1;
      away.points += 1;
    }
  }

  // Group by letter, sort each table.
  const tables = new Map<string, GroupRow[]>();
  for (const row of rows.values()) {
    row.gd = row.gf - row.ga;
    const letter = row.country.group_letter!;
    const arr = tables.get(letter) ?? [];
    arr.push(row);
    tables.set(letter, arr);
  }

  const sortRows = (a: GroupRow, b: GroupRow) =>
    b.points - a.points ||
    b.gd - a.gd ||
    b.gf - a.gf ||
    a.country.name.localeCompare(b.country.name);

  return [...tables.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, r]) => ({ letter, rows: r.sort(sortRows) }));
}
