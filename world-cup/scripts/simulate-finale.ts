// "Make it come down to the final" sweep. Tests late-round multipliers (and a
// big champion bonus) and measures how often the FINAL actually flips the pool
// winner. Parameterized scorer; production untouched.
// Run: node --experimental-strip-types world-cup/scripts/simulate-finale.ts

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
function mulberry32(seed: number) { return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function poisson(l: number, rng: () => number) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rng(); } while (p > L); return k - 1; }
function simScore(a: number, b: number, rng: () => number) { const d = rating(a) - rating(b); return [poisson(1.35 * Math.exp(0.9 * d), rng), poisson(1.35 * Math.exp(-0.9 * d), rng)] as const; }
type M = { stage: string; home_country_id: number; away_country_id: number; home_goals: number; away_goals: number; went_to_shootout: boolean; home_pens: number | null; away_pens: number | null };
function ko(a: number, b: number, stage: string, rng: () => number): M { let [ga, gb] = simScore(a, b, rng); let s = false, pa: number | null = null, pb: number | null = null; if (ga === gb) { s = true; if (rng() < 0.5 + 0.15 * (rating(a) - rating(b))) { pa = 4; pb = 3; } else { pa = 3; pb = 4; } } return { stage, home_country_id: a, away_country_id: b, home_goals: ga, away_goals: gb, went_to_shootout: s, home_pens: pa, away_pens: pb }; }
const koWinner = (m: M) => m.went_to_shootout ? ((m.home_pens ?? 0) > (m.away_pens ?? 0) ? m.home_country_id : m.away_country_id) : (m.home_goals > m.away_goals ? m.home_country_id : m.away_country_id);
const koLoser = (m: M) => koWinner(m) === m.home_country_id ? m.away_country_id : m.home_country_id;
function simulateTournament(seed: number): M[] {
  const rng = mulberry32(seed);
  const shuffle = <T,>(arr: T[]) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pots = [0, 1, 2, 3].map((p) => shuffle(TEAMS.slice(p * 12, p * 12 + 12).map((t) => t.id)));
  const groups: number[][] = Array.from({ length: 12 }, (_, g) => pots.map((pot) => pot[g]));
  const matches: M[] = []; const st = new Map<number, { p: number; gf: number; ga: number }>(); for (const t of TEAMS) st.set(t.id, { p: 0, gf: 0, ga: 0 });
  const sched: Array<[number, number]> = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
  for (const grp of groups) for (const [i, j] of sched) { const [hg, ag] = simScore(grp[i], grp[j], rng); const sh = st.get(grp[i])!, sa = st.get(grp[j])!; sh.gf += hg; sh.ga += ag; sa.gf += ag; sa.ga += hg; if (hg > ag) sh.p += 3; else if (hg < ag) sa.p += 3; else { sh.p++; sa.p++; } matches.push({ stage: "group", home_country_id: grp[i], away_country_id: grp[j], home_goals: hg, away_goals: ag, went_to_shootout: false, home_pens: null, away_pens: null }); }
  const cmp = (x: number, y: number) => { const a = st.get(x)!, b = st.get(y)!; return b.p - a.p || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf; };
  const winners: number[] = [], runners: number[] = [], thirds: number[] = [];
  for (const grp of groups) { const o = [...grp].sort(cmp); winners.push(o[0]); runners.push(o[1]); thirds.push(o[2]); }
  const adv = [...winners.sort(cmp), ...runners.sort(cmp), ...[...thirds].sort(cmp).slice(0, 8)];
  const round = (tin: number[], stage: string) => { const played: M[] = [], w: number[] = []; for (let i = 0; i < tin.length / 2; i++) { const m = ko(tin[i], tin[tin.length - 1 - i], stage, rng); played.push(m); w.push(koWinner(m)); } return { w, played }; };
  const r32 = round(adv, "r32"); matches.push(...r32.played);
  const r16 = round(r32.w, "r16"); matches.push(...r16.played);
  const qf = round(r16.w, "qf"); matches.push(...qf.played);
  const sf = round(qf.w, "sf"); matches.push(...sf.played);
  matches.push(ko(koLoser(sf.played[0]), koLoser(sf.played[1]), "third", rng));
  matches.push(ko(sf.w[0], sf.w[1], "final", rng));
  return matches;
}
function draft(seed: number): number[][] { const rng = mulberry32(seed * 7 + 1); const order = Array.from({ length: 12 }, (_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } const rosters: number[][] = Array.from({ length: 12 }, () => []); const pool = TEAMS.map((t) => t.id).sort((a, b) => fifaRank(a) - fifaRank(b)); let pick = 0; for (let r = 0; r < 4; r++) { const seq = r % 2 === 0 ? order : [...order].reverse(); for (const o of seq) rosters[o].push(pool[pick++]); } return rosters; }

type Cfg = { goal: number; cs: number; win: number; draw: number; upset: number; champion: number; adv: Record<string, number>; mult: Record<string, number>; bestN: number };
function scoreCountry(cid: number, matches: M[], cfg: Cfg): number {
  let pts = 0; const stages = new Set<string>();
  for (const m of matches) {
    if (m.home_country_id !== cid && m.away_country_id !== cid) continue;
    stages.add(m.stage);
    const isHome = m.home_country_id === cid;
    const opp = isHome ? m.away_country_id : m.home_country_id;
    const gf = (isHome ? m.home_goals : m.away_goals) ?? 0;
    const ga = (isHome ? m.away_goals : m.home_goals) ?? 0;
    let base = gf * cfg.goal - ga * 0.5;
    if (ga === 0) base += cfg.cs;
    if (m.went_to_shootout) { base += cfg.draw; const myP = (isHome ? m.home_pens : m.away_pens) ?? 0, opP = (isHome ? m.away_pens : m.home_pens) ?? 0; base += myP > opP ? 4 : 2; if (m.stage === "final" && myP > opP) base += cfg.champion; }
    else if (gf > ga) { base += cfg.win; if (m.stage === "group" && fifaRank(cid) > fifaRank(opp)) base += cfg.upset; if (m.stage === "final") base += cfg.champion; }
    else if (gf === ga) base += cfg.draw;
    pts += base * (cfg.mult[m.stage] ?? 1);
  }
  for (const s of stages) pts += cfg.adv[s] ?? 0;
  return pts;
}
const ownerTotals = (rosters: number[][], matches: M[], cfg: Cfg) => rosters.map((r) => r.map((id) => scoreCountry(id, matches, cfg)).sort((a, b) => b - a).slice(0, cfg.bestN).reduce((s, x) => s + x, 0));
const r1 = (n: number) => Math.round(n * 10) / 10;

const ADV = { r32: 1, r16: 2, qf: 3, sf: 4, final: 5 };
const M1 = { group: 1, r32: 1, r16: 1, qf: 1, sf: 1, third: 1, final: 1 };
const baseCfg = { goal: 1, cs: 1, win: 3, draw: 1, upset: 5, champion: 8, adv: ADV, bestN: 4 };
const CONFIGS: Array<{ name: string; cfg: Cfg }> = [
  { name: "Baseline (no multiplier)", cfg: { ...baseCfg, mult: M1 } },
  { name: "KO escalator (QF2 SF3 Fin4)", cfg: { ...baseCfg, mult: { ...M1, r16: 1.5, qf: 2, sf: 3, final: 4 } } },
  { name: "Final points x3", cfg: { ...baseCfg, mult: { ...M1, final: 3 } } },
  { name: "Final points x5", cfg: { ...baseCfg, mult: { ...M1, final: 5 } } },
  { name: "Champion bonus 8 -> 25", cfg: { ...baseCfg, champion: 25, mult: M1 } },
];

const N = 3000;
console.log(`\nOver ${N} tournaments: how often does the FINAL flip the pool winner?\n`);
console.log("Variant                          | final-decides | ratio | stdev | champ-owner-wins");
console.log("-".repeat(92));
for (const { name, cfg } of CONFIGS) {
  let decides = 0, win = 0, last = 0, sd = 0, champWins = 0;
  for (let s = 0; s < N; s++) {
    const matches = simulateTournament(1000 + s); const rosters = draft(1000 + s);
    const before = ownerTotals(rosters, matches.filter((m) => m.stage !== "final" && m.stage !== "third"), cfg);
    const after = ownerTotals(rosters, matches, cfg);
    if (before.indexOf(Math.max(...before)) !== after.indexOf(Math.max(...after))) decides++;
    win += Math.max(...after); last += Math.min(...after);
    const mean = after.reduce((a, b) => a + b, 0) / after.length; sd += Math.sqrt(after.reduce((a, b) => a + (b - mean) ** 2, 0) / after.length);
    const fM = matches.find((m) => m.stage === "final")!; const champ = koWinner(fM);
    if (rosters.findIndex((r) => r.includes(champ)) === after.indexOf(Math.max(...after))) champWins++;
  }
  console.log(`${name.padEnd(32)} | ${(r1((decides / N) * 100) + "%").padStart(13)} | ${(r1(win / last) + "x").padStart(5)} | ${r1(sd / N).toString().padStart(5)} | ${(r1((champWins / N) * 100) + "%").padStart(16)}`);
}
console.log("\nfinal-decides = % of pools where the leader before the final is NOT the final winner (higher = comes down to the title game).\n");
