import { describe, test, expect } from "vitest";
import {
  pointsForPlayer,
  scoreTeam,
  generateJoinCode,
} from "../lib/scoring";
import type { RosterEntry, Position } from "../lib/types";

function mkPlayer(overrides: {
  position?: Position;
  fantasy_points: number;
  goals?: number;
  games_played?: number;
  name?: string;
}): RosterEntry {
  const fp = overrides.fantasy_points;
  return {
    league_id: "L",
    team_id: "T",
    player_id: Math.floor(Math.random() * 1_000_000),
    round: 1,
    pick_number: 1,
    full_name: overrides.name ?? `P-${fp}`,
    position: overrides.position ?? "C",
    nhl_team_id: 1,
    nhl_abbrev: "TOR",
    nhl_logo: null,
    goals: overrides.goals ?? 0,
    assists: 0,
    ot_goals: 0,
    fantasy_points: fp,
    games_played: overrides.games_played ?? 0,
  };
}

describe("pointsForPlayer", () => {
  test("one point per goal, one per assist", () => {
    expect(pointsForPlayer({ goals: 2, assists: 3, ot_goals: 0 })).toBe(5);
  });

  test("OT goal is worth 3 total (1 goal + 2 bonus)", () => {
    // A player who scored one OT goal: goals=1, ot_goals=1
    // Expected: 1 (base goal) + 0 (assist) + 2 (OT bonus) = 3
    expect(pointsForPlayer({ goals: 1, assists: 0, ot_goals: 1 })).toBe(3);
  });

  test("mixed line: 3 G (1 OT) + 5 A", () => {
    // 3 + 5 + 2*1 = 10
    expect(pointsForPlayer({ goals: 3, assists: 5, ot_goals: 1 })).toBe(10);
  });

  test("zero stats is zero points", () => {
    expect(pointsForPlayer({ goals: 0, assists: 0, ot_goals: 0 })).toBe(0);
  });
});

describe("scoreTeam: basic top-10 selection", () => {
  test("takes the top 10 by points, benches the rest", () => {
    const roster: RosterEntry[] = [];
    for (let i = 0; i < 10; i++) {
      roster.push(mkPlayer({ position: "C", fantasy_points: 30 - i }));
    }
    // 2 defensemen so the D rule is already satisfied
    roster.push(mkPlayer({ position: "D", fantasy_points: 15 }));
    roster.push(mkPlayer({ position: "D", fantasy_points: 14 }));

    const result = scoreTeam(roster);
    expect(result.scoring.length).toBe(10);
    expect(result.bench.length).toBe(2);

    // Top 10 by raw points: F0..F7 (30..23) plus both D (15, 14)?
    // Actually the forwards alone have: 30,29,28,27,26,25,24,23,22,21
    // So top 10 greedily = 10 forwards, bench = 2 D.
    // BUT the D rule kicks in: needs 2 D, none in top 10 → swap.
    // After swap: F0..F7 (30..23) + D(15) + D(14) = 212 + 29 = 241.
    const expectedTotal =
      30 + 29 + 28 + 27 + 26 + 25 + 24 + 23 + 15 + 14;
    expect(result.totalPoints).toBe(expectedTotal);
  });

  test("tiebreak: same points → prefer more goals, then more games", () => {
    const roster: RosterEntry[] = [
      mkPlayer({ fantasy_points: 10, goals: 5 }),
      mkPlayer({ fantasy_points: 10, goals: 3 }),
      mkPlayer({ fantasy_points: 10, goals: 4 }),
    ];
    const result = scoreTeam(roster, { scoringRosterSize: 3, requiredDefensemen: 0 });
    expect(result.scoring.map((p) => p.goals)).toEqual([5, 4, 3]);
  });
});

describe("scoreTeam: 2-D rule enforcement", () => {
  test("promotes lower-scoring D over higher-scoring forwards", () => {
    // 10 forwards dominate the leaderboard, 2 weak D at the bottom.
    // Expected: top 10 becomes 8 forwards + 2 D.
    const forwardPoints = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11];
    const roster: RosterEntry[] = [
      ...forwardPoints.map((fp, i) =>
        mkPlayer({ position: "C", fantasy_points: fp, name: `F${i}` }),
      ),
      mkPlayer({ position: "D", fantasy_points: 2, name: "D1" }),
      mkPlayer({ position: "D", fantasy_points: 1, name: "D2" }),
    ];

    const result = scoreTeam(roster);
    const dCount = result.scoring.filter((p) => p.position === "D").length;
    expect(dCount).toBe(2);
    expect(result.scoring.length).toBe(10);

    // Scoring: F0..F7 (20..13) + D1(2) + D2(1)
    // = (20+19+18+17+16+15+14+13) + 2 + 1
    // = 132 + 3 = 135
    expect(result.totalPoints).toBe(132 + 3);

    // Bench: F8(12), F9(11) — the two lowest forwards that got kicked out
    const benchNames = result.bench.map((p) => p.full_name).sort();
    expect(benchNames).toEqual(["F8", "F9"]);
  });

  test("keeps existing D in the top 10 when they already scored their way in", () => {
    // 2 high-scoring D mixed in with mediocre forwards
    const roster: RosterEntry[] = [
      mkPlayer({ position: "D", fantasy_points: 50, name: "D1" }),
      mkPlayer({ position: "D", fantasy_points: 45, name: "D2" }),
      ...Array.from({ length: 10 }, (_, i) =>
        mkPlayer({ position: "C", fantasy_points: 30 - i, name: `F${i}` }),
      ),
    ];
    const result = scoreTeam(roster);
    // Top 10 by points: D1(50), D2(45), F0..F7 (30..23)
    // Already has 2 D → no swap needed
    expect(result.scoring.length).toBe(10);
    expect(result.scoring.filter((p) => p.position === "D").length).toBe(2);
    expect(result.totalPoints).toBe(50 + 45 + 30 + 29 + 28 + 27 + 26 + 25 + 24 + 23);
  });

  test("with only 1 D on the roster, scoring still returns something sensible", () => {
    // Edge case: team somehow only rostered one defenseman.
    // Algo should promote that one D and stop trying to swap in a second.
    const roster: RosterEntry[] = [
      ...Array.from({ length: 11 }, (_, i) =>
        mkPlayer({ position: "C", fantasy_points: 20 - i, name: `F${i}` }),
      ),
      mkPlayer({ position: "D", fantasy_points: 1, name: "D1" }),
    ];
    const result = scoreTeam(roster);
    expect(result.scoring.length).toBe(10);
    // Only 1 D available, so exactly 1 D in scoring
    expect(result.scoring.filter((p) => p.position === "D").length).toBe(1);
  });

  test("with zero D on the roster the rule cannot be satisfied — returns top 10", () => {
    const roster: RosterEntry[] = Array.from({ length: 12 }, (_, i) =>
      mkPlayer({ position: "C", fantasy_points: 20 - i, name: `F${i}` }),
    );
    const result = scoreTeam(roster);
    expect(result.scoring.length).toBe(10);
    expect(result.scoring.filter((p) => p.position === "D").length).toBe(0);
    // Top 10 raw points: 20..11 = 155
    expect(result.totalPoints).toBe(155);
  });

  test("configurable roster/scoring sizes", () => {
    const roster: RosterEntry[] = [
      mkPlayer({ position: "C", fantasy_points: 10 }),
      mkPlayer({ position: "C", fantasy_points: 8 }),
      mkPlayer({ position: "D", fantasy_points: 2 }),
      mkPlayer({ position: "D", fantasy_points: 1 }),
    ];
    // Ask for top 3 including at least 1 D
    const result = scoreTeam(roster, {
      rosterSize: 4,
      scoringRosterSize: 3,
      requiredDefensemen: 1,
    });
    expect(result.scoring.length).toBe(3);
    expect(result.scoring.filter((p) => p.position === "D").length).toBe(1);
    // Top 3 by points = C(10), C(8), D(2) after swap (originally C(10),C(8) no D)
    // Top 2 forwards, plus the higher of the two D = 10 + 8 + 2 = 20
    expect(result.totalPoints).toBe(20);
  });
});

describe("generateJoinCode", () => {
  test("returns a string of the requested length", () => {
    expect(generateJoinCode(6)).toHaveLength(6);
    expect(generateJoinCode(10)).toHaveLength(10);
  });

  test("avoids ambiguous characters (0/O/1/I/L)", () => {
    // Generate a bunch and make sure the alphabet constraint holds.
    for (let i = 0; i < 500; i++) {
      expect(generateJoinCode(8)).not.toMatch(/[01ILO]/);
    }
  });
});
