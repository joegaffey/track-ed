import { describe, expect, it } from "vitest";
import loopFixture from "../../fixtures/projects/loop.json";
import { bakeProject, BakeError } from "./bake";
import { parseProject } from "./project";
import { samplePolyline, type Vec2 } from "./geometry";
import { signedArea2 } from "./math2";

function rng(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(value, 1664525) + 1013904223;
    return (value >>> 0) / 0xffffffff;
  };
}

describe("branch robustness", () => {
  it("never leaks raw clipping or triangulation errors", () => {
    const random = rng(12345);
    let baked = 0;
    const rawErrors: string[] = [];

    for (let i = 0; i < 80; i += 1) {
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
      const fraction = 0.01 + random() * 0.97;
      const sample = samplePolyline(points, true, fraction);
      const side = signedArea2(points) > 0 ? -1 : 1;
      const baseAngle =
        Math.atan2(sample.tangent[1], sample.tangent[0]) + (Math.PI / 2) * side;
      const angle1 = baseAngle + (random() - 0.5) * Math.PI * 0.8;
      const angle2 = angle1 + (random() - 0.5) * Math.PI * 0.5;
      const length1 = 10 + random() * 90;
      const length2 = 10 + random() * 90;
      const p1: [number, number] = [
        sample.position[0] + Math.cos(angle1) * length1,
        sample.position[1] + Math.sin(angle1) * length1,
      ];
      const p2: [number, number] = [
        p1[0] + Math.cos(angle2) * length2,
        p1[1] + Math.sin(angle2) * length2,
      ];

      value.centerlines.push({
        id: "branch",
        closed: false,
        attach: { to: "main", fraction },
        points: [
          [sample.position[0], sample.position[1]],
          p1,
          p2,
        ],
      });

      const project = parseProject(value).project;
      if (!project) {
        continue;
      }

      try {
        bakeProject(project);
        baked += 1;
      } catch (error) {
        if (!(error instanceof BakeError)) {
          rawErrors.push(String(error));
        }
      }
    }

    expect(baked).toBeGreaterThan(0);
    expect(rawErrors).toEqual([]);
  });
});
