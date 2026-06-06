import { describe, it, expect } from "vitest";
import { mapStage, mapStatus, extractMatchday } from "./api-football";

describe("mapStage", () => {
  it("classifies group and knockout rounds", () => {
    expect(mapStage("Group Stage - 1")).toBe("group");
    expect(mapStage("Group A")).toBe("group");
    expect(mapStage("Round of 32")).toBe("r32");
    expect(mapStage("Round of 16")).toBe("r16");
    expect(mapStage("Quarter-finals")).toBe("qf");
    expect(mapStage("Semi-finals")).toBe("sf");
    expect(mapStage("Final")).toBe("final");
  });

  it("does not misread 3rd-place or semis as the final", () => {
    expect(mapStage("3rd Place Final")).toBe("third");
    expect(mapStage("Third place play-off")).toBe("third");
    expect(mapStage("Semi-finals")).not.toBe("final");
  });

  it("returns null for unknown rounds", () => {
    expect(mapStage("Friendlies")).toBeNull();
  });
});

describe("mapStatus", () => {
  it("maps finished, scheduled and live codes", () => {
    expect(mapStatus("FT")).toBe("final");
    expect(mapStatus("AET")).toBe("final");
    expect(mapStatus("PEN")).toBe("final");
    expect(mapStatus("NS")).toBe("scheduled");
    expect(mapStatus("PST")).toBe("scheduled");
    expect(mapStatus("2H")).toBe("live");
    expect(mapStatus("ET")).toBe("live");
  });
});

describe("extractMatchday", () => {
  it("pulls the matchday number from a group round label", () => {
    expect(extractMatchday("Group Stage - 2")).toBe(2);
    expect(extractMatchday("Group A")).toBeNull();
  });
});
