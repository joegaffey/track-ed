import { describe, expect, it } from "vitest";
import loopFixture from "../../fixtures/projects/loop.json";
import { bakeProject } from "./bake";
import { parseProject } from "./project";
import { samplePolyline, segmentLengths, type Vec2 } from "./geometry";
import { leftNormal, scale2, signedArea2 } from "./math2";
import { validateBakedTrack } from "./validate-baked";

function withBranch(fraction: number) {
  const value = structuredClone(loopFixture) as {
    centerlines: Array<{
      id: string;
      closed: boolean;
      points: number[][];
      attach?: { to: string; fraction: number };
    }>;
  };
  const main = value.centerlines[0]!;
  const points = main.points as Vec2[];
  const sample = samplePolyline(points, true, fraction);
  const side = signedArea2(points) > 0 ? -1 : 1;
  const outward = scale2(leftNormal(sample.tangent), side * 30);
  value.centerlines.push({
    id: "branch",
    closed: false,
    attach: { to: "main", fraction },
    points: [
      [sample.position[0], sample.position[1]],
      [sample.position[0] + outward[0], sample.position[1] + outward[1]],
      [sample.position[0] + outward[0] * 2, sample.position[1] + outward[1] * 2],
    ],
  });
  return value;
}

describe("junctions near main control points", () => {
  it("bakes valid surfaces on both sides of every control point", () => {
    const parsed = parseProject(loopFixture);
    const main = parsed.project!.centerlines[0]!;
    const lengths = segmentLengths(main.points as Vec2[], true);
    const total = lengths.reduce((sum, length) => sum + length, 0);
    const deltas = [0, 0.00005, 0.0002, 0.001, 0.003, 0.008, 0.02];
    const failures: string[] = [];

    let travelled = 0;
    for (const length of lengths) {
      travelled += length;
      const base = travelled / total;
      for (const delta of deltas) {
        for (const sign of [-1, 1]) {
          const fraction = Math.min(0.998, Math.max(0.001, base + sign * delta));
          const project = parseProject(withBranch(fraction)).project;
          if (!project) {
            failures.push(`${fraction}: project validation failed`);
            continue;
          }
          try {
            const track = bakeProject(project);
            const report = validateBakedTrack(track);
            if (!report.ok) {
              failures.push(
                `${fraction}: ${report.violations
                  .filter((violation) => violation.severity === "error")
                  .map((violation) => violation.message)
                  .join("; ")}`,
              );
            }
          } catch (error) {
            failures.push(`${fraction}: ${String(error)}`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
