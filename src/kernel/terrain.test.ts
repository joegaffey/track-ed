import { describe, expect, it } from "vitest";
import loopTerrain from "../../fixtures/projects/loop-spline-terrain.json";
import branchTerrain from "../../fixtures/projects/loop-with-branch-90-spline-terrain.json";
import { parseProject } from "./project";
import { bakeProject } from "./bake";
import { validateBakedTrack } from "./validate-baked";
import { rawTerrainHeight } from "./terrain";

describe("terrain elevation (G2a)", () => {
  it.each([
    ["loop", loopTerrain],
    ["branch-90", branchTerrain],
  ])("bakes elevated terrain around a flat %s road", (_label, fixture) => {
    const parsed = parseProject(fixture);
    expect(parsed.issues).toEqual([]);
    const track = bakeProject(parsed.project!);
    const report = validateBakedTrack(track);

    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.nonManifoldEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
    expect(report.topology.overlapPairs).toHaveLength(0);
    expect(track.bounds.max[1]).toBeGreaterThan(0.5);
    expect(track.bounds.min[1]).toBeLessThan(-0.5);

    const asphaltVertices = new Set<number>();
    for (let triangle = 0; triangle < track.surfaceGraph.triangleSurfaces.length; triangle += 1) {
      if (track.surfaceGraph.triangleSurfaces[triangle] !== 0) {
        continue;
      }
      asphaltVertices.add(track.surfaceGraph.indices[triangle * 3]!);
      asphaltVertices.add(track.surfaceGraph.indices[triangle * 3 + 1]!);
      asphaltVertices.add(track.surfaceGraph.indices[triangle * 3 + 2]!);
    }
    const roadHeights = [...asphaltVertices].map(
      (index) => track.surfaceGraph.positions[index]!,
    );
    expect(roadHeights.every((position) => Math.abs(position[1]) < 1e-9)).toBe(true);
  });

  it("keeps flat terrain when elevation is absent", () => {
    const parsed = parseProject(loopTerrain);
    const flat = structuredClone(parsed.project!);
    delete flat.terrain.elevation;
    const track = bakeProject(flat);
    expect(track.bounds.min[1]).toBe(0);
    expect(track.bounds.max[1]).toBe(0);
  });
});

describe("terrain modes", () => {
  it("drapes the road over the terrain in follow mode", () => {
    const parsed = parseProject(loopTerrain);
    const project = structuredClone(parsed.project!);
    project.terrain.mode = "follow";
    const track = bakeProject(project);
    const report = validateBakedTrack(track);
    const elevation = project.terrain.elevation!;

    expect(report.ok).toBe(true);
    const asphaltHeights = track.surfaceGraph.positions.filter(
      (position) => Math.abs(position[1]) > 1e-6,
    );
    expect(asphaltHeights.length).toBeGreaterThan(0);
    for (const position of track.surfaceGraph.positions.slice(0, 20)) {
      expect(position[1]).toBeCloseTo(
        rawTerrainHeight(elevation, [position[0], position[2]]),
        9,
      );
    }
    expect(track.spawns[0]!.position[1]).toBeCloseTo(
      rawTerrainHeight(elevation, [
        track.spawns[0]!.position[0],
        track.spawns[0]!.position[2],
      ]),
      9,
    );
  });
});
