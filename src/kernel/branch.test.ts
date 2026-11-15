import { describe, expect, it } from "vitest";
import branch30 from "../../fixtures/projects/loop-with-branch-30.json";
import branch45 from "../../fixtures/projects/loop-with-branch-45.json";
import branch90 from "../../fixtures/projects/loop-with-branch-90.json";
import { bakeProject } from "./bake";
import { parseProject } from "./project";
import { validateBakedTrack } from "./validate-baked";
import type { BakedTrack, Vec3 } from "../model/baked-track";

function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return Math.hypot(nx, ny, nz) / 2;
}

function totalArea(track: BakedTrack): number {
  const graph = track.surfaceGraph;
  let area = 0;
  for (let triangle = 0; triangle < graph.indices.length / 3; triangle += 1) {
    const a = graph.positions[graph.indices[triangle * 3]!]!;
    const b = graph.positions[graph.indices[triangle * 3 + 1]!]!;
    const c = graph.positions[graph.indices[triangle * 3 + 2]!]!;
    area += triangleArea(a, b, c);
  }
  return area;
}

function bake(fixture: unknown): BakedTrack {
  const parsed = parseProject(fixture);
  expect(parsed.issues).toEqual([]);
  return bakeProject(parsed.project!);
}

describe("branch baking", () => {
  it.each([
    ["30", branch30],
    ["45", branch45],
    ["90", branch90],
  ])("bakes a watertight %s-degree junction", (_label, fixture) => {
    const track = bake(fixture);
    const report = validateBakedTrack(track);

    expect(report.violations.filter((violation) => violation.severity === "error")).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.nonManifoldEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
    expect(report.topology.degenerateTriangles).toHaveLength(0);
    expect(report.topology.badWindingTriangles).toHaveLength(0);
    expect(report.topology.overlapPairs).toHaveLength(0);
    expect(report.topology.duplicateTriangles).toHaveLength(0);
    expect(report.topology.outerBoundaryEdges).toHaveLength(4);

    const bounds = track.bounds;
    const sceneArea =
      (bounds.max[0] - bounds.min[0]) * (bounds.max[2] - bounds.min[2]);
    expect(totalArea(track)).toBeCloseTo(sceneArea, 3);
  });

  it.each([
    ["30", branch30],
    ["45", branch45],
    ["90", branch90],
  ])("is deterministic for the %s-degree junction", (_label, fixture) => {
    const parsed = parseProject(fixture);
    const project = parsed.project!;
    expect(bakeProject(project)).toEqual(bakeProject(project));
  });
});

describe("branch snapping", () => {
  it("ignores an authored first point that is not the host sample", () => {
    const corrected = bake(branch90);
    const hinted = structuredClone(branch90) as {
      centerlines: Array<{ closed: boolean; points: number[][] }>;
    };
    const branch = hinted.centerlines.find((centerline) => !centerline.closed)!;
    branch.points[0] = [20, 10];

    const parsed = parseProject(hinted);
    expect(parsed.issues).toEqual([]);
    expect(bakeProject(parsed.project!)).toEqual(corrected);
  });
});

describe("branch validation", () => {
  it("rejects a branch that crosses the main loop outside the attachment", () => {
    const value = structuredClone(branch90) as {
      centerlines: Array<{ closed: boolean; points: number[][] }>;
    };
    const branch = value.centerlines.find((centerline) => !centerline.closed)!;
    branch.points = [
      [20, 0],
      [20, 80],
    ];

    const parsed = parseProject(value);
    expect(parsed.issues).toEqual([]);
    expect(() => bakeProject(parsed.project!)).toThrow(/crosses the main loop/);
  });
});

describe("branch collinear points", () => {
  it("tolerates a collinear control point inserted on a branch segment", () => {
    const value = structuredClone(branch90) as {
      centerlines: Array<{ closed: boolean; points: number[][] }>;
    };
    const branch = value.centerlines.find((centerline) => !centerline.closed)!;
    const a = branch.points[1]!;
    const b = branch.points[2]!;
    branch.points.splice(2, 0, [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2]);
    const parsed = parseProject(value);
    expect(parsed.issues).toEqual([]);
    const track = bakeProject(parsed.project!);
    expect(validateBakedTrack(track).ok).toBe(true);
  });
});
