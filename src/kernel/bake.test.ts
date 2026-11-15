import { describe, expect, it } from "vitest";
import loopFixture from "../../fixtures/projects/loop.json";
import branch30 from "../../fixtures/projects/loop-with-branch-30.json";
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

function surfaceAreas(track: BakedTrack): Map<number, number> {
  const areas = new Map<number, number>();
  const graph = track.surfaceGraph;
  const triangleCount = graph.indices.length / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = graph.positions[graph.indices[triangle * 3]!]!;
    const b = graph.positions[graph.indices[triangle * 3 + 1]!]!;
    const c = graph.positions[graph.indices[triangle * 3 + 2]!]!;
    const surfaceId = graph.triangleSurfaces[triangle]!;
    areas.set(surfaceId, (areas.get(surfaceId) ?? 0) + triangleArea(a, b, c));
  }
  return areas;
}

function loadLoopProject() {
  const parsed = parseProject(loopFixture);
  expect(parsed.issues).toEqual([]);
  expect(parsed.project).not.toBeNull();
  return parsed.project!;
}

describe("bakeProject", () => {
  it("bakes one welded surface graph with asphalt, dirt, and grass", () => {
    const track = bakeProject(loadLoopProject());

    expect(track.kind).toBe("track");
    expect(track.name).toBe("Loop Fixture");
    expect(track.length).toBeCloseTo(360, 9);
    expect(track.surfaces.map((surface) => surface.name)).toEqual([
      "asphalt",
      "dirt",
      "grass",
    ]);
    expect(track.surfaceGraph.positions.length).toBeGreaterThan(0);
    expect(track.surfaceGraph.indices.length).toBeGreaterThan(0);
    expect(track.surfaceGraph.triangleSurfaces).toHaveLength(
      track.surfaceGraph.indices.length / 3,
    );
  });

  it("produces a valid watertight loop with only perimeter boundary edges", () => {
    const track = bakeProject(loadLoopProject());
    const validation = validateBakedTrack(track);

    expect(validation.violations.filter((violation) => violation.severity === "error")).toEqual(
      [],
    );
    expect(validation.ok).toBe(true);
    expect(validation.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(validation.topology.nonManifoldEdges).toHaveLength(0);
    expect(validation.topology.tJunctions).toHaveLength(0);
    expect(validation.topology.degenerateTriangles).toHaveLength(0);
    expect(validation.topology.badWindingTriangles).toHaveLength(0);
    expect(validation.topology.overlapPairs).toHaveLength(0);
    expect(validation.topology.duplicateTriangles).toHaveLength(0);
    expect(validation.topology.outerBoundaryEdges).toHaveLength(4);
  });

  it("covers the whole scene rectangle exactly once", () => {
    const track = bakeProject(loadLoopProject());
    const areas = surfaceAreas(track);
    const bounds = track.bounds;
    const sceneArea =
      (bounds.max[0] - bounds.min[0]) * (bounds.max[2] - bounds.min[2]);

    expect(areas.get(0)).toBeCloseTo(3600, 6);
    expect(areas.get(1)).toBeCloseTo(2160, 6);
    expect(areas.get(2)).toBeCloseTo(22240, 6);
    expect([...areas.values()].reduce((sum, area) => sum + area, 0)).toBeCloseTo(
      sceneArea,
      6,
    );
  });

  it("creates a normalized spawn at the centreline start", () => {
    const track = bakeProject(loadLoopProject());
    const spawn = track.spawns[0]!;
    const [x, y, z, w] = spawn.rotation;
    expect(spawn.position).toEqual([0, 0, 0]);
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 12);
  });


  it("samples the spawn at the requested fraction and lateral offset", () => {
    const value = structuredClone(loopFixture) as {
      spawn: { centerline: string; fraction: number; lateral: number };
    };
    value.spawn.fraction = 0.5;
    value.spawn.lateral = 2;

    const parsed = parseProject(value);
    expect(parsed.issues).toEqual([]);
    const track = bakeProject(parsed.project!);
    const spawn = track.spawns[0]!;

    expect(spawn.position[0]).toBeCloseTo(81.6, 9);
    expect(spawn.position[2]).toBeCloseTo(81.2, 9);
    const [x, y, z, w] = spawn.rotation;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 12);
  });

  it("supports a spawn on an attached branch", () => {
    const value = structuredClone(branch30) as {
      spawn: { centerline: string; fraction: number; lateral: number };
    };
    value.spawn.centerline = "branch-30";
    value.spawn.fraction = 0.5;
    value.spawn.lateral = 0;

    const parsed = parseProject(value);
    expect(parsed.issues).toEqual([]);
    const track = bakeProject(parsed.project!);
    expect(validateBakedTrack(track).ok).toBe(true);
    expect(track.spawns).toHaveLength(1);
  });

  it("tolerates a collinear control point inserted on a straight segment", () => {
    const value = structuredClone(loopFixture) as {
      centerlines: Array<{ points: number[][] }>;
    };
    value.centerlines[0]!.points.splice(1, 0, [40, 0]);
    const parsed = parseProject(value);
    expect(parsed.issues).toEqual([]);
    const track = bakeProject(parsed.project!);
    expect(validateBakedTrack(track).ok).toBe(true);
    const area = [...surfaceAreas(track).values()].reduce((sum, value) => sum + value, 0);
    expect(area).toBeCloseTo(
      (track.bounds.max[0] - track.bounds.min[0]) *
        (track.bounds.max[2] - track.bounds.min[2]),
      5,
    );
  });

  it("is deterministic", () => {
    const project = loadLoopProject();
    expect(bakeProject(project)).toEqual(bakeProject(project));
  });
});
