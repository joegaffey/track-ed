import { describe, expect, it } from "vitest";
import loopFixture from "../../fixtures/projects/loop.json";
import { bakeProject } from "./bake";
import { parseProject } from "./project";
import { validateBakedTrack } from "./validate-baked";
import type { BakedTrack } from "../model/baked-track";

function validTrack(): BakedTrack {
  const parsed = parseProject(loopFixture);
  return bakeProject(parsed.project!);
}

describe("validateBakedTrack", () => {
  it("accepts a freshly baked loop", () => {
    expect(validateBakedTrack(validTrack()).ok).toBe(true);
  });

  it("detects an open hole", () => {
    const track = structuredClone(validTrack());
    track.surfaceGraph.indices.splice(0, 3);
    track.surfaceGraph.triangleSurfaces.shift();
    const report = validateBakedTrack(track);
    expect(report.ok).toBe(false);
    expect(report.topology.interiorBoundaryEdges.length).toBeGreaterThan(0);
  });

  it("detects duplicate and overlapping triangles", () => {
    const track = structuredClone(validTrack());
    track.surfaceGraph.indices.push(
      track.surfaceGraph.indices[0]!,
      track.surfaceGraph.indices[1]!,
      track.surfaceGraph.indices[2]!,
    );
    track.surfaceGraph.triangleSurfaces.push(track.surfaceGraph.triangleSurfaces[0]!);
    const report = validateBakedTrack(track);
    expect(report.ok).toBe(false);
    expect(report.topology.duplicateTriangles.length).toBeGreaterThan(0);
    expect(report.topology.overlapPairs.length).toBeGreaterThan(0);
  });

  it("detects reversed winding", () => {
    const track = structuredClone(validTrack());
    const first = track.surfaceGraph.indices[0]!;
    track.surfaceGraph.indices[0] = track.surfaceGraph.indices[1]!;
    track.surfaceGraph.indices[1] = first;
    const report = validateBakedTrack(track);
    expect(report.ok).toBe(false);
    expect(report.topology.badWindingTriangles.length).toBeGreaterThan(0);
  });

  it("detects an invalid triangle surface assignment", () => {
    const track = structuredClone(validTrack());
    track.surfaceGraph.triangleSurfaces[0] = 99;
    const report = validateBakedTrack(track);
    expect(report.ok).toBe(false);
    expect(report.violations.some((violation) => violation.rule === "BM3")).toBe(true);
  });
});
