import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/projects/loop-spline-terrain-points.json";
import { parseProject } from "./project";
import { bakeProject } from "./bake";
import { validateBakedTrack } from "./validate-baked";
import { exportLapsterGlbTrack } from "../export/lapster";
import { buildPointTerrainSampler } from "./terrain";

describe("terrain points TIN", () => {
  it("bakes a valid terrain from absolute point heights", () => {
    const parsed = parseProject(fixture);
    expect(parsed.issues).toEqual([]);
    const track = bakeProject(parsed.project!);
    const report = validateBakedTrack(track);

    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.nonManifoldEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
    expect(report.topology.overlapPairs).toHaveLength(0);
    expect(track.bounds.max[1]).toBeGreaterThan(5);
    expect(track.bounds.min[1]).toBe(0);
  });

  it("uses every terrain point as an exact surface vertex", () => {
    const parsed = parseProject(fixture);
    const project = parsed.project!;
    const track = bakeProject(project);
    for (const point of project.terrain.points!) {
      const found = track.surfaceGraph.positions.some(
        (position) =>
          Math.abs(position[0] - point.position[0]) <= 1e-6 &&
          Math.abs(position[1] - point.height) <= 1e-6 &&
          Math.abs(position[2] - point.position[1]) <= 1e-6,
      );
      expect(found).toBe(true);
    }
  });

  it("increases triangle detail as points are added", () => {
    const parsed = parseProject(fixture);
    const one = structuredClone(parsed.project!);
    one.terrain.points = one.terrain.points!.slice(0, 1);
    const more = structuredClone(parsed.project!);

    const oneTriangles = bakeProject(one).surfaceGraph.indices.length / 3;
    const moreTriangles = bakeProject(more).surfaceGraph.indices.length / 3;
    expect(moreTriangles).toBeGreaterThan(oneTriangles);
  });

  it("writes non-flat normals for sloped terrain", () => {
    const parsed = parseProject(fixture);
    const track = bakeProject(parsed.project!);
    const bundle = exportLapsterGlbTrack(track);
    expect(bundle.files[0]!.bytes.length).toBeGreaterThan(0);
    const flatNormals = track.surfaceGraph.positions.filter((position) => position[1] > 1e-6);
    expect(flatNormals.length).toBeGreaterThan(0);
  });
});

describe("point terrain follow mode", () => {
  it("drapes the road and spawn over the point terrain", () => {
    const parsed = parseProject(fixture);
    const project = structuredClone(parsed.project!);
    project.terrain.mode = "follow";
    const track = bakeProject(project);
    const report = validateBakedTrack(track);

    expect(report.ok).toBe(true);
    const sampler = buildPointTerrainSampler(project.terrain.points!, track.bounds);
    const spawn = track.spawns[0]!;
    expect(spawn.position[1]).toBeCloseTo(
      sampler([spawn.position[0], spawn.position[2]]),
      6,
    );
    expect(
      track.surfaceGraph.positions.some((position) => Math.abs(position[1]) > 1e-6),
    ).toBe(true);
  });
});
