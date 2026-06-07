// World Cup pool — ruleset simulation.
//
// Drafts 12 owners (snake, best-available by FIFA rank) over a 48-team field of
// real sides from the last two World Cups, plays a full 2026-format tournament
// (12 groups -> R32 -> Final), scores it with our ACTUAL engine, and reports a
// weekly point summary + the spread among owners. Reproducible (seeded).
//
// Run: node --experimental-strip-types world-cup/scripts/simulate.ts

import { scoreOwner, rankOwners } from "../lib/scoring.ts";

// ---- 48 real teams (last-2-WC field), ordered by approx FIFA rank ----------
const TEAMS = [
  "Argentina", "France", "Brazil", "England", "Belgium", "Croatia",
  "Netherlands", "Portugal", "Spain", "Morocco", "Switzerland", "Uruguay",
  "USA", "Germany", "Mexico", "Senegal", "Denmark", "Japan",
  "Poland", "South Korea", "Australia", "Serbia", "Ecuador", "Tunisia",
  "Cameroon", "Ghana", "Wales", "Costa Rica", "Canada", "Qatar",
  "Saudi Arabia", "Iran", "Colombia", "Sweden", "Nigeria", "Egypt",
  "Peru", "Russia", "Iceland", "Panama", "Paraguay", "Chile",
  "Norway", "Ivory Coast", "Algeria", "Scotland", "Hungary", "Austria",
].map((name, i) => ({ id: i, name, rank: i + 1 }));

const fifaRank = (id: number) => TEAMS[id].rank;
const rating = (id: number) => (TEAMS.length - TEAMS[id].rank) / (TEAMS.length - 1); // 0..1

// ---- seeded RNG + goal model ----------------------------------------------
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
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
function simScore(a: number, b: number, rng: () => number) {
  const d = rating(a) - rating(b);
  const ga = poisson(1.35 * Math.exp(0.9 * d), rng);
  const gb = poisson(1.35 * Math.exp(-0.9 * d), rng);
  return [ga, gb] as const;
}

type M = {
  id: string; stage: string; status: "final";
  home_country_id: number; away_country_id: number;
  home_goals: number; away_goals: number;
  went_to_shootout: boolean; home_pens: number | null; away_pens: number | null;
  _week: number;
};

const WEEK: Record<string, number> = { groupMD1: 1, groupMD2: 2, groupMD3: 3, r32: 3, r16: 4, qf: 4, sf: 5, third: 5, final: 5 };

function ko(a: number, b: number, stage: string, week: number, rng: () => number): M {
  let [ga, gb] = simScore(a, b, rng);
  let shoot = false, pa: number | null = null, pb: number | null = null;
  if (ga === gb) {
    shoot = true;
    const pA = 0.5 + 0.15 * (rating(a) - rating(b));
    if (rng() < pA) { pa = 4; pb = 3; } else { pa = 3; pb = 4; }
  }
  return { id: `${stage}-${a}-${b}`, stage, status: "final", home_country_id: a, away_country_id: b, home_goals: ga, away_goals: gb, went_to_shootout: shoot, home_pens: pa, away_pens: pb, _week: week };
}
function koWinner(m: M): number {
  if (m.went_to_shootout) return (m.home_pens ?? 0) > (m.away_pens ?? 0) ? m.home_country_id : m.away_country_id;
  return m.home_goals > m.away_goals ? m.home_country_id : m.away_country_id;
}
function koLoser(m: M): number {
  return koWinner(m) === m.home_country_id ? m.away_country_id : m.home_country_id;
}

// ---- one full tournament ---------------------------------------------------
function simulateTournament(seed: number) {
  const rng = mulberry32(seed);
  const shuffle = <T,>(arr: T[]) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // Pots -> 12 groups of 4 (one team per pot per group).
  const pots = [0, 1, 2, 3].map((p) => shuffle(TEAMS.slice(p * 12, p * 12 + 12).map((t) => t.id)));
  const groups: number[][] = Array.from({ length: 12 }, (_, g) => pots.map((pot) => pot[g]));

  const matches: M[] = [];
  const standings = new Map<number, { p: number; gf: number; ga: number; g: number }>();
  for (const t of TEAMS) standings.set(t.id, { p: 0, gf: 0, ga: 0, g: 0 });
  const applyGroup = (h: number, a: number, hg: number, ag: number) => {
    const sh = standings.get(h)!, sa = standings.get(a)!;
    sh.gf += hg; sh.ga += ag; sa.gf += ag; sa.ga += hg;
    if (hg > ag) sh.p += 3; else if (hg < ag) sa.p += 3; else { sh.p++; sa.p++; }
  };
  // Round-robin schedule by matchday.
  const sched: Array<[number, number, number]> = [[0, 1, 1], [2, 3, 1], [0, 2, 2], [1, 3, 2], [0, 3, 3], [1, 2, 3]];
  for (const grp of groups) {
    for (const [i, j, md] of sched) {
      const [hg, ag] = simScore(grp[i], grp[j], rng);
      applyGroup(grp[i], grp[j], hg, ag);
      matches.push({ id: `g-${grp[i]}-${grp[j]}`, stage: "group", status: "final", home_country_id: grp[i], away_country_id: grp[j], home_goals: hg, away_goals: ag, went_to_shootout: false, home_pens: null, away_pens: null, _week: WEEK[`groupMD${md}`] });
    }
  }

  // Group finish order.
  const cmp = (x: number, y: number) => { const a = standings.get(x)!, b = standings.get(y)!; return b.p - a.p || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf; };
  const winners: number[] = [], runners: number[] = [], thirds: number[] = [];
  for (const grp of groups) { const o = [...grp].sort(cmp); winners.push(o[0]); runners.push(o[1]); thirds.push(o[2]); }
  const bestThirds = [...thirds].sort(cmp).slice(0, 8);

  // 32 advancers, seeded: winners, runners, best thirds.
  const advancers = [...winners.sort(cmp), ...runners.sort(cmp), ...bestThirds];

  // Single-elim bracket: seed i vs seed (n-1-i).
  const round = (teamsIn: number[], stage: string): { winners: number[]; played: M[] } => {
    const played: M[] = [], w: number[] = [];
    for (let i = 0; i < teamsIn.length / 2; i++) {
      const m = ko(teamsIn[i], teamsIn[teamsIn.length - 1 - i], stage, WEEK[stage], rng);
      played.push(m); w.push(koWinner(m));
    }
    return { winners: w, played };
  };
  const r32 = round(advancers, "r32"); matches.push(...r32.played);
  const r16 = round(r32.winners, "r16"); matches.push(...r16.played);
  const qf = round(r16.winners, "qf"); matches.push(...qf.played);
  const sf = round(qf.winners, "sf"); matches.push(...sf.played);
  const thirdM = ko(koLoser(sf.played[0]), koLoser(sf.played[1]), "third", WEEK.third, rng); matches.push(thirdM);
  const finalM = ko(sf.winners[0], sf.winners[1], "final", WEEK.final, rng); matches.push(finalM);

  return { matches, champion: koWinner(finalM) };
}

// ---- 12-owner snake draft (best available by rank) -------------------------
function draft(seed: number) {
  const rng = mulberry32(seed * 7 + 1);
  const order = Array.from({ length: 12 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rosters: number[][] = Array.from({ length: 12 }, () => []);
  const pool = TEAMS.map((t) => t.id).sort((a, b) => fifaRank(a) - fifaRank(b));
  let pick = 0;
  for (let r = 0; r < 4; r++) {
    const seq = r % 2 === 0 ? order : [...order].reverse();
    for (const o of seq) rosters[o].push(pool[pick++]);
  }
  return { order, rosters };
}

function ownerTotals(rosters: number[][], matches: M[]) {
  return rosters.map((country_ids, i) =>
    scoreOwner({ team_id: `O${i + 1}`, country_ids, owns_golden_boot: false }, matches as never, fifaRank).total,
  );
}
function stats(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const min = Math.min(...xs), max = Math.max(...xs);
  return { mean, sd, min, max, range: max - min };
}
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---- detailed example tournament ------------------------------------------
const SEED = 42;
const { matches, champion } = simulateTournament(SEED);
const { rosters } = draft(SEED);

console.log(`\n=== Example tournament (seed ${SEED}) — champion: ${TEAMS[champion].name} ===\n`);
console.log("Draft (snake, best available by FIFA rank):");
rosters.forEach((rs, i) => console.log(`  Owner ${String(i + 1).padStart(2)}: ${rs.map((id) => TEAMS[id].name).join(", ")}`));

console.log("\nWeekly cumulative owner points (sorted each week):");
for (let wk = 1; wk <= 5; wk++) {
  const upto = matches.filter((m) => m._week <= wk);
  const totals = ownerTotals(rosters, upto);
  const s = stats(totals);
  const sorted = totals.map((t, i) => ({ o: i + 1, t })).sort((a, b) => b.t - a.t);
  const label = ["Group MD1", "Group MD2", "Group MD3", "R16 + QF", "SF + Final"][wk - 1];
  console.log(`\n  Week ${wk} (${label})  ·  leader ${r1(s.max)}  last ${r1(s.min)}  spread ${r1(s.range)}  stdev ${r1(s.sd)}`);
  console.log("   " + sorted.map((x) => `O${x.o}:${r1(x.t)}`).join("  "));
}

// ---- aggregate over many tournaments ---------------------------------------
const N = 2000;
const finalRanges: number[] = [], finalSds: number[] = [], winnerPts: number[] = [], lastPts: number[] = [];
let gapUnder20 = 0, leaderAfterWk2WonCount = 0;
for (let s = 0; s < N; s++) {
  const t = simulateTournament(1000 + s);
  const d = draft(1000 + s);
  const finals = ownerTotals(d.rosters, t.matches);
  const st = stats(finals);
  finalRanges.push(st.range); finalSds.push(st.sd); winnerPts.push(st.max); lastPts.push(st.min);
  if (st.range < 20) gapUnder20++;
  // Does the week-2 leader end up winning?
  const wk2 = ownerTotals(d.rosters, t.matches.filter((m) => m._week <= 2));
  const leadWk2 = wk2.indexOf(Math.max(...wk2));
  if (finals[leadWk2] === Math.max(...finals)) leaderAfterWk2WonCount++;
}
const rng2 = stats(finalRanges), sd2 = stats(finalSds), win2 = stats(winnerPts), last2 = stats(lastPts);
console.log(`\n=== Aggregate over ${N} simulated tournaments ===`);
console.log(`  Winning owner total:   avg ${r1(win2.mean)}  (range ${r1(win2.min)}–${r1(win2.max)})`);
console.log(`  Last-place owner total: avg ${r1(last2.mean)}  (range ${r1(last2.min)}–${r1(last2.max)})`);
console.log(`  1st-to-12th gap:        avg ${r1(rng2.mean)}  (min ${r1(rng2.min)}, max ${r1(rng2.max)})`);
console.log(`  Owner-points stdev:     avg ${r1(sd2.mean)}`);
console.log(`  Gap under 20 pts:       ${r1((gapUnder20 / N) * 100)}% of tournaments`);
console.log(`  Week-2 leader wins:     ${r1((leaderAfterWk2WonCount / N) * 100)}% (lower = more volatile / more competitive)`);
console.log("");
