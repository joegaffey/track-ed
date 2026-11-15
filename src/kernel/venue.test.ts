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
