import { describe, test, expect } from "vitest";
import { currentSeason, normalizePosition } from "../lib/nhl-api";

describe("currentSeason", () => {
  // The NHL season runs Oct -> Jun. Anything in Oct/Nov/Dec is the
  // FIRST half of YYYY-(YYYY+1). Anything in Jan-Sep is the SECOND
  // half of (YYYY-1)-YYYY.
  test("January -> previous-year/current-year", () => {
    expect(currentSeason(new Date(Date.UTC(2026, 0, 15)))).toBe("20252026");
  });

  test("April (playoffs) -> previous-year/current-year", () => {
    expect(currentSeason(new Date(Date.UTC(2026, 3, 14)))).toBe("20252026");
  });

  test("September (preseason) -> previous-year/current-year", () => {
    expect(currentSeason(new Date(Date.UTC(2025, 8, 30)))).toBe("20242025");
  });

  test("October 1st -> current-year/next-year", () => {
    expect(currentSeason(new Date(Date.UTC(2025, 9, 1)))).toBe("20252026");
  });

  test("December -> current-year/next-year", () => {
    expect(currentSeason(new Date(Date.UTC(2025, 11, 31)))).toBe("20252026");
  });

  test("returns an 8-character string", () => {
    expect(currentSeason(new Date()).length).toBe(8);
  });
});

describe("normalizePosition", () => {
  test("preserves canonical positions", () => {
    expect(normalizePosition("C")).toBe("C");
    expect(normalizePosition("L")).toBe("L");
    expect(normalizePosition("R")).toBe("R");
    expect(normalizePosition("D")).toBe("D");
    expect(normalizePosition("G")).toBe("G");
  });

  test("uppercases lowercase input", () => {
    expect(normalizePosition("d")).toBe("D");
  });

  test("falls back to 'F' for unknown codes", () => {
    expect(normalizePosition("XYZ")).toBe("F");
    expect(normalizePosition("")).toBe("F");
  });
});
