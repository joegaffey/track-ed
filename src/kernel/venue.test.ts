import { describe, expect, it } from "vitest";
import venueFixture from "../../fixtures/projects/venue-two-loops-spur.json";
import { bakeProject } from "./bake";
import { centerlineLength } from "./geometry";
import { parseProject, type Project } from "./project";
import { sampleCenterline } from "./spline";
import { validateBakedTrack } from "./validate-baked";

function parseVenue(input: unknown = venueFixture): Project {
  const parsed = parseProject(input);
  expect(parsed.issues).toEqual([]);
  return parsed.project!;
}

function expectedLength(project: Project): number {
  return project.centerlines.reduce(
    (sum, section) =>
      sum +
      centerlineLength(
        sampleCenterline(
          section.points as [number, number][],
          section.closed,
          section.spline,
        ),
        section.closed,
      ),
    0,
  );
}

describe("project@3 venue sections", () => {
  it("parses multiple closed sections and a dead-ended open section", () => {
    const project = parseVenue();
    expect(project.centerlines).toHaveLength(3);
    expect(project.centerlines.filter((section) => section.closed)).toHaveLength(2);
    const spur = project.centerlines.find((section) => section.id === "spur")!;
    expect(spur.closed).toBe(false);
    expect(spur.attach).toBeUndefined();
    expect(spur.endAttach).toBeUndefined();
  });

  it("bakes multiple loops and a dead-ended open section", () => {
    const project = parseVenue();
    const track = bakeProject(project);
    const report = validateBakedTrack(track);

    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.nonManifoldEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
    expect(report.topology.overlapPairs).toHaveLength(0);
    expect(track.length).toBeCloseTo(expectedLength(project), 6);
  });

  it("rejects disconnected sections that intersect", () => {
    const crossing = structuredClone(venueFixture);
    crossing.sections[2]!.points = [
      { id: "s0", position: [0, -20] },
      { id: "s1", position: [80, 100] },
    ];
    const project = parseVenue(crossing);

    expect(() => bakeProject(project)).toThrow(/intersect/);
  });

  it("bakes a T-junction on an interior point of an open section", () => {
    const project = parseVenue({
      schema: "track-ed/project@3",
      name: "Open T",
      generator: "track-ed v1",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 20, mode: "conform" },
      spawn: { centerline: "host", fraction: 0.5, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "host",
          closed: false,
          points: [
            { id: "h0", position: [0, 0] },
            { id: "h1", position: [50, 0] },
            { id: "h2", position: [100, 0] },
          ],
        },
        {
          id: "spur",
          closed: false,
          points: [
            { id: "s0", position: [50, 40] },
            { id: "s1", position: [50, 20] },
            { id: "s2", position: [50, 0] },
          ],
        },
      ],
      junctions: [
        {
          id: "j1",
          members: [
            { section: "host", point: "h1" },
            { section: "spur", point: "s2" },
          ],
          anchor: { section: "host", point: "h1" },
        },
      ],
    });
    const report = validateBakedTrack(bakeProject(project));
    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
    expect(report.topology.overlapPairs).toHaveLength(0);
  });

  it("bakes an open section attached to a closed loop", () => {
    const project = parseVenue({
      schema: "track-ed/project@3",
      name: "Loop Spur",
      generator: "track-ed v1",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 30, mode: "conform" },
      spawn: { centerline: "loop", fraction: 0.1, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "loop",
          closed: true,
          spline: { type: "catmull-rom", samplesPerSegment: 12 },
          points: [
            { id: "a0", position: [0, 0] },
            { id: "a1", position: [80, 0] },
            { id: "a2", position: [110, 40] },
            { id: "a3", position: [80, 80] },
            { id: "a4", position: [0, 80] },
            { id: "a5", position: [-30, 40] },
          ],
        },
        {
          id: "spur",
          closed: false,
          points: [
            { id: "s0", position: [80, 20] },
            { id: "s1", position: [60, 40] },
            { id: "s2", position: [40, 20] },
          ],
        },
      ],
      junctions: [
        {
          id: "j1",
          members: [
            { section: "loop", point: "a1" },
            { section: "spur", point: "s0" },
          ],
          anchor: { section: "loop", point: "a1" },
        },
      ],
    });
    const report = validateBakedTrack(bakeProject(project));
    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
  });

  it("bakes a three-way junction on an open section", () => {
    const project = parseVenue({
      schema: "track-ed/project@3",
      name: "Open Cross",
      generator: "track-ed v1",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 20, mode: "conform" },
      spawn: { centerline: "host", fraction: 0.5, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "host",
          closed: false,
          points: [
            { id: "h0", position: [0, 0] },
            { id: "h1", position: [50, 0] },
            { id: "h2", position: [100, 0] },
          ],
        },
        {
          id: "north",
          closed: false,
          points: [
            { id: "n0", position: [50, 40] },
            { id: "n1", position: [50, 20] },
            { id: "n2", position: [50, 0] },
          ],
        },
        {
          id: "south",
          closed: false,
          points: [
            { id: "w0", position: [50, -40] },
            { id: "w1", position: [50, -20] },
            { id: "w2", position: [50, 0] },
          ],
        },
      ],
      junctions: [
        {
          id: "j1",
          members: [
            { section: "host", point: "h1" },
            { section: "north", point: "n2" },
            { section: "south", point: "w2" },
          ],
          anchor: { section: "host", point: "h1" },
        },
      ],
    });
    const report = validateBakedTrack(bakeProject(project));
    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
  });

  it("rejects two points from the same section in one junction", () => {
    const value = {
      ...structuredClone(venueFixture),
      junctions: [
        {
          id: "j1",
          members: [
            { section: "spur", point: "s0" },
            { section: "spur", point: "s1" },
          ],
          anchor: { section: "spur", point: "s0" },
        },
      ],
    };
    const result = parseProject(value);

    expect(result.project).toBeNull();
    expect(
      result.issues.some((issue) => issue.message.includes("two points from the same section")),
    ).toBe(true);
  });

  it("rejects a section point in two junctions", () => {
    const value = {
      ...structuredClone(venueFixture),
      junctions: [
        {
          id: "j1",
          members: [
            { section: "loop-a", point: "a1" },
            { section: "spur", point: "s0" },
          ],
          anchor: { section: "loop-a", point: "a1" },
        },
        {
          id: "j2",
          members: [
            { section: "loop-a", point: "a1" },
            { section: "loop-b", point: "b0" },
          ],
          anchor: { section: "loop-a", point: "a1" },
        },
      ],
    };
    const result = parseProject(value);

    expect(result.project).toBeNull();
    expect(
      result.issues.some((issue) => issue.message.includes("belong to only one junction")),
    ).toBe(true);
  });

  it("rejects an anchor that is not a junction member", () => {
    const value = {
      ...structuredClone(venueFixture),
      junctions: [
        {
          id: "j1",
          members: [
            { section: "loop-a", point: "a1" },
            { section: "spur", point: "s0" },
          ],
          anchor: { section: "loop-a", point: "a0" },
        },
      ],
    };
    const result = parseProject(value);

    expect(result.project).toBeNull();
    expect(
      result.issues.some((issue) => issue.message.includes("anchor must be one of the junction members")),
    ).toBe(true);
  });

  it("allows a venue with only a dead-ended open section", () => {
    const project = parseVenue({
      schema: "track-ed/project@3",
      name: "Spur Only",
      generator: "track-ed v1",
      road: venueFixture.road,
      terrain: venueFixture.terrain,
      spawn: { centerline: "spur", fraction: 0.5, lateral: 0 },
      cameras: [],
      sections: [structuredClone(venueFixture.sections.find((section) => section.id === "spur")!)],
    });
    const report = validateBakedTrack(bakeProject(project));

    expect(project.centerlines).toHaveLength(1);
    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
  });
});
