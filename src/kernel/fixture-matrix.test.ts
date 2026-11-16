import { describe, expect, it } from "vitest";
import { bakeProject } from "./bake";
import { parseProject } from "./project";
import { validateBakedTrack } from "./validate-baked";

const fixtureModules = import.meta.glob("../../fixtures/projects/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;
const fixtures = Object.entries(fixtureModules).sort(([a], [b]) => a.localeCompare(b));

describe("fixture matrix", () => {
  it("finds every checked-in project fixture", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(17);
  });

  it.each(fixtures)("parses, bakes, and validates %s", (_path, input) => {
    const parsed = parseProject(input);
    expect(parsed.issues).toEqual([]);
    expect(parsed.project).not.toBeNull();

    const track = bakeProject(parsed.project!);
    const report = validateBakedTrack(track);
    expect(report.violations.filter((violation) => violation.severity === "error")).toEqual(
      [],
    );
    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.nonManifoldEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
    expect(report.topology.overlapPairs).toHaveLength(0);
    expect(track.length).toBeGreaterThan(0);
    expect(track.surfaceGraph.indices.length % 3).toBe(0);
  });
});
