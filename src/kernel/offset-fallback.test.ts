import { describe, expect, it } from "vitest";
import loopSpline from "../../fixtures/projects/loop-spline.json";
import { parseProject } from "./project";
import { bakeProject } from "./bake";
import { validateBakedTrack } from "./validate-baked";

const tightPoints: Array<[number, number]> = [
  [7.100047329929671, 18.072809382125925],
  [84.82348883054766, -20.462492177137754],
  [92.01048990176304, 62.50441383745159],
  [101.22777230018465, 99.47344782400724],
  [2.5254185026337916, 64.02582761110408],
  [-27.495726314954396, 27.948339831304814],
];

describe("tight offset fallback", () => {
  it("cleans a self-intersecting inner offset with the clipper", () => {
    const parsed = parseProject(loopSpline);
    expect(parsed.issues).toEqual([]);
    const project = structuredClone(parsed.project!);
    project.centerlines[0]!.points = tightPoints;

    const track = bakeProject(project);
    const report = validateBakedTrack(track);

    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.nonManifoldEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
    expect(report.topology.overlapPairs).toHaveLength(0);
  });
});
