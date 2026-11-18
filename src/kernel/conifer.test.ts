import { describe, expect, it } from "vitest";
import {
  CONIFER_SIZE,
  buildConiferFoliage,
  coniferTierSet,
  coniferTone,
  coniferTrunk,
} from "./conifer";

function triangleArea(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  const abx = b[0]! - a[0]!;
  const aby = b[1]! - a[1]!;
  const abz = b[2]! - a[2]!;
  const acx = c[0]! - a[0]!;
  const acy = c[1]! - a[1]!;
  const acz = c[2]! - a[2]!;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return Math.hypot(nx, ny, nz) / 2;
}

describe("conifer props", () => {
  it("builds deterministic layered foliage", () => {
    const first = buildConiferFoliage("tree-1", 0.1, CONIFER_SIZE);
    const second = buildConiferFoliage("tree-1", 0.1, CONIFER_SIZE);

    expect(first).toEqual(second);
    expect(first.positions.length).toBeGreaterThan(0);
    expect(first.indices.length % 3).toBe(0);
    for (const position of first.positions) {
      expect(Number.isFinite(position[0])).toBe(true);
      expect(Number.isFinite(position[1])).toBe(true);
      expect(Number.isFinite(position[2])).toBe(true);
    }
    for (let index = 0; index < first.indices.length; index += 1) {
      expect(first.indices[index]).toBeGreaterThanOrEqual(0);
      expect(first.indices[index]).toBeLessThan(first.positions.length);
    }
  });

  it("adds detail with taller variants", () => {
    const tall = coniferTierSet(0.1);
    const broad = coniferTierSet(0.5);
    const young = coniferTierSet(0.9);

    expect(tall.length).toBeGreaterThan(broad.length);
    expect(broad.length).toBeGreaterThan(young.length);
    expect(buildConiferFoliage("tree-1", 0.1, CONIFER_SIZE).indices.length).toBeGreaterThan(
      buildConiferFoliage("tree-1", 0.9, CONIFER_SIZE).indices.length,
    );
  });

  it("mixes foliage tones across a stand", () => {
    const tones = new Set(
      Array.from({ length: 64 }, (_, index) =>
        coniferTone(`tree-${index}`, 0.2),
      ),
    );
    expect(tones.size).toBeGreaterThan(1);
  });

  it("keeps the trunk separate and solid", () => {
    for (const variant of [0.1, 0.5, 0.9]) {
      const trunk = coniferTrunk(variant);
      expect(trunk.height).toBeGreaterThan(0);
      expect(trunk.radius).toBeGreaterThan(0);
    }
  });

  it("emits non-degenerate triangles", () => {
    const tree = buildConiferFoliage("tree-2", 0.5, CONIFER_SIZE);
    for (let index = 0; index < tree.indices.length; index += 3) {
      const a = tree.positions[tree.indices[index]!]!;
      const b = tree.positions[tree.indices[index + 1]!]!;
      const c = tree.positions[tree.indices[index + 2]!]!;
      expect(triangleArea(a, b, c)).toBeGreaterThan(1e-8);
    }
  });
});
