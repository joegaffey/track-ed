import type { MultiPolygon2, Ring2 } from "./boolean";
import { distancePointToSegmentSq, pointOnSegmentParameter, type Vec2 } from "./math2";

const ON_EDGE_EPSILON = 1e-5;
const POINT_EPSILON = 1e-5;
const POINT_KEY_SCALE = 1e7;

function pointKey(point: Vec2): string {
  return `${Math.round(point[0] * POINT_KEY_SCALE)}:${Math.round(point[1] * POINT_KEY_SCALE)}`;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a[0] - b[0]) <= POINT_EPSILON && Math.abs(a[1] - b[1]) <= POINT_EPSILON;
}

function collectAnchors(multiPolygons: readonly MultiPolygon2[]): Vec2[] {
  const anchors = new Map<string, Vec2>();
  for (const multiPolygon of multiPolygons) {
    for (const polygon of multiPolygon) {
      for (const ring of polygon) {
        for (const point of ring) {
          const key = pointKey(point);
          if (!anchors.has(key)) {
            anchors.set(key, [point[0], point[1]]);
          }
        }
      }
    }
  }
  return [...anchors.values()];
}

function cleanRing(points: Vec2[]): Vec2[] {
  const result: Vec2[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || !samePoint(previous, point)) {
      result.push([point[0], point[1]]);
    }
  }
  while (result.length > 1 && samePoint(result[0]!, result[result.length - 1]!)) {
    result.pop();
  }
  return result;
}

function splitRing(ring: Ring2, anchors: readonly Vec2[]): Ring2 {
  if (ring.length < 3) {
    return cleanRing(ring.map((point) => [point[0], point[1]]));
  }

  const result: Vec2[] = [];
  const inserted: Vec2[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    result.push([a[0], a[1]]);

    const candidates: Array<{ parameter: number; point: Vec2 }> = [];
    for (const anchor of anchors) {
      if (samePoint(anchor, a) || samePoint(anchor, b)) {
        continue;
      }
      if (ring.some((point) => samePoint(point, anchor))) {
        continue;
      }
      if (inserted.some((point) => samePoint(point, anchor))) {
        continue;
      }
      const parameter = pointOnSegmentParameter(anchor, a, b);
      if (parameter <= 1e-9 || parameter >= 1 - 1e-9) {
        continue;
      }
      if (distancePointToSegmentSq(anchor, a, b) > ON_EDGE_EPSILON * ON_EDGE_EPSILON) {
        continue;
      }
      candidates.push({ parameter, point: anchor });
    }

    candidates.sort((left, right) => left.parameter - right.parameter);
    for (const candidate of candidates) {
      const previous = result[result.length - 1]!;
      if (!samePoint(previous, candidate.point)) {
        result.push([candidate.point[0], candidate.point[1]]);
        inserted.push(candidate.point);
      }
    }
  }

  return cleanRing(result);
}

export function conformMultiPolygons(multiPolygons: readonly MultiPolygon2[]): MultiPolygon2[] {
  const anchors = collectAnchors(multiPolygons);
  return multiPolygons.map((multiPolygon) =>
    multiPolygon.map((polygon) => polygon.map((ring) => splitRing(ring, anchors))),
  );
}
