import {
  difference as clipDifference,
  union as clipUnion,
  type MultiPolygon,
} from "polygon-clipping";
import {
  booleanOpDWithPolyTree,
  ClipType,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
  PolyTreeD,
  type PathsD,
  type PolyPathD,
} from "clipper2-ts";
import type { Vec2 } from "./math2";

export type Ring2 = Vec2[];
export type Polygon2 = Ring2[];
export type MultiPolygon2 = Polygon2[];

const SNAP = 1e-6;

function snapValue(value: number): number {
  return Math.round(value / SNAP) * SNAP;
}

function snapRing(ring: Ring2): Ring2 {
  const result: Ring2 = [];
  for (const point of ring) {
    const snapped: Vec2 = [snapValue(point[0]), snapValue(point[1])];
    const previous = result[result.length - 1];
    if (!previous || previous[0] !== snapped[0] || previous[1] !== snapped[1]) {
      result.push(snapped);
    }
  }
  while (
    result.length > 1 &&
    result[0]![0] === result[result.length - 1]![0] &&
    result[0]![1] === result[result.length - 1]![1]
  ) {
    result.pop();
  }
  return result;
}

function snapMultiPolygon(multiPolygon: MultiPolygon2): MultiPolygon2 {
  return multiPolygon.map((polygon) => polygon.map((ring) => snapRing(ring)));
}

function toPathsD(polygons: readonly Polygon2[]): PathsD {
  return polygons.flatMap((polygon) =>
    polygon.map((ring) => ring.map((point) => ({ x: point[0], y: point[1] }))),
  );
}

function fromPolyTree(tree: PolyPathD): MultiPolygon2 {
  const result: MultiPolygon2 = [];

  const visit = (node: PolyPathD, depth: number, parent: Polygon2 | null): void => {
    for (let index = 0; index < node.count; index += 1) {
      const child = node.child(index);
      const path = child.poly;
      if (!path || path.length < 3) {
        continue;
      }
      const ring: Ring2 = path.map((point) => [point.x, point.y]);
      if (depth % 2 === 0) {
        const polygon: Polygon2 = [ring];
        result.push(polygon);
        visit(child, depth + 1, polygon);
      } else if (parent) {
        parent.push(ring);
        visit(child, depth + 1, parent);
      }
    }
  };

  visit(tree, 0, null);
  return result;
}

function booleanFallback(
  type: ClipType,
  subject: readonly Polygon2[],
  clip: readonly Polygon2[] | null,
): MultiPolygon2 {
  const tree = new PolyTreeD();
  booleanOpDWithPolyTree(
    type,
    toPathsD(subject),
    clip ? toPathsD(clip) : null,
    tree,
    FillRule.EvenOdd,
    8,
  );
  return snapMultiPolygon(fromPolyTree(tree));
}

function openRing(ring: readonly (readonly [number, number])[]): Ring2 {
  const points: Ring2 = ring.map((point) => [point[0], point[1]]);
  if (points.length > 1) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (Math.abs(first[0] - last[0]) <= 1e-9 && Math.abs(first[1] - last[1]) <= 1e-9) {
      points.pop();
    }
  }
  return points;
}

function normalizeOutput(multiPolygon: MultiPolygon): MultiPolygon2 {
  return snapMultiPolygon(
    multiPolygon.map((polygon) => polygon.map((ring) => openRing(ring))),
  );
}

export function unionPolygons(a: Polygon2, b: Polygon2): MultiPolygon2 {
  try {
    return normalizeOutput(clipUnion(a, b));
  } catch {
    return booleanFallback(ClipType.Union, [a], [b]);
  }
}

export function differencePolygons(a: MultiPolygon2, b: MultiPolygon2): MultiPolygon2 {
  try {
    return normalizeOutput(clipDifference(a, b));
  } catch {
    return booleanFallback(ClipType.Difference, a, b);
  }
}

export function normalizeMultiPolygon(multiPolygon: MultiPolygon2): MultiPolygon2 {
  const snapped = snapMultiPolygon(multiPolygon);
  try {
    return normalizeOutput(clipUnion(snapped));
  } catch {
    return booleanFallback(ClipType.Union, snapped, null);
  }
}

export function offsetPolygonClipper(
  points: readonly Vec2[],
  delta: number,
): Ring2[] {
  const paths = inflatePathsD(
    [points.map((point) => ({ x: point[0], y: point[1] }))],
    delta,
    JoinType.Miter,
    EndType.Polygon,
    2,
    8,
  );

  return paths.map((path) => {
    const ring: Ring2 = [];
    for (const point of path) {
      const next: Vec2 = [point.x, point.y];
      const previous = ring[ring.length - 1];
      if (!previous || previous[0] !== next[0] || previous[1] !== next[1]) {
        ring.push(next);
      }
    }
    while (
      ring.length > 1 &&
      ring[0]![0] === ring[ring.length - 1]![0] &&
      ring[0]![1] === ring[ring.length - 1]![1]
    ) {
      ring.pop();
    }
    return ring;
  });
}

export function unionManyPolygons(polygons: readonly Polygon2[]): MultiPolygon2 {
  if (polygons.length === 0) {
    return [];
  }
  const [first, ...rest] = polygons;
  if (!first) {
    return [];
  }
  try {
    return normalizeOutput(clipUnion(first, ...rest));
  } catch {
    let result: MultiPolygon2 = snapMultiPolygon([first]);
    result = snapMultiPolygon(result);
    for (let index = 1; index < polygons.length; index += 1) {
      const next = polygons[index];
      if (!next) {
        continue;
      }
      result = booleanFallback(ClipType.Union, result, [next]);
    }
    return result;
  }
}
