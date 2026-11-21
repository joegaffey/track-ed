import { describe, expect, it } from "vitest";
import loopFixture from "../../fixtures/projects/loop.json";
import branch30 from "../../fixtures/projects/loop-with-branch-30.json";
import { bakeProject } from "./bake";
import { parseProject } from "./project";
import { validateBakedTrack } from "./validate-baked";

function loadProject(input: unknown) {
  const parsed = parseProject(input);
  expect(parsed.issues).toEqual([]);
  return parsed.project!;
}

describe("implicit race layout", () => {
  it("builds a closed one-leg layout on a closed spawn section", () => {
    const track = bakeProject(loadProject(loopFixture));
    const race = track.race;

    expect(race).toBeDefined();
    expect(race!.version).toBe(1);
    expect(race!.layout.layout_id).toBe("main");
    expect(race!.layout.closed).toBe(true);
    expect(race!.layout.direction).toBe("forward");
    expect(race!.layout.points.length).toBeGreaterThanOrEqual(3);
    expect(race!.layout.half_width).toBe(5);
    expect(race!.layout.points[0]).toEqual(race!.start_finish.position);
    expect(race!.start_finish.section_id).toBe("main");
    expect(race!.start_finish.fraction).toBe(0);
    expect(race!.grid).toHaveLength(8);
    expect(race!.sectors).toHaveLength(4);
    expect(
      race!.sectors.map((sector) => [
        sector.start_fraction,
        sector.end_fraction,
      ]),
    ).toEqual([
      [0, 0.25],
      [0.25, 0.5],
      [0.5, 0.75],
      [0.75, 1],
    ]);
    expect(track.warnings ?? []).toEqual([]);
    expect(validateBakedTrack(track).ok).toBe(true);
  });

  it("rotates the route so index 0 is nearest the spawn fraction", () => {
    const value = structuredClone(loopFixture) as {
      spawn: { centerline: string; fraction: number; lateral: number };
    };
    value.spawn.fraction = 0.5;
    const track = bakeProject(loadProject(value));
    const race = track.race;
    const spawn = track.spawns[0]!;

    expect(race).toBeDefined();
    expect(race!.start_finish.fraction).toBe(0.5);
    expect(race!.layout.points[0]![0]).toBeCloseTo(spawn.position[0], 0);
    expect(race!.layout.points[0]![2]).toBeCloseTo(spawn.position[2], 0);
    expect(
      Math.hypot(
        race!.layout.points[0]![0] - spawn.position[0],
        race!.layout.points[0]![2] - spawn.position[2],
      ),
    ).toBeLessThanOrEqual(2);
  });

  it("omits race for an open spawn section and warns", () => {
    const value = structuredClone(branch30) as {
      spawn: { centerline: string; fraction: number; lateral: number };
    };
    value.spawn.centerline = "branch-30";
    value.spawn.fraction = 0.5;
    value.spawn.lateral = 0;

    const track = bakeProject(loadProject(value));
    const report = validateBakedTrack(track);

    expect(track.race).toBeUndefined();
    expect(track.warnings?.some((warning) => warning.includes("open"))).toBe(true);
    expect(report.ok).toBe(true);
    expect(
      report.violations.some(
        (violation) => violation.rule === "RC1" && violation.severity === "warning",
      ),
    ).toBe(true);
  });

  it("rejects race data whose start/finish does not match the route", () => {
    const track = structuredClone(bakeProject(loadProject(loopFixture)));
    track.race!.start_finish.position = [1000, 0, 1000];

    const report = validateBakedTrack(track);

    expect(report.ok).toBe(false);
    expect(
      report.violations.some(
        (violation) => violation.rule === "RC1" && violation.severity === "error",
      ),
    ).toBe(true);
  });

  it("rejects grid slots outside the road", () => {
    const track = structuredClone(bakeProject(loadProject(loopFixture)));
    track.race!.grid[0]!.position = [1000, 0, 1000];

    const report = validateBakedTrack(track);

    expect(report.ok).toBe(false);
    expect(
      report.violations.some(
        (violation) =>
          violation.rule === "RC1" &&
          violation.severity === "error" &&
          violation.message.includes("grid slot 0"),
      ),
    ).toBe(true);
  });

  it("keeps the racing line independent from the race route", () => {
    const track = bakeProject(loadProject(loopFixture));
    const withoutRace = structuredClone(track);
    delete withoutRace.race;
    delete withoutRace.warnings;

    expect(track.racingLine).toBeDefined();
    expect(track.racingLine).toEqual(withoutRace.racingLine);
    expect(track.surfaceGraph).toEqual(withoutRace.surfaceGraph);
  });
});
