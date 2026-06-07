// Ruleset variant comparison. Same tournament model + draft as simulate.ts,
// but with a PARAMETERIZED scorer so we can sweep rule tweaks without touching
// production scoring. Reports how each variant changes the spread among the 12
// owners. Run: node --experimental-strip-types world-cup/scripts/simulate-variants.ts

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
const rating = (id: number) => (TEAMS.length - TEAMS[id].rank) / (TEAMS.length - 1);

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(lambda: number, rng: () => number) { const L = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= rng(); } while (p > L); return k - 1; }
function simScore(a: number, b: number, rng: () => number) { const d = rating(a) - rating(b); return [poisson(1.35 * Math.exp(0.9 * d), rng), poisson(1.35 * Math.exp(-0.9 * d), rng)] as const; }

type M = { stage: string; status: "final"; home_country_id: number; away_country_id: number; home_goals: number; away_goals: number; went_to_shootout: boolean; home_pens: number | null; away_pens: number | null; _week: number };
const WEEK: Record<string, number> = { groupMD1: 1, groupMD2: 2, groupMD3: 3, r32: 3, r16: 4, qf: 4, sf: 5, third: 5, final: 5 };

function ko(a: number, b: number, stage: string, rng: () => number): M {
  let [ga, gb] = simScore(a, b, rng); let shoot = false, pa: number | null = null, pb: number | null = null;
  if (ga === gb) { shoot = true; const pA = 0.5 + 0.15 * (rating(a) - rating(b)); if (rng() < pA) { pa = 4; pb = 3; } else { pa = 3; pb = 4; } }
  return { stage, status: "final", home_country_id: a, away_country_id: b, home_goals: ga, away_goals: gb, went_to_shootout: shoot, home_pens: pa, away_pens: pb, _week: WEEK[stage] };
}
const koWinner = (m: M) => m.went_to_shootout ? ((m.home_pens ?? 0) > (m.away_pens ?? 0) ? m.home_country_id : m.away_country_id) : (m.home_goals > m.away_goals ? m.home_country_id : m.away_country_id);
const koLoser = (m: M) => koWinner(m) === m.home_country_id ? m.away_country_id : m.home_country_id;

function simulateTournament(seed: number): M[] {
  const rng = mulberry32(seed);
  const shuffle = <T,>(arr: T[]) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pots = [0, 1, 2, 3].map((p) => shuffle(TEAMS.slice(p * 12, p * 12 + 12).map((t) => t.id)));
  const groups: number[][] = Array.from({ length: 12 }, (_, g) => pots.map((pot) => pot[g]));
  const matches: M[] = [];
  const st = new Map<number, { p: number; gf: number; ga: number }>(); for (const t of TEAMS) st.set(t.id, { p: 0, gf: 0, ga: 0 });
  const sched: Array<[number, number, number]> = [[0, 1, 1], [2, 3, 1], [0, 2, 2], [1, 3, 2], [0, 3, 3], [1, 2, 3]];
  for (const grp of groups) for (const [i, j, md] of sched) {
    const [hg, ag] = simScore(grp[i], grp[j], rng); const sh = st.get(grp[i])!, sa = st.get(grp[j])!;
    sh.gf += hg; sh.ga += ag; sa.gf += ag; sa.ga += hg; if (hg > ag) sh.p += 3; else if (hg < ag) sa.p += 3; else { sh.p++; sa.p++; }
    matches.push({ stage: "group", status: "final", home_country_id: grp[i], away_country_id: grp[j], home_goals: hg, away_goals: ag, went_to_shootout: false, home_pens: null, away_pens: null, _week: WEEK[`groupMD${md}`] });
  }
  const cmp = (x: number, y: number) => { const a = st.get(x)!, b = st.get(y)!; return b.p - a.p || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf; };
  const winners: number[] = [], runners: number[] = [], thirds: number[] = [];
  for (const grp of groups) { const o = [...grp].sort(cmp); winners.push(o[0]); runners.push(o[1]); thirds.push(o[2]); }
  const advancers = [...winners.sort(cmp), ...runners.sort(cmp), ...[...thirds].sort(cmp).slice(0, 8)];
  const round = (tin: number[], stage: string) => { const played: M[] = [], w: number[] = []; for (let i = 0; i < tin.length / 2; i++) { const m = ko(tin[i], tin[tin.length - 1 - i], stage, rng); played.push(m); w.push(koWinner(m)); } return { w, played }; };
  const r32 = round(advancers, "r32"); matches.push(...r32.played);
  const r16 = round(r32.w, "r16"); matches.push(...r16.played);
  const qf = round(r16.w, "qf"); matches.push(...qf.played);
  const sf = round(qf.w, "sf"); matches.push(...sf.played);
  matches.push(ko(koLoser(sf.played[0]), koLoser(sf.played[1]), "third", rng));
  matches.push(ko(sf.w[0], sf.w[1], "final", rng));
  return matches;
}

function draft(seed: number): number[][] {
  const rng = mulberry32(seed * 7 + 1);
  const order = Array.from({ length: 12 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rosters: number[][] = Array.from({ length: 12 }, () => []);
  const pool = TEAMS.map((t) => t.id).sort((a, b) => fifaRank(a) - fifaRank(b));
  let pick = 0;
  for (let r = 0; r < 4; r++) { const seq = r % 2 === 0 ? order : [...order].reverse(); for (const o of seq) rosters[o].push(pool[pick++]); }
  return rosters;
}

// ---- parameterized scorer (mirrors lib/scoring.ts) -------------------------
type Cfg = { win: number; draw: number; gf: number; ga: number; cs: number; upset: number; champion: number; adv: Record<string, number> };
function scoreCountry(cid: number, matches: M[], cfg: Cfg): number {
  const mine = matches.filter((m) => m.home_country_id === cid || m.away_country_id === cid);
  let pts = 0; const stages = new Set<string>();
  for (const m of mine) {
    stages.add(m.stage);
    const isHome = m.home_country_id === cid;
    const opp = isHome ? m.away_country_id : m.home_country_id;
    const gf = (isHome ? m.home_goals : m.away_goals) ?? 0;
    const ga = (isHome ? m.away_goals : m.home_goals) ?? 0;
    pts += gf * cfg.gf + ga * cfg.ga;
    if (ga === 0) pts += cfg.cs;
    if (m.went_to_shootout) {
      pts += cfg.draw; const myP = (isHome ? m.home_pens : m.away_pens) ?? 0, opP = (isHome ? m.away_pens : m.home_pens) ?? 0;
      pts += myP > opP ? 4 : 2; if (m.stage === "final" && myP > opP) pts += cfg.champion;
    } else if (gf > ga) {
      pts += cfg.win;
      if (m.stage === "group" && fifaRank(cid) > fifaRank(opp)) pts += cfg.upset;
      if (m.stage === "final") pts += cfg.champion;
    } else if (gf === ga) pts += cfg.draw;
  }
  for (const s of stages) pts += cfg.adv[s] ?? 0;
  return pts;
}
const ownerTotals = (rosters: number[][], matches: M[], cfg: Cfg) => rosters.map((r) => r.reduce((s, id) => s + scoreCountry(id, matches, cfg), 0));
function stats(xs: number[]) { const mean = xs.reduce((a, b) => a + b, 0) / xs.length; const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length); return { mean, sd, min: Math.min(...xs), max: Math.max(...xs), range: Math.max(...xs) - Math.min(...xs) }; }
const r1 = (n: number) => Math.round(n * 10) / 10;

const BASE_ADV = { r32: 1, r16: 2, qf: 3, sf: 4, final: 5 };
const FLAT_ADV = { r32: 2, r16: 2, qf: 2, sf: 2, final: 2 };
const CONFIGS: Array<{ name: string; cfg: Cfg }> = [
  { name: "Baseline (adv 1/2/3/4/5, upset 5)", cfg: { win: 3, draw: 1, gf: 1, ga: -0.5, cs: 1, upset: 5, champion: 8, adv: BASE_ADV } },
  { name: "Flat adv = 2, upset 5", cfg: { win: 3, draw: 1, gf: 1, ga: -0.5, cs: 1, upset: 5, champion: 8, adv: FLAT_ADV } },
  { name: "Flat adv = 2, upset x2 = 10", cfg: { win: 3, draw: 1, gf: 1, ga: -0.5, cs: 1, upset: 10, champion: 8, adv: FLAT_ADV } },
  { name: "Flat adv = 2, upset x3 = 15", cfg: { win: 3, draw: 1, gf: 1, ga: -0.5, cs: 1, upset: 15, champion: 8, adv: FLAT_ADV } },
];

const N = 3000;
console.log(`\nAggregate over ${N} simulated tournaments (12 owners x 4 teams):\n`);
console.log("Variant                              | winner | last | gap(1st-12th) | stdev | wk2-leader-wins");
console.log("-".repeat(98));
for (const { name, cfg } of CONFIGS) {
  let win = 0, last = 0, gap = 0, sd = 0, wk2win = 0;
  for (let s = 0; s < N; s++) {
    const matches = simulateTournament(1000 + s);
    const rosters = draft(1000 + s);
    const finals = ownerTotals(rosters, matches, cfg);
    const st = stats(finals); win += st.max; last += st.min; gap += st.range; sd += st.sd;
    const wk2 = ownerTotals(rosters, matches.filter((m) => m._week <= 2), cfg);
    const lead = wk2.indexOf(Math.max(...wk2)); if (finals[lead] === Math.max(...finals)) wk2win++;
  }
  console.log(`${name.padEnd(36)} | ${r1(win / N).toString().padStart(6)} | ${r1(last / N).toString().padStart(4)} | ${r1(gap / N).toString().padStart(13)} | ${r1(sd / N).toString().padStart(5)} | ${r1((wk2win / N) * 100).toString().padStart(5)}%`);
}
console.log("\n(Smaller gap + smaller stdev = tighter race. Lower wk2-leader-wins = more late volatility.)\n");
