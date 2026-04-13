import { describe, test, expect } from "vitest";
import {
  teamOnTheClock,
  pickMeta,
  randomizeDraftOrder,
} from "../lib/draft";
import type { Team } from "../lib/types";

function mkTeam(id: string, position: number): Team {
  return {
    id,
    league_id: "L",
    owner_id: `owner-${id}`,
    name: id,
    draft_position: position,
    created_at: new Date().toISOString(),
  };
}

describe("teamOnTheClock (snake draft)", () => {
  // 3 teams in fixed draft order: A, B, C
  const teams: Team[] = [mkTeam("A", 1), mkTeam("B", 2), mkTeam("C", 3)];

  test("round 1 goes A → B → C", () => {
    expect(teamOnTheClock(teams, 0).id).toBe("A");
    expect(teamOnTheClock(teams, 1).id).toBe("B");
    expect(teamOnTheClock(teams, 2).id).toBe("C");
  });

  test("round 2 snakes back C → B → A", () => {
    expect(teamOnTheClock(teams, 3).id).toBe("C");
    expect(teamOnTheClock(teams, 4).id).toBe("B");
    expect(teamOnTheClock(teams, 5).id).toBe("A");
  });

  test("round 3 goes A → B → C again", () => {
    expect(teamOnTheClock(teams, 6).id).toBe("A");
    expect(teamOnTheClock(teams, 7).id).toBe("B");
    expect(teamOnTheClock(teams, 8).id).toBe("C");
  });

  test("end of round 4 snakes C → B → A", () => {
    expect(teamOnTheClock(teams, 9).id).toBe("C");
    expect(teamOnTheClock(teams, 10).id).toBe("B");
    expect(teamOnTheClock(teams, 11).id).toBe("A");
  });

  test("2-team draft alternates cleanly", () => {
    const two: Team[] = [mkTeam("X", 1), mkTeam("Y", 2)];
    const sequence = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => teamOnTheClock(two, i).id);
    // Round 1: X Y   Round 2: Y X   Round 3: X Y   Round 4: Y X
    expect(sequence).toEqual(["X", "Y", "Y", "X", "X", "Y", "Y", "X"]);
  });

  test("single team always picks", () => {
    const solo: Team[] = [mkTeam("Only", 1)];
    expect(teamOnTheClock(solo, 0).id).toBe("Only");
    expect(teamOnTheClock(solo, 5).id).toBe("Only");
  });
});

describe("pickMeta", () => {
  test("pick index 0 is round 1 / pick 1", () => {
    expect(pickMeta(0, 3)).toEqual({ round: 1, pick_number: 1 });
  });

  test("pick index 2 is round 1 / pick 3 with 3 teams", () => {
    expect(pickMeta(2, 3)).toEqual({ round: 1, pick_number: 3 });
  });

  test("pick index 3 is round 2 / pick 4 with 3 teams", () => {
    expect(pickMeta(3, 3)).toEqual({ round: 2, pick_number: 4 });
  });

  test("pick 20 with 10 teams is round 3 / pick 21", () => {
    expect(pickMeta(20, 10)).toEqual({ round: 3, pick_number: 21 });
  });
});

describe("randomizeDraftOrder", () => {
  test("preserves every item", () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = randomizeDraftOrder(src);
    expect(shuffled.length).toBe(src.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([...src].sort((a, b) => a - b));
  });

  test("does not mutate the source array", () => {
    const src = [1, 2, 3, 4, 5];
    const snapshot = [...src];
    randomizeDraftOrder(src);
    expect(src).toEqual(snapshot);
  });

  test("eventually produces a different order given enough tries", () => {
    // Probabilistic: over 20 tries of shuffling a 6-element array we should
    // at least once get something that isn't the identity permutation.
    const src = [1, 2, 3, 4, 5, 6];
    let everDifferent = false;
    for (let i = 0; i < 20; i++) {
      const shuffled = randomizeDraftOrder(src);
      if (shuffled.some((v, j) => v !== src[j])) {
        everDifferent = true;
        break;
      }
    }
    expect(everDifferent).toBe(true);
  });
});
