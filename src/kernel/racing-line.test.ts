import { describe, expect, it } from "vitest";
import loopFixture from "../../fixtures/projects/loop.json";
import followFixture from "../../fixtures/projects/loop-spline-terrain-follow.json";
import venueFixture from "../../fixtures/projects/venue-two-loops-spur.json";
import { bakeProject } from "./bake";
import { parseProject } from "./project";
import { rawTerrainHeight } from "./terrain";
import { validateBakedTrack } from "./validate-baked";

function bake(fixture: unknown) {
  const parsed = parseProject(fixture);
  expect(parsed.issues).toEqual([]);
  return { project: parsed.project!, track: bakeProject(parsed.project!) };
}

describe("racing line", () => {
  it("bakes a deterministic visual-only ribbon for the loop", () => {
    const { project, track } = bake(loopFixture);
    const line = track.racingLine;

    expect(line).toBeDefined();
    expect(line!.positions.length).toBeGreaterThan(0);
    expect(line!.uvs).toHaveLength(line!.positions.length);
    expect(line!.indices.length % 3).toBe(0);
    expect(line!.indices.length).toBeGreaterThan(0);
    for (const position of line!.positions) {
      expect(position[1]).toBeCloseTo(0.02, 9);
    }
    const a = line!.positions[line!.indices[0]!]!;
    const b = line!.positions[line!.indices[1]!]!;
    const c = line!.positions[line!.indices[2]!]!;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    expect(ab[2]! * ac[0]! - ab[0]! * ac[2]!).toBeGreaterThan(0);
    expect(bakeProject(project)).toEqual(track);
  });

  it("bakes one ribbon per venue section", () => {
    const { track } = bake(venueFixture);
    const line = track.racingLine;

    expect(line).toBeDefined();
    expect(line!.positions.length).toBeGreaterThan(1000);
    expect(line!.indices.length / 3).toBeGreaterThan(500);
  });

  it("follows the terrain height in follow mode", () => {
    const { project, track } = bake(followFixture);
    const elevation = project.terrain.elevation!;
    const line = track.racingLine;

    expect(line).toBeDefined();
    for (const position of line!.positions) {
      expect(position[1]).toBeCloseTo(
        rawTerrainHeight(elevation, [position[0], position[2]]) + 0.02,
        6,
      );
    }
  });

  it("validates racing line indices and uvs", () => {
    const { track } = bake(loopFixture);
    const badIndex = structuredClone(track);
    badIndex.racingLine!.indices[0] = 9999;
    expect(
      validateBakedTrack(badIndex).violations.some(
        (violation) => violation.rule === "BM14",
      ),
    ).toBe(true);

    const badUv = structuredClone(track);
    badUv.racingLine!.uvs.pop();
    expect(
      validateBakedTrack(badUv).violations.some(
        (violation) => violation.rule === "BM14",
      ),
    ).toBe(true);
  });
});
