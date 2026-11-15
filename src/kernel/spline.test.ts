import { describe, expect, it } from "vitest";
import { distancePointToSegmentSq, type Vec2 } from "./math2";
import { fractionAtControlPoint, sampleCatmullRom, sampleCenterline } from "./spline";
import { centerlineLength, samplePolyline } from "./geometry";
import { parseProject } from "./project";
import { bakeProject } from "./bake";
import { validateBakedTrack } from "./validate-baked";
import loopFixture from "../../fixtures/projects/loop.json";
import loopSplineFixture from "../../fixtures/projects/loop-spline.json";
import branch90Spline from "../../fixtures/projects/loop-with-branch-90-spline.json";
import branch45Spline from "../../fixtures/projects/loop-with-branch-45-spline.json";
import branch30Spline from "../../fixtures/projects/loop-with-branch-30-spline.json";

const square: Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe("sampleCatmullRom", () => {
  it("samples every closed segment and never repeats the seam", () => {
    const samples = sampleCatmullRom(square, true, 8);
    expect(samples).toHaveLength(square.length * 8);
    expect(samples[0]![0]).toBeCloseTo(0, 9);
    expect(samples[0]![1]).toBeCloseTo(0, 9);
  });

  it("keeps open endpoints and adds each segment's samples", () => {
    const samples = sampleCatmullRom(square, false, 6);
    expect(samples).toHaveLength((square.length - 1) * 6 + 1);
    expect(samples[0]![0]).toBeCloseTo(0, 9);
    expect(samples[0]![1]).toBeCloseTo(0, 9);
    expect(samples[samples.length - 1]![0]).toBeCloseTo(0, 9);
    expect(samples[samples.length - 1]![1]).toBeCloseTo(10, 9);
  });

  it("rounds corners away from the control polygon", () => {
    const samples = sampleCatmullRom(square, true, 8);
    const offEdge = samples.some(
      (point) =>
        distancePointToSegmentSq(point, [0, 0], [10, 0]) > 1e-4 &&
        distancePointToSegmentSq(point, [10, 0], [10, 10]) > 1e-4 &&
        distancePointToSegmentSq(point, [10, 10], [0, 10]) > 1e-4 &&
        distancePointToSegmentSq(point, [0, 10], [0, 0]) > 1e-4,
    );
    expect(offEdge).toBe(true);
  });

  it("is deterministic", () => {
    expect(sampleCatmullRom(square, true, 12)).toEqual(sampleCatmullRom(square, true, 12));
  });

  it("returns the original polyline when no spline is configured", () => {
    expect(sampleCenterline(square, true, undefined)).toEqual(square);
  });
});

describe("spline baking", () => {
  it("uses the sampled centreline for length, spawn, and geometry", () => {
    const value = structuredClone(loopFixture) as Record<string, unknown>;
    const centerlines = value.centerlines as Array<Record<string, unknown>>;
    centerlines[0]!.spline = { type: "catmull-rom", samplesPerSegment: 12 };
    const parsed = parseProject(value);
    expect(parsed.issues).toEqual([]);
    const project = parsed.project!;
    const main = project.centerlines[0]!;
    const sampled = sampleCenterline(main.points as Vec2[], true, main.spline);
    const track = bakeProject(project);
    const report = validateBakedTrack(track);

    expect(report.ok).toBe(true);
    expect(track.length).toBeCloseTo(centerlineLength(sampled, true), 6);
    const spawn = samplePolyline(sampled, true, project.spawn.fraction);
    expect(track.spawns[0]!.position[0]).toBeCloseTo(spawn.position[0], 6);
    expect(track.spawns[0]!.position[2]).toBeCloseTo(spawn.position[1], 6);
  });
});

describe("spline branch fixtures", () => {
  it.each([
    ["90", branch90Spline],
    ["45", branch45Spline],
    ["30", branch30Spline],
  ])("bakes the %s-degree spline branch", (_label, fixture) => {
    const parsed = parseProject(fixture);
    expect(parsed.issues).toEqual([]);
    const track = bakeProject(parsed.project!);
    const report = validateBakedTrack(track);
    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.nonManifoldEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
    expect(report.topology.overlapPairs).toHaveLength(0);
  });
});

describe("control point fractions", () => {
  it("returns the arc-length fraction at each sampled control point", () => {
    const project = parseProject(loopSplineFixture).project!;
    const centerline = project.centerlines[0]!;
    const points = centerline.points as Vec2[];
    const sampled = sampleCenterline(points, true, centerline.spline);

    for (let index = 0; index < points.length; index += 1) {
      const fraction = fractionAtControlPoint(points, true, centerline.spline, index);
      expect(fraction).not.toBeNull();
      const sample = samplePolyline(sampled, true, fraction!);
      expect(sample.position[0]).toBeCloseTo(points[index]![0], 5);
      expect(sample.position[1]).toBeCloseTo(points[index]![1], 5);
    }
  });
});
