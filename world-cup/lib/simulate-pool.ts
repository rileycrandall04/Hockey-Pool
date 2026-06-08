import { scoreCountry } from "./scoring";
import type { ScoringMatch, Stage } from "./types";

// Preseason win-odds simulator. Plays out the tournament many times from the
// real groups + FIFA ranks, scores each owner with the ACTUAL scoring engine
// (scoreCountry), and returns each team's probability of winning the pool.
//
// The Golden Boot bonus and commissioner adjustments are intentionally left
// out (they need player-level / manual data); they're small relative to the
// spread, so the odds remain a good guide.

export interface OddsCountry {
  id: number;
  fifa_rank: number | null;
  group_letter: string | null;
}
export interface OddsRoster {
  team_id: string;
  country_ids: number[];
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(lambda: number, rng: () => number) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

const KO_STAGE: Record<number, Stage> = { 32: "r32", 16: "r16", 8: "qf", 4: "sf", 2: "final" };

/** Returns { team_id: win% } over `runs` simulated tournaments. */
export function computePoolOdds(
  countries: OddsCountry[],
  rosters: OddsRoster[],
  runs = 1200,
): Record<string, number> {
  const rankById = new Map(countries.map((c) => [c.id, c.fifa_rank ?? 999]));
  const ranks = countries.map((c) => c.fifa_rank ?? 999);
  const maxR = Math.max(...ranks), minR = Math.min(...ranks);
  const spread = maxR - minR || 1;
  const rating = (id: number) => (maxR - (rankById.get(id) ?? maxR)) / spread; // 0..1, higher = stronger
  const fifaRank = (id: number) => rankById.get(id) ?? null;

  const rng = mulberry32(987654321);
  const simScore = (a: number, b: number): [number, number] => {
    const d = rating(a) - rating(b);
    return [poisson(1.35 * Math.exp(0.9 * d), rng), poisson(1.35 * Math.exp(-0.9 * d), rng)];
  };
  const koGoals = (a: number, b: number) => {
    let [ga, gb] = simScore(a, b);
    let shoot = false, pa: number | null = null, pb: number | null = null;
    if (ga === gb) { shoot = true; if (rng() < 0.5 + 0.15 * (rating(a) - rating(b))) { pa = 4; pb = 3; } else { pa = 3; pb = 4; } }
    const homeWin = shoot ? (pa! > pb!) : ga > gb;
    return { ga, gb, shoot, pa, pb, homeWin };
  };

  const groupsMap = new Map<string, number[]>();
  for (const c of countries) {
    if (!c.group_letter) continue;
    const arr = groupsMap.get(c.group_letter) ?? [];
    arr.push(c.id);
    groupsMap.set(c.group_letter, arr);
  }
  const groups = [...groupsMap.values()].filter((g) => g.length >= 2);

  const wins = new Map<string, number>();
  for (const r of rosters) wins.set(r.team_id, 0);
  const draftedIds = new Set<number>();
  for (const r of rosters) for (const id of r.country_ids) draftedIds.add(id);

  for (let s = 0; s < runs; s++) {
    const matches: ScoringMatch[] = [];
    const st = new Map<number, { p: number; gf: number; ga: number }>();
    for (const c of countries) st.set(c.id, { p: 0, gf: 0, ga: 0 });
    let mid = 0;

    // Group stage (round robin).
    const winners: number[] = [], runners: number[] = [], thirds: number[] = [];
    for (const g of groups) {
      for (let i = 0; i < g.length; i++)
        for (let j = i + 1; j < g.length; j++) {
          const [hg, ag] = simScore(g[i], g[j]);
          const sh = st.get(g[i])!, sa = st.get(g[j])!;
          sh.gf += hg; sh.ga += ag; sa.gf += ag; sa.ga += hg;
          if (hg > ag) sh.p += 3; else if (hg < ag) sa.p += 3; else { sh.p++; sa.p++; }
          matches.push({ id: `m${mid++}`, stage: "group", status: "final", home_country_id: g[i], away_country_id: g[j], home_goals: hg, away_goals: ag, went_to_shootout: false, home_pens: null, away_pens: null });
        }
    }
    const cmp = (x: number, y: number) => { const a = st.get(x)!, b = st.get(y)!; return b.p - a.p || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf; };
    for (const g of groups) { const o = [...g].sort(cmp); winners.push(o[0]); if (o[1] != null) runners.push(o[1]); if (o[2] != null) thirds.push(o[2]); }
    let advancers = [...winners.sort(cmp), ...runners.sort(cmp), ...[...thirds].sort(cmp)];
    const pow = 1 << Math.floor(Math.log2(advancers.length || 1));
    advancers = advancers.slice(0, pow); // single-elim needs a power of two

    // Knockout rounds.
    let round = advancers;
    let sfLosers: number[] = [];
    while (round.length > 1) {
      const stage = KO_STAGE[round.length] ?? "r32";
      const next: number[] = [], losers: number[] = [];
      for (let i = 0; i < round.length / 2; i++) {
        const a = round[i], b = round[round.length - 1 - i];
        const r = koGoals(a, b);
        matches.push({ id: `m${mid++}`, stage, status: "final", home_country_id: a, away_country_id: b, home_goals: r.ga, away_goals: r.gb, went_to_shootout: r.shoot, home_pens: r.pa, away_pens: r.pb });
        next.push(r.homeWin ? a : b);
        losers.push(r.homeWin ? b : a);
      }
      if (stage === "sf") sfLosers = losers;
      round = next;
    }
    if (sfLosers.length === 2) {
      const [a, b] = sfLosers, r = koGoals(a, b);
      matches.push({ id: `m${mid++}`, stage: "third", status: "final", home_country_id: a, away_country_id: b, home_goals: r.ga, away_goals: r.gb, went_to_shootout: r.shoot, home_pens: r.pa, away_pens: r.pb });
    }

    // Score owners (only their drafted countries; group matches by country).
    const byCountry = new Map<number, ScoringMatch[]>();
    for (const m of matches) {
      if (draftedIds.has(m.home_country_id)) { const a = byCountry.get(m.home_country_id) ?? []; a.push(m); byCountry.set(m.home_country_id, a); }
      if (draftedIds.has(m.away_country_id)) { const a = byCountry.get(m.away_country_id) ?? []; a.push(m); byCountry.set(m.away_country_id, a); }
    }
    let best = -Infinity, bestTeam: string | null = null;
    for (const r of rosters) {
      let total = 0;
      for (const id of r.country_ids) total += scoreCountry(id, byCountry.get(id) ?? [], fifaRank).total;
      if (total > best) { best = total; bestTeam = r.team_id; }
    }
    if (bestTeam) wins.set(bestTeam, (wins.get(bestTeam) ?? 0) + 1);
  }

  const odds: Record<string, number> = {};
  for (const r of rosters) odds[r.team_id] = Math.round(((wins.get(r.team_id) ?? 0) / runs) * 1000) / 10;
  return odds;
}
