import { describe, expect, it } from "vitest";
import loopFixture from "../../fixtures/projects/loop.json";
import branch30 from "../../fixtures/projects/loop-with-branch-30.json";
import branch45 from "../../fixtures/projects/loop-with-branch-45.json";
import branch90 from "../../fixtures/projects/loop-with-branch-90.json";
import twoLooseBranches from "../../fixtures/projects/loop-two-loose-branches.json";
import { parseProject } from "./project";

function cloneFixture<T>(value: T): T {
  return structuredClone(value);
}

describe("parseProject", () => {
  it("accepts the loop fixture", () => {
    const result = parseProject(loopFixture);
    expect(result.issues).toEqual([]);
    expect(result.project?.name).toBe("Loop Fixture");
    expect(result.project?.centerlines).toHaveLength(1);
  });

  it.each([branch30, branch45, branch90])("accepts branch fixture %#", (fixture) => {
    const result = parseProject(fixture);
    expect(result.issues).toEqual([]);
    expect(result.project?.centerlines).toHaveLength(2);
  });

  it("accepts the two-loose-branches fixture", () => {
    const result = parseProject(twoLooseBranches);
    expect(result.issues).toEqual([]);
    expect(result.project?.centerlines).toHaveLength(3);
    expect(result.project?.junctions).toHaveLength(2);
  });

  it("rejects unknown fields", () => {
    const value = cloneFixture(loopFixture) as Record<string, unknown>;
    value.consumer = "lapster";
    const result = parseProject(value);
    expect(result.project).toBeNull();
    expect(result.issues.some((issue) => issue.message === "unknown field")).toBe(true);
  });

  it("rejects duplicate centreline ids", () => {
    const value = cloneFixture(branch30) as Record<string, unknown>;
    const centerlines = value.centerlines as Array<Record<string, unknown>>;
    centerlines[1]!.id = "main";
    const result = parseProject(value);
    expect(result.project).toBeNull();
    expect(result.issues.some((issue) => issue.message.includes("duplicate centreline id"))).toBe(
      true,
    );
  });

  it("rejects zero-length segments", () => {
    const value = cloneFixture(loopFixture) as Record<string, unknown>;
    const centerlines = value.centerlines as Array<Record<string, unknown>>;
    const points = centerlines[0]!.points as number[][];
    points[1] = [points[0]![0]!, points[0]![1]!];
    const result = parseProject(value);
    expect(result.project).toBeNull();
    expect(
      result.issues.some((issue) => issue.message.includes("consecutive duplicate points")),
    ).toBe(true);
  });

  it("rejects a self-intersecting main loop", () => {
    const value = cloneFixture(loopFixture) as Record<string, unknown>;
    const centerlines = value.centerlines as Array<Record<string, unknown>>;
    centerlines[0]!.points = [
      [0, 0],
      [20, 20],
      [20, 0],
      [0, 20],
    ];
    const result = parseProject(value);
    expect(result.project).toBeNull();
    expect(result.issues.some((issue) => issue.message.includes("self-intersect"))).toBe(true);
  });

  it("rejects an attach block on a closed centreline", () => {
    const value = cloneFixture(loopFixture) as Record<string, unknown>;
    const centerlines = value.centerlines as Array<Record<string, unknown>>;
    centerlines[0]!.attach = { to: "main", fraction: 0.5 };
    const result = parseProject(value);
    expect(result.project).toBeNull();
  });

  it("accepts a centripetal Catmull-Rom spline spec", () => {
    const value = cloneFixture(loopFixture) as Record<string, unknown>;
    const centerlines = value.centerlines as Array<Record<string, unknown>>;
    centerlines[0]!.spline = { type: "catmull-rom", samplesPerSegment: 16 };
    const result = parseProject(value);
    expect(result.issues).toEqual([]);
    expect(result.project?.centerlines[0]?.spline).toEqual({
      type: "catmull-rom",
      samplesPerSegment: 16,
    });
  });

  it("rejects an unknown spline type and bad sample count", () => {
    const value = cloneFixture(loopFixture) as Record<string, unknown>;
    const centerlines = value.centerlines as Array<Record<string, unknown>>;
    centerlines[0]!.spline = { type: "bezier", samplesPerSegment: 1 };
    const result = parseProject(value);
    expect(result.project).toBeNull();
    expect(result.issues.some((issue) => issue.path.endsWith(".spline.type"))).toBe(true);
    expect(
      result.issues.some((issue) => issue.path.endsWith(".spline.samplesPerSegment")),
    ).toBe(true);
  });

  it("accepts conform and follow terrain modes", () => {
    for (const mode of ["conform", "follow"]) {
      const value = cloneFixture(loopFixture) as Record<string, unknown>;
      (value.terrain as Record<string, unknown>).mode = mode;
      const result = parseProject(value);
      expect(result.issues).toEqual([]);
      expect(result.project?.terrain.mode).toBe(mode);
    }
  });

  it("rejects an unknown terrain mode", () => {
    const value = cloneFixture(loopFixture) as Record<string, unknown>;
    (value.terrain as Record<string, unknown>).mode = "floating";
    const result = parseProject(value);
    expect(result.project).toBeNull();
    expect(result.issues.some((issue) => issue.path === "$.terrain.mode")).toBe(true);
  });

  it("rejects a spawn lateral offset outside the asphalt band", () => {
    const value = cloneFixture(loopFixture) as Record<string, unknown>;
    (value.spawn as Record<string, unknown>).lateral = 8;
    const result = parseProject(value);
    expect(result.project).toBeNull();
    expect(result.issues.some((issue) => issue.path === "spawn.lateral")).toBe(true);
  });

  it("rejects an invalid road width pair", () => {
    const value = cloneFixture(loopFixture) as Record<string, unknown>;
    (value.road as Record<string, unknown>).shoulderHalfWidth = 4;
    const result = parseProject(value);
    expect(result.project).toBeNull();
  });
});
