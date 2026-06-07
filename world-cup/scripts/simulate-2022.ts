// "If we'd run this pool at the 2022 World Cup" — REAL Qatar 2022 results
// (32 teams, all 64 matches) scored by our ACTUAL engine, with an 8-owner
// snake draft (32 teams / 4). Run:
//   node --experimental-strip-types world-cup/scripts/simulate-2022.ts

import { scoreOwner, rankOwners } from "../lib/scoring.ts";

// id, name, FIFA rank (≈ Oct 2022). Index = country id.
const TEAMS = [
  ["Netherlands", 8], ["Senegal", 18], ["Ecuador", 44], ["Qatar", 50],       // A
  ["England", 5], ["USA", 16], ["Iran", 20], ["Wales", 19],                   // B
  ["Argentina", 3], ["Poland", 26], ["Mexico", 13], ["Saudi Arabia", 51],     // C
  ["France", 4], ["Australia", 38], ["Tunisia", 30], ["Denmark", 10],         // D
  ["Japan", 24], ["Spain", 7], ["Germany", 11], ["Costa Rica", 31],           // E
  ["Morocco", 22], ["Croatia", 12], ["Belgium", 2], ["Canada", 41],           // F
  ["Brazil", 1], ["Switzerland", 15], ["Cameroon", 43], ["Serbia", 21],       // G
  ["Portugal", 9], ["South Korea", 28], ["Uruguay", 14], ["Ghana", 61],       // H
] as Array<[string, number]>;
const NAME = (id: number) => TEAMS[id][0];
const fifaRank = (id: number) => TEAMS[id][1];

// Every match: [home, away, homeGoals(reg+ET), awayGoals, week, stage, homePens?, awayPens?]
// week: 1 = group MD1-2, 2 = group MD3 + R16, 3 = QF + SF, 4 = 3rd + Final
type Row = [number, number, number, number, number, string, number?, number?];
const G: Row[] = [
  // Group A
  [3, 2, 0, 2, 1, "group"], [1, 0, 0, 2, 1, "group"], [3, 1, 1, 3, 1, "group"], [0, 2, 1, 1, 1, "group"], [2, 1, 1, 2, 2, "group"], [0, 3, 2, 0, 2, "group"],
  // Group B
  [4, 6, 6, 2, 1, "group"], [5, 7, 1, 1, 1, "group"], [7, 6, 0, 2, 1, "group"], [4, 5, 0, 0, 1, "group"], [7, 4, 0, 3, 2, "group"], [6, 5, 0, 1, 2, "group"],
  // Group C
  [8, 11, 1, 2, 1, "group"], [10, 9, 0, 0, 1, "group"], [9, 11, 2, 0, 1, "group"], [8, 10, 2, 0, 1, "group"], [9, 8, 0, 2, 2, "group"], [11, 10, 1, 2, 2, "group"],
  // Group D
  [15, 14, 0, 0, 1, "group"], [12, 13, 4, 1, 1, "group"], [14, 13, 0, 1, 1, "group"], [12, 15, 2, 1, 1, "group"], [13, 15, 1, 0, 2, "group"], [14, 12, 1, 0, 2, "group"],
  // Group E
  [18, 16, 1, 2, 1, "group"], [17, 19, 7, 0, 1, "group"], [16, 19, 0, 1, 1, "group"], [17, 18, 1, 1, 1, "group"], [16, 17, 2, 1, 2, "group"], [19, 18, 2, 4, 2, "group"],
  // Group F
  [20, 21, 0, 0, 1, "group"], [22, 23, 1, 0, 1, "group"], [22, 20, 0, 2, 1, "group"], [21, 23, 4, 1, 1, "group"], [23, 20, 1, 2, 2, "group"], [21, 22, 0, 0, 2, "group"],
  // Group G
  [25, 26, 1, 0, 1, "group"], [24, 27, 2, 0, 1, "group"], [26, 27, 3, 3, 1, "group"], [24, 25, 1, 0, 1, "group"], [27, 25, 2, 3, 2, "group"], [26, 24, 1, 0, 2, "group"],
  // Group H
  [30, 29, 0, 0, 1, "group"], [28, 31, 3, 2, 1, "group"], [29, 31, 2, 3, 1, "group"], [28, 30, 2, 0, 1, "group"], [31, 30, 0, 2, 2, "group"], [29, 28, 2, 1, 2, "group"],
];
const KO: Row[] = [
  // Round of 16 (week 2)
  [0, 5, 3, 1, 2, "r16"], [8, 13, 2, 1, 2, "r16"], [12, 9, 3, 1, 2, "r16"], [4, 1, 3, 0, 2, "r16"],
  [16, 21, 1, 1, 2, "r16", 1, 3], [24, 29, 4, 1, 2, "r16"], [20, 17, 0, 0, 2, "r16", 3, 0], [28, 25, 6, 1, 2, "r16"],
  // Quarterfinals (week 3)
  [21, 24, 1, 1, 3, "qf", 4, 2], [0, 8, 2, 2, 3, "qf", 3, 4], [20, 28, 1, 0, 3, "qf"], [4, 12, 1, 2, 3, "qf"],
  // Semifinals (week 3)
  [8, 21, 3, 0, 3, "sf"], [12, 20, 2, 0, 3, "sf"],
  // Third place + Final (week 4)
  [21, 20, 2, 1, 4, "third"], [8, 12, 3, 3, 4, "final", 4, 2],
];

const ROWS = [...G, ...KO];
const matches = ROWS.map((r, i) => ({
  id: `m${i}`, stage: r[5], status: "final" as const,
  home_country_id: r[0], away_country_id: r[1], home_goals: r[2], away_goals: r[3],
  went_to_shootout: r[6] != null, home_pens: r[6] ?? null, away_pens: r[7] ?? null, _week: r[4],
}));

// 8-owner snake draft, best available by FIFA rank.
const order = [3, 7, 1, 5, 0, 6, 2, 4]; // a fixed shuffled draft order
const pool = TEAMS.map((_, id) => id).sort((a, b) => fifaRank(a) - fifaRank(b));
const rosters: number[][] = Array.from({ length: 8 }, () => []);
let pick = 0;
for (let r = 0; r < 4; r++) { const seq = r % 2 === 0 ? order : [...order].reverse(); for (const o of seq) rosters[o].push(pool[pick++]); }

const owners = (upto: number) => {
  const ms = matches.filter((m) => m._week <= upto);
  return rosters.map((country_ids, i) => scoreOwner({ team_id: `O${i + 1}`, country_ids, owns_golden_boot: false }, ms as never, fifaRank));
};
const r1 = (n: number) => Math.round(n * 10) / 10;

console.log("\n=== If we'd run the pool at the 2022 World Cup (real results, our ruleset) ===\n");
console.log("Draft (8 owners x 4, snake, best available by FIFA rank):");
rosters.forEach((rs, i) => console.log(`  Owner ${i + 1}: ${rs.map(NAME).join(", ")}`));

console.log("\nWeekly cumulative owner points:");
const labels = ["Group MD1-2", "Group MD3 + R16", "QF + SF", "3rd + Final"];
for (let wk = 1; wk <= 4; wk++) {
  const ranked = rankOwners(owners(wk));
  const tot = ranked.map((o) => o.total);
  const max = Math.max(...tot), min = Math.min(...tot);
  console.log(`\n  Week ${wk} (${labels[wk - 1]})  ·  leader ${r1(max)}  last ${r1(min)}  spread ${r1(max - min)}`);
  console.log("   " + ranked.map((o) => `${o.team_id}:${r1(o.total)}`).join("  "));
}

console.log("\n=== Final standings ===");
const final = rankOwners(owners(4));
final.forEach((o, i) => {
  const idx = Number(o.team_id.slice(1)) - 1;
  console.log(`  ${String(i + 1).padStart(2)}. ${o.team_id}  ${r1(o.total)} pts   [${rosters[idx].map(NAME).join(", ")}]`);
});
const champOwner = rosters.findIndex((r) => r.includes(8)); // Argentina = champion
console.log(`\n  Champion Argentina was owned by O${champOwner + 1}, who finished ${final.findIndex((o) => o.team_id === `O${champOwner + 1}`) + 1}.`);
console.log("");
