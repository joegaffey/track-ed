import { describe, expect, it } from "vitest";
import loopSpurFixture from "../../fixtures/projects/venue-loop-spur-junction.json";
import venueFixture from "../../fixtures/projects/venue-two-loops-spur.json";
import { bakeProject } from "../kernel/bake";
import { centerlineLength } from "../kernel/geometry";
import { parseProject, type Project } from "../kernel/project";
import { sampleCenterline } from "../kernel/spline";
import { validateBakedTrack } from "../kernel/validate-baked";
import {
  addJunctionMember,
  addLooseSectionAtPoint,
  addSectionAtPoint,
  closeSectionLoop,
  isLooseSectionEnd,
  mergeLooseSectionEnds,
  removeJunctionWithGap,
  splitClosedSection,
  splitOpenSection,
  syncSectionJunctions,
} from "./section-edit";

function parseVenue(value: unknown): Project {
  const parsed = parseProject(value);
  if (!parsed.project) {
    throw new Error(parsed.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.project;
}

function venue(): Project {
  return parseVenue(venueFixture);
}

function openTJunction(): Project {
  return parseVenue({
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
}

function expectValid(project: Project): void {
  const report = validateBakedTrack(bakeProject(project));
  expect(report.ok).toBe(true);
  expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
  expect(report.topology.tJunctions).toHaveLength(0);
  expect(report.topology.overlapPairs).toHaveLength(0);
}

describe("project@3 section editing", () => {
  it("adds a section junction at any control point", () => {
    const project = venue();
    const result = addSectionAtPoint(project, "loop-a", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.centerlines).toHaveLength(4);
    expect(result.project.junctions).toHaveLength(1);
    expect(result.project.junctions[0]!.members).toHaveLength(2);
    expectValid(result.project);
  });

  it("adds a standalone section without creating a junction", () => {
    const project = venue();
    const result = addLooseSectionAtPoint(project, "loop-a", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.centerlines).toHaveLength(4);
    expect(result.project.junctions).toHaveLength(0);
    const added = result.project.centerlines[3]!;
    expect(added.closed).toBe(false);
    expect(added.points).toHaveLength(3);
    expect(added.points[0]).not.toEqual(project.centerlines[0]!.points[1]);
    expectValid(result.project);
  });

  it("adds a junction to a standalone section without overlapping", () => {
    const project = venue();
    const loose = addLooseSectionAtPoint(project, "loop-a", 1);
    expect(loose.ok).toBe(true);
    if (!loose.ok) return;
    const standalone = loose.project.centerlines[loose.project.centerlines.length - 1]!;

    const result = addSectionAtPoint(loose.project, standalone.id, 0, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.centerlines).toHaveLength(5);
    expect(result.project.junctions).toHaveLength(1);
    expectValid(result.project);
  });

  it("adds a loose end to an existing junction", () => {
    const project = openTJunction();
    const result = addJunctionMember(project, "host", "h1", "spur", "s2");
    expect(result.ok).toBe(false);
    expect(isLooseSectionEnd(project, "spur", 2)).toBe(false);
  });

  it("moves junction members with the anchor point", () => {
    const project = openTJunction();
    const host = project.centerlines.find((section) => section.id === "host")!;
    host.points[1] = [70, 5];
    syncSectionJunctions(project);
    const spur = project.centerlines.find((section) => section.id === "spur")!;
    expect(spur.points[spur.points.length - 1]).toEqual([70, 5]);
  });

  it("removes a junction and leaves a gap between sections", () => {
    const project = openTJunction();
    const result = removeJunctionWithGap(project, "j1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.junctions).toHaveLength(0);
    expect(result.project.centerlines).toHaveLength(2);
    const spur = result.project.centerlines.find((section) => section.id === "spur")!;
    expect(spur.points).toHaveLength(2);
    expect(spur.points[spur.points.length - 1]).toEqual([50, 20]);
    expectValid(result.project);
  });

  it("removes a loop-spur junction cleanly", () => {
    const project = parseVenue(loopSpurFixture);
    const result = removeJunctionWithGap(project, "junction-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.junctions).toHaveLength(0);
    expectValid(result.project);
  });

  it("closes a split loop by joining its loose ends", () => {
    const project = parseVenue({
      schema: "track-ed/project@3",
      name: "Square",
      generator: "track-ed v1",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 20, mode: "conform" },
      spawn: { centerline: "loop", fraction: 0.1, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "loop",
          closed: true,
          points: [
            { id: "p0", position: [0, 0] },
            { id: "p1", position: [100, 0] },
            { id: "p2", position: [100, 100] },
            { id: "p3", position: [0, 100] },
          ],
        },
      ],
    });
    const split = splitClosedSection(project, "loop", 1);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    const open = split.project.centerlines.find((section) => section.id === "loop")!;
    const lastIndex = open.points.length - 1;
    open.points[lastIndex] = [open.points[0]![0] + 0.5, open.points[0]![1] + 0.5];
    const closed = closeSectionLoop(split.project, "loop", lastIndex, 0);
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.project.centerlines[0]!.closed).toBe(true);
    expectValid(closed.project);
  });

  it("merges two loose ends into one section and remaps spawn", () => {
    const project = parseVenue({
      schema: "track-ed/project@3",
      name: "Merge",
      generator: "track-ed v1",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 20, mode: "conform" },
      spawn: { centerline: "b", fraction: 0.5, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "a",
          closed: false,
          points: [
            { id: "a0", position: [0, 0] },
            { id: "a1", position: [20, 0] },
            { id: "a2", position: [40, 0] },
          ],
        },
        {
          id: "b",
          closed: false,
          points: [
            { id: "b0", position: [40, 20] },
            { id: "b1", position: [40, 10] },
            { id: "b2", position: [40, 0] },
          ],
        },
      ],
    });
    const result = mergeLooseSectionEnds(project, "a", 2, "b", 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const merged = result.project.centerlines[0]!;
    expect(result.project.centerlines).toHaveLength(1);
    expect(merged.id).toBe("a");
    expect(merged.points).toEqual([
      [0, 0],
      [20, 0],
      [40, 0],
      [40, 10],
      [40, 20],
    ]);
    expect(result.project.spawn.centerline).toBe("a");
    expectValid(result.project);
  });

  it("splits an open section into two capped sections", () => {
    const project = parseVenue({
      schema: "track-ed/project@3",
      name: "Straight",
      generator: "track-ed v1",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 20, mode: "conform" },
      spawn: { centerline: "road", fraction: 0.2, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "road",
          closed: false,
          spline: { type: "catmull-rom", samplesPerSegment: 12 },
          points: [
            { id: "p0", position: [0, 0] },
            { id: "p1", position: [50, 0] },
            { id: "p2", position: [100, 0] },
            { id: "p3", position: [150, 0] },
          ],
        },
      ],
    });
    const result = splitOpenSection(project, "road", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.centerlines).toHaveLength(2);
    expect(result.project.centerlines[0]!.points.length).toBeLessThan(4);
    expect(result.project.centerlines[1]!.points.length).toBeLessThan(4);
    expect(result.project.centerlines.every((section) => section.spline)).toBe(true);
    expectValid(result.project);
  });

  it("keeps the spline and a compact point count on fallback splits", () => {
    const project = venue();
    const result = splitClosedSection(project, "loop-b", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const split = result.project.centerlines.find((section) => section.id === "loop-b")!;
    expect(split.closed).toBe(false);
    expect(split.spline).toBeTruthy();
    expect(split.points.length).toBeLessThanOrEqual(15);
    expectValid(result.project);
  });

  it("splits a simple square loop", () => {
    const project = parseVenue({
      schema: "track-ed/project@3",
      name: "Square",
      generator: "track-ed v1",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 20, mode: "conform" },
      spawn: { centerline: "loop", fraction: 0.1, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "loop",
          closed: true,
          points: [
            { id: "p0", position: [0, 0] },
            { id: "p1", position: [100, 0] },
            { id: "p2", position: [100, 100] },
            { id: "p3", position: [0, 100] },
          ],
        },
      ],
    });
    const result = splitClosedSection(project, "loop", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectValid(result.project);
  });

  it("splits a closed loop into one open section with a road-width gap", () => {
    const project = parseVenue({
      ...venueFixture,
      spawn: { centerline: "loop-a", fraction: 0.1, lateral: 0 },
      sections: [venueFixture.sections.find((section) => section.id === "loop-a")!],
    });
    const loop = project.centerlines.find((section) => section.id === "loop-a")!;
    const result = splitClosedSection(project, "loop-a", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const split = result.project.centerlines.find((section) => section.id === "loop-a")!;
    expect(split.closed).toBe(false);
    expect(split.spline).toEqual(loop.spline);
    expect(split.points).toHaveLength(loop.points.length + 2);
    const start = split.points[0]!;
    const end = split.points[split.points.length - 1]!;
    expect(Math.hypot(start[0] - end[0], start[1] - end[1])).toBeGreaterThanOrEqual(
      project.road.halfWidth * 2 - 1e-6,
    );
    expectValid(result.project);
  });
});
