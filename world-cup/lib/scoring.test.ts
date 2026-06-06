import { describe, it, expect } from "vitest";
import {
  scoreCountry,
  scoreOwner,
  rankOwners,
  GOLDEN_BOOT_POINTS,
} from "./scoring";
import type { ScoringMatch, ScoredOwner } from "./types";

// FIFA ranks (lower = better) for the fictional test field.
const RANKS: Record<number, number> = {
  1: 3, // strong favorite
  2: 30, // mid
  3: 10, // good
  4: 48, // minnow
};
const rank = (id: number) => RANKS[id] ?? null;

function m(p: Partial<ScoringMatch> & Pick<ScoringMatch, "home_country_id" | "away_country_id">): ScoringMatch {
  return {
    id: Math.random().toString(36).slice(2),
    stage: "group",
    status: "final",
    home_goals: 0,
    away_goals: 0,
    went_to_shootout: false,
    home_pens: null,
    away_pens: null,
    ...p,
  };
}

describe("scoreCountry - group stage", () => {
  it("scores a favorite's clean-sheet win without an upset bonus", () => {
    // Team 1 (rank 3) beats team 2 (rank 30) 2-0.
    const s = scoreCountry(1, [m({ home_country_id: 1, away_country_id: 2, home_goals: 2, away_goals: 0 })], rank);
    expect(s.match_points).toBe(3);
    expect(s.goals_for_points).toBe(2);
    expect(s.goals_against_points).toBe(0);
    expect(s.clean_sheet_points).toBe(1);
    expect(s.upset_points).toBe(0); // favorite, no upset
    expect(s.total).toBe(6);
  });

  it("awards the upset bonus when a lower-ranked side wins", () => {
    // Team 4 (rank 48) beats team 1 (rank 3) 1-0 -> giant-killing.
    const s = scoreCountry(4, [m({ home_country_id: 4, away_country_id: 1, home_goals: 1, away_goals: 0 })], rank);
    expect(s.upset_points).toBe(5);
    // 3 (win) + 1 (GF) + 1 (CS) + 5 (upset) = 10
    expect(s.total).toBe(10);
  });

  it("does not award an upset for a draw", () => {
    const match = m({ home_country_id: 4, away_country_id: 1, home_goals: 1, away_goals: 1 });
    const s = scoreCountry(4, [match], rank);
    expect(s.upset_points).toBe(0);
    // 1 (draw) + 1 (GF) - 0.5 (GA) = 1.5
    expect(s.total).toBeCloseTo(1.5, 5);
  });

  it("charges -0.5 per goal conceded", () => {
    const s = scoreCountry(2, [m({ home_country_id: 1, away_country_id: 2, home_goals: 3, away_goals: 1 })], rank);
    // loss 0 + GF 1 - 0.5*3 = -0.5
    expect(s.total).toBeCloseTo(-0.5, 5);
  });
});

describe("scoreCountry - knockout & shootouts", () => {
  it("scores a shootout win as a draw + win bonus and excludes PKs from goals", () => {
    const match = m({
      stage: "r16",
      home_country_id: 1,
      away_country_id: 3,
      home_goals: 1,
      away_goals: 1,
      went_to_shootout: true,
      home_pens: 4,
      away_pens: 3,
    });
    const s = scoreCountry(1, [match], rank);
    // 1 (draw) + 4 (SO win) = 5 match points; PKs not counted as goals
    expect(s.match_points).toBe(5);
    expect(s.goals_for).toBe(1);
    // + GF 1 - 0.5 (GA) + advancement r16 (2) = 5 + 0.5 + 2 = 7.5
    expect(s.total).toBeCloseTo(7.5, 5);
  });

  it("scores a shootout loss as a draw + loss bonus", () => {
    const match = m({
      stage: "r16",
      home_country_id: 1,
      away_country_id: 3,
      home_goals: 1,
      away_goals: 1,
      went_to_shootout: true,
      home_pens: 4,
      away_pens: 3,
    });
    const s = scoreCountry(3, [match], rank);
    // 1 (draw) + 2 (SO loss) = 3 match points
    expect(s.match_points).toBe(3);
    // + GF 1 - 0.5 + advancement r16 (2) = 3 + 0.5 + 2 = 5.5
    expect(s.total).toBeCloseTo(5.5, 5);
  });
});

describe("scoreCountry - advancement & champion", () => {
  const champPath: ScoringMatch[] = [
    m({ stage: "r32", home_country_id: 1, away_country_id: 2, home_goals: 1, away_goals: 0 }),
    m({ stage: "r16", home_country_id: 1, away_country_id: 3, home_goals: 2, away_goals: 1 }),
    m({ stage: "qf", home_country_id: 1, away_country_id: 4, home_goals: 1, away_goals: 0 }),
    m({ stage: "sf", home_country_id: 1, away_country_id: 2, home_goals: 3, away_goals: 1 }),
    m({ stage: "final", home_country_id: 1, away_country_id: 3, home_goals: 1, away_goals: 0 }),
  ];

  it("sums one-time advancement bonuses across the bracket", () => {
    const s = scoreCountry(1, champPath, rank);
    // r32 1 + r16 2 + qf 3 + sf 4 + final 5 = 15
    expect(s.advancement_points).toBe(15);
  });

  it("adds the champion bonus for winning the final", () => {
    const s = scoreCountry(1, champPath, rank);
    expect(s.champion_points).toBe(8);
    expect(s.furthest_stage).toBe("final");
  });

  it("grants advancement for a scheduled (not-yet-played) match but no result points", () => {
    const s = scoreCountry(1, [m({ stage: "qf", status: "scheduled", home_country_id: 1, away_country_id: 4 })], rank);
    expect(s.advancement_points).toBe(3); // reached the QF
    expect(s.match_points).toBe(0); // not played yet
    expect(s.total).toBe(3);
  });

  it("treats a third-place game as reaching the semifinal with no extra advancement", () => {
    const s = scoreCountry(1, [m({ stage: "third", home_country_id: 1, away_country_id: 2, home_goals: 2, away_goals: 0 })], rank);
    expect(s.advancement_points).toBe(0); // third grants no bonus
    expect(s.furthest_stage).toBe("third");
  });
});

describe("scoreOwner & rankOwners", () => {
  const matches: ScoringMatch[] = [
    m({ home_country_id: 1, away_country_id: 2, home_goals: 2, away_goals: 0 }), // 1 beats 2
    m({ home_country_id: 3, away_country_id: 4, home_goals: 0, away_goals: 1 }), // 4 upsets 3
  ];

  it("rolls drafted countries plus the golden boot into one total", () => {
    const owner = scoreOwner(
      { team_id: "t1", country_ids: [1, 4], owns_golden_boot: true },
      matches,
      rank,
    );
    // country 1: 6, country 4: 10 (upset), + golden boot 5 = 21
    expect(owner.total).toBe(6 + 10 + GOLDEN_BOOT_POINTS);
    expect(owner.golden_boot_points).toBe(5);
  });

  it("applies commissioner adjustments", () => {
    const owner = scoreOwner(
      { team_id: "t1", country_ids: [2], owns_golden_boot: false, adjustment_points: -3 },
      matches,
      rank,
    );
    // country 2: loss 0 + GF 0 - 0.5*2 = -1, minus 3 = -4
    expect(owner.total).toBeCloseTo(-4, 5);
  });

  it("breaks ties by goals, then furthest stage, then over/under", () => {
    const base = (over: number | null): ScoredOwner["tiebreak"] => ({
      goals_for: 5,
      furthest_stage_order: 4,
      over_under_guess: over,
    });
    const owners: ScoredOwner[] = [
      { team_id: "A", countries: [], golden_boot_points: 0, adjustment_points: 0, total: 50, tiebreak: { goals_for: 5, furthest_stage_order: 4, over_under_guess: 70 } },
      { team_id: "B", countries: [], golden_boot_points: 0, adjustment_points: 0, total: 50, tiebreak: { goals_for: 8, furthest_stage_order: 2, over_under_guess: 40 } },
      { team_id: "C", countries: [], golden_boot_points: 0, adjustment_points: 0, total: 60, tiebreak: base(null) },
    ];
    const ranked = rankOwners(owners);
    expect(ranked.map((o) => o.team_id)).toEqual(["C", "B", "A"]);
    // C leads on points; B beats A on goals despite A's closer over/under.
  });

  it("uses over/under as the last resort when points, goals and stage all tie", () => {
    const owners: ScoredOwner[] = [
      { team_id: "far", countries: [], golden_boot_points: 0, adjustment_points: 0, total: 50, tiebreak: { goals_for: 5, furthest_stage_order: 4, over_under_guess: 60 } },
      { team_id: "close", countries: [], golden_boot_points: 0, adjustment_points: 0, total: 50, tiebreak: { goals_for: 5, furthest_stage_order: 4, over_under_guess: 48 } },
    ];
    const ranked = rankOwners(owners);
    expect(ranked[0].team_id).toBe("close"); // |50-48| < |50-60|
  });
});
