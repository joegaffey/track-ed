import { distance2, type Vec2 } from "./math2";
import type { ProjectSpline } from "./project";

const CENTRIPETAL_ALPHA = 0.5;

function addPoint(points: Vec2[], point: Vec2): void {
  const previous = points[points.length - 1];
  if (!previous || Math.hypot(previous[0] - point[0], previous[1] - point[1]) > 1e-9) {
    points.push([point[0], point[1]]);
  }
}

function interpolate(
  a: Vec2,
  b: Vec2,
  ta: number,
  tb: number,
  t: number,
): Vec2 {
  const denominator = tb - ta;
  if (Math.abs(denominator) <= 1e-12) {
    return [a[0], a[1]];
  }
  const u = (t - ta) / denominator;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

function catmullRomPoint(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  t: number,
): Vec2 {
  const t0 = 0;
  const t1 = t0 + Math.max(Math.pow(distance2(p0, p1), CENTRIPETAL_ALPHA), 1e-6);
  const t2 = t1 + Math.max(Math.pow(distance2(p1, p2), CENTRIPETAL_ALPHA), 1e-6);
  const t3 = t2 + Math.max(Math.pow(distance2(p2, p3), CENTRIPETAL_ALPHA), 1e-6);
  const current = t1 + (t2 - t1) * t;

  const a1 = interpolate(p0, p1, t0, t1, current);
  const a2 = interpolate(p1, p2, t1, t2, current);
  const a3 = interpolate(p2, p3, t2, t3, current);
  const b1 = interpolate(a1, a2, t0, t2, current);
  const b2 = interpolate(a2, a3, t1, t3, current);
  return interpolate(b1, b2, t1, t2, current);
}

export function sampleCatmullRom(
  points: readonly Vec2[],
  closed: boolean,
  samplesPerSegment: number,
): Vec2[] {
  const count = points.length;
  if ((closed && count < 3) || (!closed && count < 2)) {
    return points.map((point) => [point[0], point[1]]);
  }

  const samples = Math.max(2, Math.floor(samplesPerSegment));
  const result: Vec2[] = [];
  const segmentCount = closed ? count : count - 1;

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const p1 = points[segment]!;
    const p2 = points[(segment + 1) % count]!;
    const p0 = closed
      ? points[(segment - 1 + count) % count]!
      : segment > 0
        ? points[segment - 1]!
        : ([2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] as Vec2);
    const p3 = closed
      ? points[(segment + 2) % count]!
      : segment + 2 < count
        ? points[segment + 2]!
        : ([2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] as Vec2);

    for (let sample = 0; sample < samples; sample += 1) {
      addPoint(result, catmullRomPoint(p0, p1, p2, p3, sample / samples));
    }
  }

  if (!closed) {
    addPoint(result, points[count - 1]!);
  }

  return result;
}

export function sampleCenterline(
  points: readonly Vec2[],
  closed: boolean,
  spline: ProjectSpline | undefined,
): Vec2[] {
  if (!spline) {
    return points.map((point) => [point[0], point[1]]);
  }
  return sampleCatmullRom(points, closed, spline.samplesPerSegment);
}

export function fractionAtControlPoint(
  points: readonly Vec2[],
  closed: boolean,
  spline: ProjectSpline | undefined,
  pointIndex: number,
): number | null {
  const target = points[pointIndex];
  if (!target) {
    return null;
  }
  const sampled = sampleCenterline(points, closed, spline);
  if (sampled.length === 0) {
    return null;
  }

  let nearestIndex = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index < sampled.length; index += 1) {
    const point = sampled[index]!;
    const distance = Math.hypot(point[0] - target[0], point[1] - target[1]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  const segmentCount = closed ? sampled.length : sampled.length - 1;
  let total = 0;
  const lengths: number[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const a = sampled[index]!;
    const b = sampled[(index + 1) % sampled.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    lengths.push(length);
    total += length;
  }
  if (total <= 0) {
    return 0;
  }

  let travelled = 0;
  for (let index = 0; index < nearestIndex; index += 1) {
    travelled += lengths[index] ?? 0;
  }
  return Math.max(0, Math.min(0.999, travelled / total));
}
