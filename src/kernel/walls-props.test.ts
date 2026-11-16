import { describe, expect, it } from "vitest";
import wallsPropsFixture from "../../fixtures/projects/venue-walls-props.json";
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

describe("walls and prop runs", () => {
  it("bakes a separate wall graph without changing the ground graph", () => {
    const project = parse(wallsPropsFixture);
    const ground = bakeProject(structuredClone(project)).surfaceGraph;
    const track = bakeProject(structuredClone(project));
    const report = validateBakedTrack(track);

    expect(track.wallGraph).toBeDefined();
    expect(track.wallGraph!.indices.length).toBeGreaterThan(0);
    expect(track.surfaceGraph).toEqual(ground);
    expect(track.surfaces.map((surface) => surface.name)).toContain("wall");
    expect(report.ok).toBe(true);
    expect(report.wallTopology).toBeDefined();
    expect(report.wallTopology!.degenerateTriangles).toHaveLength(0);
    expect(report.wallTopology!.tJunctions).toHaveLength(0);
  });

  it("expands tree, tyre, and block runs along their spline", () => {
    const track = bakeProject(parse(wallsPropsFixture));
    expect(track.props).toBeDefined();
    expect(track.props!.length).toBeGreaterThan(12);
    const kinds = new Set(track.props!.map((prop) => prop.kind));
    expect(kinds).toEqual(new Set(["tree", "tyre", "block"]));
    for (const prop of track.props!) {
      expect(prop.collision).toBe(true);
      expect(Math.hypot(...prop.rotation)).toBeCloseTo(1, 9);
      expect(Number.isFinite(prop.position[0])).toBe(true);
      expect(Number.isFinite(prop.position[2])).toBe(true);
    }
    const trees = track.props!.filter((prop) => prop.kind === "tree");
    const blocks = track.props!.filter((prop) => prop.kind === "block");
    expect(new Set(trees.map((prop) => prop.scale.toFixed(3))).size).toBeGreaterThan(2);
    expect(blocks.every((prop) => prop.scale === 1)).toBe(true);
    const yaws = new Set(
      blocks.map((prop) => Math.atan2(2 * prop.rotation[1], 2 * prop.rotation[3]).toFixed(4)),
    );
    expect(yaws.size).toBeGreaterThan(2);
  });

  it("samples prop run height from the same followed terrain source", () => {
    const value = structuredClone(wallsPropsFixture) as unknown as {
      terrain: { mode: string; points: Array<{ position: number[]; height: number }> };
      sections: Array<{ props: Array<Record<string, unknown>> }>;
    };
    value.terrain.mode = "follow";
    value.terrain.points = [
      { position: [10, 10], height: 2 },
      { position: [10, 80], height: 8 },
      { position: [100, 10], height: 8 },
      { position: [100, 80], height: 8 },
    ];
    const project = parse(value);
    const track = bakeProject(project);
    expect(track.props!.some((prop) => prop.position[1] > 0.5)).toBe(true);
    expect(track.wallGraph!.positions.some((position) => position[1] > 0.5)).toBe(true);
  });

  it("keeps wall inner faces on the asphalt edge by default", () => {
    const project = parse({
      schema: "track-ed/project@4",
      name: "Wall edge",
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
          walls: [{ side: "right", start: 0, length: 1 }],
        },
      ],
    });
    const wall = bakeProject(project).wallGraph!;
    const zs = wall.positions.map((position) => position[2]);
    expect(Math.max(...zs)).toBeCloseTo(-5, 6);
    expect(Math.min(...zs)).toBeCloseTo(-5.3, 6);
  });

  it("suppresses kerbs under overlapping wall spans", () => {
    const project = parse({
      schema: "track-ed/project@4",
      name: "Wall over kerb",
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
          kerbs: [{ side: "right", start: 0.1, length: 0.3 }],
          walls: [{ side: "right", start: 0.2, length: 0.1 }],
        },
      ],
    });
    const track = bakeProject(project);
    const kerb = track.kerbGraph!;
    expect(kerb).toBeDefined();
    expect(
      kerb.positions.every(
        (position) => position[0] < 20.1 || position[0] > 29.9,
      ),
    ).toBe(true);
    expect(validateBakedTrack(track).ok).toBe(true);
  });

  it("bakes mixed run types on one roadside spline", () => {
    const project = parse({
      schema: "track-ed/project@5",
      name: "Mixed roadside",
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
          roadside: [
            {
              id: "left-9",
              side: "left",
              offset: 9,
              runs: [
                { kind: "wall", start: 0.1, length: 0.1 },
                { kind: "block", start: 0.25, length: 0.1, spacing: 2.4 },
                { kind: "tree", start: 0.4, length: 0.1, spacing: 4.5 },
              ],
            },
          ],
        },
      ],
    });
    const track = bakeProject(project);
    expect(track.wallGraph).toBeDefined();
    expect(new Set(track.props!.map((prop) => prop.kind))).toEqual(
      new Set(["block", "tree"]),
    );
    for (const prop of track.props!) {
      expect(prop.position[2]).toBeGreaterThan(8.5);
      expect(prop.position[2]).toBeLessThan(9.5);
    }
  });

  it("applies outward offsets to instance runs on fixed kerb splines", () => {
    const project = parse({
      schema: "track-ed/project@5",
      name: "Fixed kerb props",
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
          roadside: [
            {
              id: "road:kerb-left",
              role: "kerb-left",
              side: "left",
              offset: 5,
              runs: [
                {
                  kind: "tree",
                  start: 0.1,
                  length: 0.2,
                  outwardOffset: 7,
                  spacing: 4.5,
                },
              ],
            },
            {
              id: "road:kerb-right",
              role: "kerb-right",
              side: "right",
              offset: 5,
              runs: [],
            },
          ],
        },
      ],
    });
    const track = bakeProject(project);
    expect(track.props!.length).toBeGreaterThan(0);
    for (const prop of track.props!) {
      expect(prop.position[2]).toBeGreaterThan(11.5);
      expect(prop.position[2]).toBeLessThan(12.5);
    }
  });

  it("samples conform terrain for editor and export props", () => {
    const project = parse({
      schema: "track-ed/project@5",
      name: "Conform props",
      generator: "track-ed test",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: {
        margin: 20,
        mode: "conform",
        points: [
          { position: [50, -10], height: 8 },
          { position: [50, 10], height: 8 },
          { position: [80, -10], height: 8 },
          { position: [80, 10], height: 8 },
        ],
      },
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
          roadside: [
            {
              id: "left-9",
              side: "left",
              offset: 9,
              runs: [{ kind: "tree", start: 0.4, length: 0.2 }],
            },
          ],
        },
      ],
    });
    const track = bakeProject(project);
    expect(track.props!.length).toBeGreaterThan(0);
    expect(track.props![0]!.position[1]).toBeGreaterThan(3);
  });

  it("lets a wall replace a kerb on a fixed kerb spline", () => {
    const project = parse({
      schema: "track-ed/project@5",
      name: "Wall over fixed kerb",
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
          roadside: [
            {
              id: "road:kerb-left",
              role: "kerb-left",
              side: "left",
              offset: 5,
              runs: [
                { kind: "kerb", start: 0.1, length: 0.4 },
                { kind: "wall", start: 0.2, length: 0.2 },
              ],
            },
            {
              id: "road:kerb-right",
              role: "kerb-right",
              side: "right",
              offset: 5,
              runs: [],
            },
          ],
        },
      ],
    });
    const track = bakeProject(project);
    expect(track.wallGraph).toBeDefined();
    expect(track.kerbGraph).toBeDefined();
    expect(
      track.kerbGraph!.positions.every(
        (position) => position[0] < 20.1 || position[0] > 39.9,
      ),
    ).toBe(true);
  });

  it("rejects overlapping runs on one roadside spline", () => {
    const result = parseProject({
      schema: "track-ed/project@5",
      name: "Overlap",
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
          roadside: [
            {
              id: "left-9",
              side: "left",
              offset: 9,
              runs: [
                { kind: "tree", start: 0.1, length: 0.2 },
                { kind: "block", start: 0.2, length: 0.2 },
              ],
            },
          ],
        },
      ],
    });
    expect(result.project).toBeNull();
    expect(
      result.issues.some((issue) =>
        issue.message.includes("must not overlap"),
      ),
    ).toBe(true);
  });

  it("rejects walls and prop runs in project@3", () => {
    const withWalls = structuredClone(wallsPropsFixture) as {
      schema: string;
      sections: Array<{ walls?: unknown; props?: unknown }>;
    };
    withWalls.schema = "track-ed/project@3";
    const result = parseProject(withWalls);
    expect(result.project).toBeNull();
    expect(
      result.issues.some(
        (issue) =>
          issue.path === "$.sections[0].walls" ||
          issue.path === "$.sections[0].roadside",
      ),
    ).toBe(true);
  });

  it("allows prop runs to opt out of collision", () => {
    const value = structuredClone(wallsPropsFixture) as unknown as {
      sections: Array<{
        roadside: Array<{ runs: Array<{ kind?: string; collision?: string }> }>;
      }>;
    };
    for (const spline of value.sections[0]!.roadside) {
      for (const run of spline.runs) {
        if (run.kind === "tree") {
          run.collision = "none";
        }
      }
    }
    const track = bakeProject(parse(value));
    const trees = track.props!.filter((prop) => prop.kind === "tree");
    expect(trees.length).toBeGreaterThan(0);
    expect(trees.every((prop) => !prop.collision)).toBe(true);
  });
});
