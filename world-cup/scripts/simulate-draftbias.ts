// Does the draft slot (who got the #1 pick, etc.) actually create a runaway?
// Measures pool win-rate and average finish by each owner's round-1 draft
// slot, under the current adopted rules. Also shows the sum-of-FIFA-ranks per
// owner (relevant to a rank-sum "startup points" handicap).
// Run: node --experimental-strip-types world-cup/scripts/simulate-draftbias.ts

const TEAMS = Array.from({ length: 48 }, (_, i) => ({ id: i, rank: i + 1 }));
const fifaRank = (id: number) => TEAMS[id].rank;
const rating = (id: number) => (48 - TEAMS[id].rank) / 47;
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
// Returns rosters + each owner's round-1 pick rank (their "draft slot", 1-12).
function draft(seed: number) {
  const rng = mulberry32(seed * 7 + 1); const order = Array.from({ length: 12 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rosters: number[][] = Array.from({ length: 12 }, () => []); const slot: number[] = new Array(12);
  const pool = TEAMS.map((t) => t.id).sort((a, b) => fifaRank(a) - fifaRank(b)); let pick = 0;
  for (let r = 0; r < 4; r++) { const seq = r % 2 === 0 ? order : [...order].reverse(); for (const o of seq) { if (r === 0) slot[o] = pick + 1; rosters[o].push(pool[pick++]); } }
  return { rosters, slot };
}

const ADV: Record<string, number> = { group: 0, r32: 2, r16: 2, qf: 2, sf: 2, third: 0, final: 2 };
const MULT = (s: string) => (s === "sf" || s === "final" ? 1.5 : 1);
function scoreCountry(cid: number, matches: M[]): number {
  let pts = 0; const stages = new Set<string>();
  for (const m of matches) {
    if (m.home_country_id !== cid && m.away_country_id !== cid) continue;
    stages.add(m.stage);
    const isHome = m.home_country_id === cid; const opp = isHome ? m.away_country_id : m.home_country_id;
    const gf = (isHome ? m.home_goals : m.away_goals) ?? 0; const ga = (isHome ? m.away_goals : m.home_goals) ?? 0;
    let base = gf - ga * 0.5; if (ga === 0) base += 1; let champ = 0;
    if (m.went_to_shootout) { const myP = (isHome ? m.home_pens : m.away_pens) ?? 0, opP = (isHome ? m.away_pens : m.home_pens) ?? 0; base += myP > opP ? 5 : 3; if (m.stage === "final" && myP > opP) champ = 18; }
    else if (gf > ga) { base += 3; if (m.stage === "group" && fifaRank(cid) > fifaRank(opp)) base += 5; if (m.stage === "final") champ = 18; }
    else if (gf === ga) base += 1;
    pts += base * MULT(m.stage) + champ;
  }
  for (const s of stages) pts += ADV[s] ?? 0;
  return pts;
}

const N = 8000;
// win[slot] = times the owner with that round-1 slot won the pool; finishSum for avg place.
const win = new Array(13).fill(0), finishSum = new Array(13).fill(0), rankSum = new Array(13).fill(0);
let startupWin = new Array(13).fill(0); // with a 15%-of-rank-sum startup handicap
for (let s = 0; s < N; s++) {
  const matches = simulateTournament(1000 + s); const { rosters, slot } = draft(1000 + s);
  const base = rosters.map((r) => r.reduce((a, id) => a + scoreCountry(id, matches), 0));
  const sums = rosters.map((r) => r.reduce((a, id) => a + fifaRank(id), 0)); // sum of FIFA rank numbers
  const startup = sums.map((x) => x * 0.15); // 15% of rank sum as startup points
  const withStartup = base.map((b, i) => b + startup[i]);
  const order = [...base.keys()].sort((a, b) => base[b] - base[a]);
  order.forEach((owner, place) => { finishSum[slot[owner]] += place + 1; rankSum[slot[owner]] += sums[owner]; });
  win[slot[base.indexOf(Math.max(...base))]]++;
  startupWin[slot[withStartup.indexOf(Math.max(...withStartup))]]++;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
console.log(`\nOver ${N} tournaments — by round-1 draft slot (1 = first overall pick):\n`);
console.log("slot | sum of FIFA ranks | win % (no handicap) | avg finish | win % (+15% rank-sum startup)");
console.log("-".repeat(92));
for (let s = 1; s <= 12; s++) {
  console.log(`${String(s).padStart(4)} | ${String(r1(rankSum[s] / N)).padStart(17)} | ${(r1((win[s] / N) * 100) + "%").padStart(19)} | ${String(r1(finishSum[s] / N)).padStart(10)} | ${(r1((startupWin[s] / N) * 100) + "%").padStart(28)}`);
}
console.log(`\n(Even win % would be ${r1(100 / 12)}%. Even avg finish would be 6.5.)\n`);
