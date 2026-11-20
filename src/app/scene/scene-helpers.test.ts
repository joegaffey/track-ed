import { describe, expect, it } from "vitest";
import type { EdgeInfo } from "../../kernel/topology";
import {
  centerlineOverlayPositions,
  propHash,
  terrainPointPositions,
} from "./overlays";
import { triangleArea } from "./picking";
import { edgePositions } from "./surfaces";

function expectClose(actual: ArrayLike<number>, expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index]!);
  }
}

describe("triangleArea", () => {
  it("returns half the cross-product magnitude", () => {
    expect(triangleArea([0, 0, 0], [2, 0, 0], [0, 0, 3])).toBeCloseTo(3);
  });

  it("returns zero for degenerate triangles", () => {
    expect(triangleArea([0, 0, 0], [1, 0, 0], [2, 0, 0])).toBe(0);
  });
});

describe("centerlineOverlayPositions", () => {
  it("raises sampled line and control points by their fixed offsets", () => {
    const { linePositions, pointPositions } = centerlineOverlayPositions({
      id: "main",
      closed: true,
      points: [
        [1, 2],
        [3, 4],
      ],
      pointHeights: [5, 6],
      linePoints: [
        [7, 8],
        [9, 10],
      ],
      lineHeights: [11, 12],
    });

    expectClose(linePositions, [7, 11.14, 8, 9, 12.14, 10]);
    expectClose(pointPositions, [1, 5.16, 2, 3, 6.16, 4]);
  });

  it("falls back to control points and zero heights", () => {
    const { linePositions, pointPositions } = centerlineOverlayPositions({
      id: "branch",
      closed: false,
      points: [
        [1, 2],
        [3, 4],
      ],
    });

    expectClose(linePositions, [1, 0.14, 2, 3, 0.14, 4]);
    expectClose(pointPositions, [1, 0.16, 2, 3, 0.16, 4]);
  });
});

describe("terrainPointPositions", () => {
  it("places markers above each authored height", () => {
    const positions = terrainPointPositions([
      { position: [1, 2], height: 3 },
      { position: [4, 5], height: 6 },
    ]);

    expectClose(positions, [1, 3.3, 2, 4, 6.3, 5]);
  });
});

describe("edgePositions", () => {
  it("lifts each edge endpoint above the welded surface", () => {
    const edges: EdgeInfo[] = [{ a: 0, b: 1 } as EdgeInfo];
    const positions = edgePositions(edges, [
      [1, 2, 3],
      [4, 5, 6],
    ]);

    expectClose(positions, [1, 2.02, 3, 4, 5.02, 6]);
  });
});

describe("propHash", () => {
  it("is deterministic and normalised", () => {
    const first = propHash("tree-1", 4);
    const second = propHash("tree-1", 4);

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(1);
  });

  it("changes with the id and salt", () => {
    expect(propHash("tree-1", 4)).not.toBe(propHash("tree-2", 4));
    expect(propHash("tree-1", 4)).not.toBe(propHash("tree-1", 5));
  });
});
