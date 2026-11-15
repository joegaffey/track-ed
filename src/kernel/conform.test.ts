import { describe, expect, it } from "vitest";
import type { MultiPolygon2 } from "./boolean";
import { conformMultiPolygons } from "./conform";

describe("conformMultiPolygons", () => {
  it("removes consecutive duplicate boundary vertices", () => {
    const input: MultiPolygon2 = [
      [
        [
          [0, 0],
          [5, 0],
          [5, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
    ];
    const [result] = conformMultiPolygons([input]);
    const ring = result![0]![0]!;
    expect(ring).toHaveLength(5);
    for (let i = 0; i < ring.length; i += 1) {
      const current = ring[i]!;
      const next = ring[(i + 1) % ring.length]!;
      expect(Math.hypot(current[0] - next[0], current[1] - next[1])).toBeGreaterThan(1e-9);
    }
  });

  it("inserts a shared anchor into an edge", () => {
    const square: MultiPolygon2 = [[[[0, 0], [10, 0], [10, 10], [0, 10]]]];
    const neighbour: MultiPolygon2 = [
      [
        [
          [5, 0],
          [5, 4],
          [6, 4],
          [6, 0],
        ],
      ],
    ];

    const [conformed] = conformMultiPolygons([square, neighbour]);
    const ring = conformed![0]![0]!;
    expect(ring).toHaveLength(6);
    expect(ring.some((point) => Math.abs(point[0] - 5) <= 1e-9 && Math.abs(point[1]) <= 1e-9)).toBe(
      true,
    );
    expect(ring.some((point) => Math.abs(point[0] - 6) <= 1e-9 && Math.abs(point[1]) <= 1e-9)).toBe(
      true,
    );
  });
});
