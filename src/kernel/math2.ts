export type Vec2 = [number, number];

export function add2(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function scale2(a: Vec2, s: number): Vec2 {
  return [a[0] * s, a[1] * s];
}

export function dot2(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

export function cross2(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

export function length2(a: Vec2): number {
  return Math.hypot(a[0], a[1]);
}

export function distance2(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function normalize2(a: Vec2): Vec2 {
  const len = length2(a);
  return len > 0 ? [a[0] / len, a[1] / len] : [0, 0];
}

export function leftNormal(direction: Vec2): Vec2 {
  return [-direction[1], direction[0]];
}

export function signedArea2(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

export function polygonCentroid(points: readonly Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const point of points) {
    x += point[0];
    z += point[1];
  }
  const count = Math.max(points.length, 1);
  return [x / count, z / count];
}

export function distancePointToSegmentSq(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub2(b, a);
  const ap = sub2(p, a);
  const lenSq = dot2(ab, ab);
  if (lenSq <= 0) {
    return dot2(ap, ap);
  }
  const t = Math.max(0, Math.min(1, dot2(ap, ab) / lenSq));
  const closest = add2(a, scale2(ab, t));
  const dx = p[0] - closest[0];
  const dz = p[1] - closest[1];
  return dx * dx + dz * dz;
}

export function pointOnSegmentParameter(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub2(b, a);
  const lenSq = dot2(ab, ab);
  if (lenSq <= 0) {
    return 0;
  }
  return dot2(sub2(p, a), ab) / lenSq;
}

function withinSegmentBox(p: Vec2, a: Vec2, b: Vec2, eps: number): boolean {
  return (
    p[0] >= Math.min(a[0], b[0]) - eps &&
    p[0] <= Math.max(a[0], b[0]) + eps &&
    p[1] >= Math.min(a[1], b[1]) - eps &&
    p[1] <= Math.max(a[1], b[1]) + eps
  );
}

export function segmentsIntersect(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
  eps = 1e-9,
): boolean {
  const ab = sub2(b, a);
  const cd = sub2(d, c);
  const ac = sub2(c, a);
  const ad = sub2(d, a);
  const ca = sub2(a, c);
  const cb = sub2(b, c);

  const o1 = cross2(ab, ac);
  const o2 = cross2(ab, ad);
  const o3 = cross2(cd, ca);
  const o4 = cross2(cd, cb);

  if (
    ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) &&
    ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))
  ) {
    return true;
  }

  if (Math.abs(o1) <= eps && withinSegmentBox(c, a, b, eps)) {
    return true;
  }
  if (Math.abs(o2) <= eps && withinSegmentBox(d, a, b, eps)) {
    return true;
  }
  if (Math.abs(o3) <= eps && withinSegmentBox(a, c, d, eps)) {
    return true;
  }
  if (Math.abs(o4) <= eps && withinSegmentBox(b, c, d, eps)) {
    return true;
  }

  return false;
}

export function polylineSelfIntersections(
  points: readonly Vec2[],
  closed: boolean,
): Array<[number, number]> {
  const count = closed ? points.length : points.length - 1;
  const intersections: Array<[number, number]> = [];

  for (let i = 0; i < count; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    for (let j = i + 1; j < count; j += 1) {
      if (j === i + 1 || (closed && i === 0 && j === count - 1)) {
        continue;
      }
      const c = points[j]!;
      const d = points[(j + 1) % points.length]!;
      if (segmentsIntersect(a, b, c, d)) {
        intersections.push([i, j]);
      }
    }
  }

  return intersections;
}

export function lineIntersection(
  p: Vec2,
  directionP: Vec2,
  q: Vec2,
  directionQ: Vec2,
): Vec2 | null {
  const denominator = cross2(directionP, directionQ);
  if (Math.abs(denominator) <= 1e-12) {
    return null;
  }
  const t = cross2(sub2(q, p), directionQ) / denominator;
  return add2(p, scale2(directionP, t));
}

function clipHalfPlane(
  polygon: readonly Vec2[],
  a: Vec2,
  b: Vec2,
  eps: number,
): Vec2[] {
  if (polygon.length === 0) {
    return [];
  }

  const edge = sub2(b, a);
  const output: Vec2[] = [];

  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i]!;
    const previous = polygon[(i + polygon.length - 1) % polygon.length]!;
    const currentInside = cross2(edge, sub2(current, a)) >= -eps;
    const previousInside = cross2(edge, sub2(previous, a)) >= -eps;

    if (currentInside) {
      if (!previousInside) {
        const intersection = lineIntersection(a, edge, previous, sub2(current, previous));
        if (intersection) {
          output.push(intersection);
        }
      }
      output.push(current);
    } else if (previousInside) {
      const intersection = lineIntersection(a, edge, previous, sub2(current, previous));
      if (intersection) {
        output.push(intersection);
      }
    }
  }

  return output;
}

export function clipConvexPolygon(
  subject: readonly Vec2[],
  clip: readonly Vec2[],
  eps = 1e-9,
): Vec2[] {
  if (subject.length < 3 || clip.length < 3) {
    return [];
  }

  const clipPoints = signedArea2(clip) >= 0 ? [...clip] : [...clip].reverse();
  let output = [...subject];

  for (let i = 0; i < clipPoints.length; i += 1) {
    const a = clipPoints[i]!;
    const b = clipPoints[(i + 1) % clipPoints.length]!;
    output = clipHalfPlane(output, a, b, eps);
    if (output.length === 0) {
      return [];
    }
  }

  return output;
}
