import { describe, expect, it } from "vitest";
import junctionFixture from "../../fixtures/projects/venue-loop-spur-junction.json";
import venueFixture from "../../fixtures/projects/venue-two-loops-spur.json";
import { bakeProject } from "./bake";
import { parseProject, type Project } from "./project";
import { validateBakedTrack } from "./validate-baked";

function parse(value: unknown): Project {
  const result = parseProject(value);
  if (!result.project) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
  return result.project;
}

function pointInTriangle(
  point: [number, number],
  a: [number, number],
  b: [number, number],
  c: [number, number],
): boolean {
  const cross = (
    p: [number, number],
    q: [number, number],
    r: [number, number],
  ): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(a, b, point);
  const d2 = cross(b, c, point);
  const d3 = cross(c, a, point);
  const negative = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const positive = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(negative && positive);
}

describe("authorable kerbs", () => {
  it("bakes red and white kerb spans with the ground graph untouched", () => {
    const project = parse(venueFixture);
    const ground = bakeProject(structuredClone(project)).surfaceGraph;
    const track = bakeProject(structuredClone(project));
    const report = validateBakedTrack(track);

    expect(track.kerbGraph).toBeDefined();
    expect(track.kerbGraph!.indices.length).toBeGreaterThan(0);
    expect(track.kerbGraph!.indices.length % 3).toBe(0);
    expect(track.surfaces.map((surface) => surface.name)).toContain("kerb_red");
    expect(track.surfaces.map((surface) => surface.name)).toContain("kerb_white");
    expect(track.surfaceGraph).toEqual(ground);
    expect(report.ok).toBe(true);
    expect(report.kerbTopology).toBeDefined();
    expect(report.kerbTopology!.degenerateTriangles).toHaveLength(0);
    expect(report.kerbTopology!.tJunctions).toHaveLength(0);

    const again = bakeProject(structuredClone(project));
    expect(again.kerbGraph).toEqual(track.kerbGraph);
  });

  it("uses equal-length kerb elements within a run", () => {
    const project = parse({
      schema: "track-ed/project@3",
      name: "Equal kerbs",
      generator: "track-ed test",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 20, mode: "conform" },
      spawn: { centerline: "road", fraction: 0.2, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "road",
          closed: false,
          points: [
            { id: "p0", position: [0, 0] },
            { id: "p1", position: [100, 0] },
          ],
          kerbs: [{ side: "left", start: 0.2, length: 0.5 }],
        },
      ],
    });
    const track = bakeProject(project);
    const kerbs = track.kerbGraph!;
    const highCorners = kerbs.positions
      .filter((position) => Math.abs(position[1] - 0.155) < 1e-6)
      .map((position) => position[0])
      .sort((a, b) => a - b);
    expect(highCorners.length).toBe(25);
    const spacing = highCorners.slice(1).map((value, index) => value - highCorners[index]!);
    expect(Math.max(...spacing) - Math.min(...spacing)).toBeLessThan(1e-6);
  });

  it("faces kerb risers along the direction of travel", () => {
    const project = parse({
      schema: "track-ed/project@3",
      name: "Riser winding",
      generator: "track-ed test",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 20, mode: "conform" },
      spawn: { centerline: "road", fraction: 0.2, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "road",
          closed: false,
          points: [
            { id: "p0", position: [0, 0] },
            { id: "p1", position: [100, 0] },
          ],
          kerbs: [{ side: "left", start: 0.2, length: 0.5 }],
        },
      ],
    });
    const kerbs = bakeProject(project).kerbGraph!;
    let forward = 0;
    let backward = 0;
    for (let triangle = 0; triangle < kerbs.indices.length / 3; triangle += 1) {
      const a = kerbs.positions[kerbs.indices[triangle * 3]!]!;
      const b = kerbs.positions[kerbs.indices[triangle * 3 + 1]!]!;
      const c = kerbs.positions[kerbs.indices[triangle * 3 + 2]!]!;
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const abz = b[2] - a[2];
      const acx = c[0] - a[0];
      const acy = c[1] - a[1];
      const acz = c[2] - a[2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const length = Math.hypot(nx, ny, nz);
      if (length <= 0) {
        continue;
      }
      if (Math.abs(ny) / length > 0.1 || Math.abs(nz) / length > 0.1) {
        continue;
      }
      if (nx / length > 0.9) {
        forward += 1;
      } else if (nx / length < -0.9) {
        backward += 1;
      }
    }
    expect(forward).toBeGreaterThan(backward);
    expect(forward).toBeGreaterThanOrEqual(20);
  });

  it("bakes a wrapped kerb span across a closed-section seam", () => {
    const project = parse({
      schema: "track-ed/project@3",
      name: "Wrapped kerbs",
      generator: "track-ed test",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 20, mode: "conform" },
      spawn: { centerline: "loop", fraction: 0.9, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "loop",
          closed: true,
          points: [
            { id: "p0", position: [50.0, 0.0] },
            { id: "p1", position: [43.3, 25.0] },
            { id: "p2", position: [25.0, 43.3] },
            { id: "p3", position: [0.0, 50.0] },
            { id: "p4", position: [-25.0, 43.3] },
            { id: "p5", position: [-43.3, 25.0] },
            { id: "p6", position: [-50.0, 0.0] },
            { id: "p7", position: [-43.3, -25.0] },
            { id: "p8", position: [-25.0, -43.3] },
            { id: "p9", position: [-0.0, -50.0] },
            { id: "p10", position: [25.0, -43.3] },
            { id: "p11", position: [43.3, -25.0] },
          ],
          kerbs: [{ side: "left", start: 0.9, length: 0.2 }],
        },
      ],
    });
    const track = bakeProject(project);
    expect(track.kerbGraph).toBeDefined();
    expect(track.kerbGraph!.indices.length).toBeGreaterThan(0);
    const report = validateBakedTrack(track);
    expect(report.ok).toBe(true);
    expect(report.kerbTopology!.degenerateTriangles).toHaveLength(0);
    expect(report.kerbTopology!.tJunctions).toHaveLength(0);
  });

  it("runs kerbs continuously across junction approaches", () => {
    const track = bakeProject(parse(junctionFixture));
    expect(track.kerbGraph).toBeDefined();
    expect(track.kerbGraph!.indices.length).toBeGreaterThan(0);
    expect(validateBakedTrack(track).ok).toBe(true);
    const positions = track.kerbGraph!.positions;
    expect(
      positions.some(
        (position) => position[0] > 70 && position[0] < 85 && position[2] > 1 && position[2] < 10,
      ),
    ).toBe(true);
  });

  it("applies global and per-span kerb heights", () => {
    const base = {
      schema: "track-ed/project@3",
      name: "Kerb heights",
      generator: "track-ed test",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 20, mode: "conform" },
      spawn: { centerline: "road", fraction: 0.2, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "road",
          closed: false,
          points: [
            { id: "p0", position: [0, 0] },
            { id: "p1", position: [100, 0] },
          ],
          kerbs: [{ side: "left", start: 0.2, length: 0.5 }],
        },
      ],
    } as const;
    const globalTrack = bakeProject(
      parse({
        ...base,
        kerbs: { flatHeight: 0.04, cornerHeight: 0.2 },
      }),
    );
    const globalHeights = new Set(
      globalTrack.kerbGraph!.positions
        .map((position) => Number(position[1].toFixed(3)))
        .filter((height) => height > 0),
    );
    expect(globalHeights.has(0.04)).toBe(true);
    expect(globalHeights.has(0.2)).toBe(true);

    const overrideTrack = bakeProject(
      parse({
        ...base,
        kerbs: { flatHeight: 0.04, cornerHeight: 0.2 },
        sections: [
          {
            ...base.sections[0],
            kerbs: [
              {
                side: "left",
                start: 0.2,
                length: 0.5,
                flatHeight: 0.08,
                cornerHeight: 0.12,
              },
            ],
          },
        ],
      }),
    );
    const overrideHeights = new Set(
      overrideTrack.kerbGraph!.positions
        .map((position) => Number(position[1].toFixed(3)))
        .filter((height) => height > 0),
    );
    expect(overrideHeights.has(0.08)).toBe(true);
    expect(overrideHeights.has(0.12)).toBe(true);
    expect(overrideHeights.has(0.2)).toBe(false);
  });

  it("follows the terrain surface in follow mode", () => {
    const project = parse({
      schema: "track-ed/project@3",
      name: "Follow Kerbs",
      generator: "track-ed test",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: {
        margin: 30,
        mode: "follow",
        points: [
          { position: [0, 0], height: 4 },
          { position: [100, 0], height: 4 },
          { position: [100, 100], height: 8 },
          { position: [0, 100], height: 8 },
          { position: [50, 50], height: 6 },
        ],
      },
      spawn: { centerline: "loop", fraction: 0.1, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "loop",
          closed: true,
          spline: { type: "catmull-rom", samplesPerSegment: 12 },
          points: [
            { id: "p0", position: [0, 0] },
            { id: "p1", position: [100, 0] },
            { id: "p2", position: [100, 100] },
            { id: "p3", position: [0, 100] },
          ],
          kerbs: [
            { side: "left", start: 0.1, length: 0.3 },
            { side: "right", start: 0.2, length: 0.3 },
          ],
        },
      ],
    });
    const track = bakeProject(project);
    expect(track.kerbGraph).toBeDefined();
    const maxY = Math.max(...track.kerbGraph!.positions.map((position) => position[1]));
    expect(maxY).toBeGreaterThan(4);
    expect(validateBakedTrack(track).ok).toBe(true);
  });
});
