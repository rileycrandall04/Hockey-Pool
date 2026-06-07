import { describe, it, expect } from "vitest";
import { evenRosterSize, teamOnTheClock, pickMeta } from "./draft";

describe("evenRosterSize", () => {
  it("gives 4 each for a full 12-owner league", () => {
    expect(evenRosterSize(12)).toBe(4);
  });

  it("hands out more teams when there are fewer owners", () => {
    expect(evenRosterSize(8)).toBe(6); // 48 / 8
    expect(evenRosterSize(6)).toBe(8);
    expect(evenRosterSize(4)).toBe(12);
  });

  it("always returns an even number (fair snake), rounding down", () => {
    expect(evenRosterSize(9)).toBe(4); // floor(48/9)=5 -> even 4 (12 unused)
    expect(evenRosterSize(7)).toBe(6); // floor(48/7)=6
    expect(evenRosterSize(5)).toBe(8); // floor(48/5)=9 -> even 8
    expect(evenRosterSize(11)).toBe(4); // floor(48/11)=4
  });

  it("returns 0 when more than 24 owners can't get an even share", () => {
    expect(evenRosterSize(24)).toBe(2);
    expect(evenRosterSize(25)).toBe(0);
  });
});

describe("teamOnTheClock (snake)", () => {
  const teams = [0, 1, 2, 3];
  it("runs forward then reverses each round", () => {
    expect([0, 1, 2, 3].map((i) => teamOnTheClock(teams, i))).toEqual([0, 1, 2, 3]);
    expect([4, 5, 6, 7].map((i) => teamOnTheClock(teams, i))).toEqual([3, 2, 1, 0]);
    expect([8, 9, 10, 11].map((i) => teamOnTheClock(teams, i))).toEqual([0, 1, 2, 3]);
  });

  it("pickMeta gives 1-based round + overall pick number", () => {
    expect(pickMeta(0, 4)).toEqual({ round: 1, pick_number: 1 });
    expect(pickMeta(4, 4)).toEqual({ round: 2, pick_number: 5 });
  });
});
