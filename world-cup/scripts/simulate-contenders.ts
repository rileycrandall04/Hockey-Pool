// "How many owners are alive going into the final?" For each tournament we
// enumerate plausible final + third-place outcomes and count how many owners
// could still finish 1st. Goal: maximize the share of pools with 2-4 live
// contenders on finals day. Parameterized scorer; production untouched.
// Run: node --experimental-strip-types world-cup/scripts/simulate-contenders.ts

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
function simulateTournament(seed: number) {
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
  const t1 = koLoser(sf.played[0]), t2 = koLoser(sf.played[1]);
  return { matches, finalists: [sf.w[0], sf.w[1]] as [number, number], thirdPair: [t1, t2] as [number, number] };
}
function draft(seed: number): number[][] { const rng = mulberry32(seed * 7 + 1); const order = Array.from({ length: 12 }, (_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } const rosters: number[][] = Array.from({ length: 12 }, () => []); const pool = TEAMS.map((t) => t.id).sort((a, b) => fifaRank(a) - fifaRank(b)); let pick = 0; for (let r = 0; r < 4; r++) { const seq = r % 2 === 0 ? order : [...order].reverse(); for (const o of seq) rosters[o].push(pool[pick++]); } return rosters; }

type Cfg = { goal: number; cs: number; win: number; draw: number; upset: number; champion: number; adv: Record<string, number>; mult: Record<string, number> };
function scoreCountry(cid: number, matches: M[], cfg: Cfg): number {
  let pts = 0; const stages = new Set<string>();
  for (const m of matches) {
    if (m.home_country_id !== cid && m.away_country_id !== cid) continue;
    stages.add(m.stage);
    const isHome = m.home_country_id === cid; const opp = isHome ? m.away_country_id : m.home_country_id;
    const gf = (isHome ? m.home_goals : m.away_goals) ?? 0; const ga = (isHome ? m.away_goals : m.home_goals) ?? 0;
    let base = gf * cfg.goal - ga * 0.5; if (ga === 0) base += cfg.cs;
    if (m.went_to_shootout) { base += cfg.draw; const myP = (isHome ? m.home_pens : m.away_pens) ?? 0, opP = (isHome ? m.away_pens : m.home_pens) ?? 0; base += myP > opP ? 4 : 2; if (m.stage === "final" && myP > opP) base += cfg.champion; }
    else if (gf > ga) { base += cfg.win; if (m.stage === "group" && fifaRank(cid) > fifaRank(opp)) base += cfg.upset; if (m.stage === "final") base += cfg.champion; }
    else if (gf === ga) base += cfg.draw;
    pts += base * (cfg.mult[m.stage] ?? 1);
  }
  for (const s of stages) pts += cfg.adv[s] ?? 0;
  return pts;
}
const ownerOf = (rosters: number[][], team: number) => rosters.findIndex((r) => r.includes(team));

// Enumerated finals-day outcomes (home vs away of each match).
const FIN = [[1, 0, false], [2, 1, false], [0, 1, false], [1, 2, false], [0, 0, true, 4, 3], [0, 0, true, 3, 4], [2, 2, true, 4, 3], [2, 2, true, 3, 4]] as Array<[number, number, boolean, number?, number?]>;
const THIRD = [[1, 0, false], [0, 1, false]] as Array<[number, number, boolean]>;
const mk = (stage: string, h: number, a: number, o: [number, number, boolean, number?, number?]): M => ({ stage, home_country_id: h, away_country_id: a, home_goals: o[0], away_goals: o[1], went_to_shootout: o[2], home_pens: o[3] ?? null, away_pens: o[4] ?? null });

function liveContenders(rosters: number[][], sim: ReturnType<typeof simulateTournament>, cfg: Cfg): number {
  const base = sim.matches.filter((m) => m.stage !== "final" && m.stage !== "third");
  const baseTot = rosters.map((r) => r.reduce((s, id) => s + scoreCountry(id, base, cfg), 0));
  const [F1, F2] = sim.finalists, [T1, T2] = sim.thirdPair;
  const oF1 = ownerOf(rosters, F1), oF2 = ownerOf(rosters, F2), oT1 = ownerOf(rosters, T1), oT2 = ownerOf(rosters, T2);
  const winnersSet = new Set<number>();
  for (const f of FIN) for (const t of THIRD) {
    const fm = mk("final", F1, F2, f), tm = mk("third", T1, T2, t);
    const tot = [...baseTot];
    tot[oF1] += scoreCountry(F1, [fm], cfg); tot[oF2] += scoreCountry(F2, [fm], cfg);
    tot[oT1] += scoreCountry(T1, [tm], cfg); tot[oT2] += scoreCountry(T2, [tm], cfg);
    let best = -Infinity, bi = -1; for (let i = 0; i < 12; i++) if (tot[i] > best) { best = tot[i]; bi = i; }
    winnersSet.add(bi);
  }
  return winnersSet.size;
}

const ADV = { r32: 1, r16: 2, qf: 3, sf: 4, final: 5 };
const M1 = { group: 1, r32: 1, r16: 1, qf: 1, sf: 1, third: 1, final: 1 };
const base = { goal: 1, cs: 1, win: 3, draw: 1, upset: 5, adv: ADV };
const CONFIGS: Array<{ name: string; cfg: Cfg }> = [
  { name: "Baseline (champ 8)", cfg: { ...base, champion: 8, mult: M1 } },
  { name: "champ 12", cfg: { ...base, champion: 12, mult: M1 } },
  { name: "champ 16", cfg: { ...base, champion: 16, mult: M1 } },
  { name: "champ 20", cfg: { ...base, champion: 20, mult: M1 } },
  { name: "champ 10 + final x1.5", cfg: { ...base, champion: 10, mult: { ...M1, final: 1.5 } } },
  { name: "champ 12 + SF/Final x1.5", cfg: { ...base, champion: 12, mult: { ...M1, sf: 1.5, final: 1.5 } } },
];

const N = 2000;
console.log(`\nOver ${N} tournaments — owners still alive going into the final (want lots of 2-4):\n`);
console.log("Variant                       | avg live | =1 (decided) | 2-4 alive | 5+ alive");
console.log("-".repeat(80));
for (const { name, cfg } of CONFIGS) {
  let sum = 0; const dist = [0, 0, 0, 0]; // [=1, 2-4, 5+, n/a]
  for (let s = 0; s < N; s++) {
    const sim = simulateTournament(1000 + s); const rosters = draft(1000 + s);
    const c = liveContenders(rosters, sim, cfg); sum += c;
    if (c <= 1) dist[0]++; else if (c <= 4) dist[1]++; else dist[2]++;
  }
  console.log(`${name.padEnd(29)} | ${r(sum / N).padStart(8)} | ${(r((dist[0] / N) * 100) + "%").padStart(12)} | ${(r((dist[1] / N) * 100) + "%").padStart(9)} | ${(r((dist[2] / N) * 100) + "%").padStart(8)}`);
}
function r(n: number) { return String(Math.round(n * 10) / 10); }
console.log("\n=1 = one owner already clinched (final is dead). 2-4 = genuine finals-day race. 5+ = wide open / undecided.\n");
