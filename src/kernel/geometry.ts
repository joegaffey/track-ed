import {
  add2,
  distancePointToSegmentSq,
  dot2,
  leftNormal,
  normalize2,
  polylineSelfIntersections,
  scale2,
  signedArea2,
  sub2,
  type Vec2,
} from "./math2";

export { polylineSelfIntersections, type Vec2 };

export function absSignedArea(points: readonly Vec2[]): number {
  return Math.abs(signedArea2(points));
}

export function hasDuplicateConsecutivePoints(
  points: readonly Vec2[],
  closed: boolean,
): boolean {
  if (points.length < 2) {
    return true;
  }
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= 1e-9) {
      return true;
    }
  }
  return false;
}

export function segmentLengths(points: readonly Vec2[], closed: boolean): number[] {
  const lengths: number[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    lengths.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return lengths;
}

export function centerlineLength(points: readonly Vec2[], closed: boolean): number {
  return segmentLengths(points, closed).reduce((sum, value) => sum + value, 0);
}

export function segmentDirections(points: readonly Vec2[], closed: boolean): Vec2[] {
  const count = closed ? points.length : points.length - 1;
  const directions: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    directions.push(normalize2(sub2(b, a)));
  }
  return directions;
}

export function offsetPolyline(
  points: readonly Vec2[],
  closed: boolean,
  side: 1 | -1,
  distance: number,
): Vec2[] {
  const count = points.length;
  if (count < 2) {
    return [];
  }

  const directions = segmentDirections(points, closed);
  if (directions.length === 0) {
    return [];
  }

  const offsetPoints: Vec2[] = [];

  for (let i = 0; i < count; i += 1) {
    if (!closed && i === 0) {
      const normal = leftNormal(directions[0]!);
      offsetPoints.push(add2(points[i]!, scale2(normal, side * distance)));
      continue;
    }
    if (!closed && i === count - 1) {
      const normal = leftNormal(directions[directions.length - 1]!);
      offsetPoints.push(add2(points[i]!, scale2(normal, side * distance)));
      continue;
    }

    const previousDirection = directions[(i - 1 + directions.length) % directions.length]!;
    const nextDirection = directions[i % directions.length]!;
    const previousNormal = leftNormal(previousDirection);
    const nextNormal = leftNormal(nextDirection);
    const bisector = normalize2(add2(previousNormal, nextNormal));
    const denom = dot2(bisector, previousNormal);

    if (Math.abs(denom) <= 1e-9) {
      const normal = leftNormal(nextDirection);
      offsetPoints.push(add2(points[i]!, scale2(normal, side * distance)));
      continue;
    }

    const miterLength = distance / denom;
    offsetPoints.push(add2(points[i]!, scale2(bisector, side * miterLength)));
  }

  return offsetPoints;
}

export interface PolylineSample {
  position: Vec2;
  tangent: Vec2;
}

export function samplePolyline(
  points: readonly Vec2[],
  closed: boolean,
  fraction: number,
): PolylineSample {
  const lengths = segmentLengths(points, closed);
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return { position: [points[0]?.[0] ?? 0, points[0]?.[1] ?? 0], tangent: [1, 0] };
  }

  const target = Math.max(0, Math.min(1, fraction)) * total;
  let travelled = 0;

  for (let i = 0; i < lengths.length; i += 1) {
    const segmentLength = lengths[i]!;
    if (travelled + segmentLength >= target - 1e-12) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const t = segmentLength > 0 ? Math.max(0, Math.min(1, (target - travelled) / segmentLength)) : 0;
      return {
        position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        tangent: normalize2(sub2(b, a)),
      };
    }
    travelled += segmentLength;
  }

  const last = points[points.length - 1]!;
  const first = points[0]!;
  return { position: [last[0], last[1]], tangent: normalize2(sub2(first, last)) };
}

export function simplifyPolyline(
  points: readonly Vec2[],
  closed: boolean,
  epsilon = 1e-9,
): Vec2[] {
  const result = points.map((point) => [point[0], point[1]] as Vec2);
  if (result.length < 3) {
    return result;
  }

  let changed = true;
  while (changed) {
    changed = false;
    const count = result.length;
    const start = closed ? 0 : 1;
    const end = closed ? count - 1 : count - 2;

    for (let i = start; i <= end; i += 1) {
      if (closed && result.length <= 3) {
        break;
      }
      if (!closed && result.length <= 2) {
        break;
      }
      const previous = result[(i - 1 + result.length) % result.length]!;
      const current = result[i]!;
      const next = result[(i + 1) % result.length]!;
      const distance = distancePointToSegmentSq(current, previous, next);
      const dot = dot2(sub2(current, previous), sub2(next, current));
      if (distance <= epsilon * epsilon && dot >= 0) {
        result.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return result;
}

export function isSimplePolygon(points: readonly Vec2[]): boolean {
  if (points.length < 3) {
    return false;
  }
  if (hasDuplicateConsecutivePoints(points, true)) {
    return false;
  }
  return polylineSelfIntersections(points, true).length === 0;
}
