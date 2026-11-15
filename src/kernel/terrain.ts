import { SweepContext } from "poly2tri";
import type { Bounds, Vec3 } from "../model/baked-track";
import type { MultiPolygon2, Ring2 } from "./boolean";
import { distancePointToSegmentSq, type Vec2 } from "./math2";
import { MeshBuilder, triangulateRegion3D } from "./mesh";
import type { ProjectElevation } from "./project";

const BOUNDARY_EPSILON = 1e-6;

function pointInRing(point: Vec2, ring: Ring2): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    const intersects =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0];
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(point: Vec2, polygon: Ring2[]): boolean {
  const outer = polygon[0];
  if (!outer || !pointInRing(point, outer)) {
    return false;
  }
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(point, polygon[i]!)) {
      return false;
    }
  }
  return true;
}

function distanceToRing(point: Vec2, ring: Ring2): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    best = Math.min(best, distancePointToSegmentSq(point, a, b));
  }
  return Math.sqrt(best);
}

function distanceToRings(point: Vec2, rings: Ring2[]): number {
  if (rings.length === 0) {
    return Infinity;
  }
  let best = Infinity;
  for (const ring of rings) {
    best = Math.min(best, distanceToRing(point, ring));
  }
  return best;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) {
    return value >= edge1 ? 1 : 0;
  }
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function rawTerrainHeight(
  elevation: ProjectElevation,
  point: Vec2,
): number {
  const wave = (2 * Math.PI) / elevation.wavelength;
  return (
    elevation.amplitude *
    0.5 *
    (Math.sin(wave * point[0] + elevation.phase) +
      Math.cos(wave * point[1] + elevation.phase))
  );
}

export function terrainHeightAt(
  elevation: ProjectElevation,
  point: Vec2,
  roadRings: Ring2[],
): number {
  const raw = rawTerrainHeight(elevation, point);
  const distance = distanceToRings(point, roadRings);
  if (!Number.isFinite(distance)) {
    return raw;
  }
  return raw * smoothstep(0, elevation.blend, distance);
}

function pointOnBounds(point: Vec2, bounds: Bounds): boolean {
  const minX = bounds.min[0];
  const maxX = bounds.max[0];
  const minZ = bounds.min[2];
  const maxZ = bounds.max[2];
  return (
    ((Math.abs(point[0] - minX) <= BOUNDARY_EPSILON ||
      Math.abs(point[0] - maxX) <= BOUNDARY_EPSILON) &&
      point[1] >= minZ - BOUNDARY_EPSILON &&
      point[1] <= maxZ + BOUNDARY_EPSILON) ||
    ((Math.abs(point[1] - minZ) <= BOUNDARY_EPSILON ||
      Math.abs(point[1] - maxZ) <= BOUNDARY_EPSILON) &&
      point[0] >= minX - BOUNDARY_EPSILON &&
      point[0] <= maxX + BOUNDARY_EPSILON)
  );
}

function ringOnBounds(ring: Ring2, bounds: Bounds): boolean {
  return ring.length >= 3 && ring.every((point) => pointOnBounds(point, bounds));
}

function densifyRing(ring: Ring2, spacing: number): Ring2 {
  const result: Vec2[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(length / Math.max(spacing, 1e-6)));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}

function interiorGridPoints(
  polygon: Ring2[],
  bounds: Bounds,
  elevation: ProjectElevation,
): Vec2[] {
  const points: Vec2[] = [];
  const minX = bounds.min[0];
  const maxX = bounds.max[0];
  const minZ = bounds.min[2];
  const maxZ = bounds.max[2];
  const spacing = Math.max(elevation.gridSpacing, 1e-3);
  const margin = Math.max(1e-3, spacing * 0.05);

  for (let x = minX; x <= maxX + 1e-9; x += spacing) {
    for (let z = minZ; z <= maxZ + 1e-9; z += spacing) {
      const point: Vec2 = [x, z];
      if (!pointInPolygon(point, polygon)) {
        continue;
      }
      if (distanceToRings(point, polygon) <= margin) {
        continue;
      }
      points.push(point);
    }
  }
  return points;
}

function addTerrainPolygon(
  builder: MeshBuilder,
  polygon: MultiPolygon2[number],
  bounds: Bounds,
  elevation: ProjectElevation,
  surfaceId: number,
): void {
  const outerRing = polygon[0];
  if (!outerRing || outerRing.length < 3) {
    return;
  }

  const sceneIndex = polygon.findIndex((ring) => ringOnBounds(ring, bounds));
  const roadRings =
    sceneIndex >= 0 ? polygon.filter((_, index) => index !== sceneIndex) : polygon;

  const outerSource = sceneIndex === 0 ? densifyRing(outerRing, elevation.gridSpacing) : outerRing;
  const outer: Vec3[] =
    sceneIndex === 0
      ? outerSource.map((point) => [
          point[0],
          terrainHeightAt(elevation, point, roadRings),
          point[1],
        ])
      : outerSource.map((point) => [point[0], 0, point[1]]);

  const holes: Vec3[][] = [];
  for (let index = 1; index < polygon.length; index += 1) {
    const ring = polygon[index]!;
    holes.push(ring.map((point) => [point[0], 0, point[1]]));
  }

  const interior: Vec3[] = interiorGridPoints(polygon, bounds, elevation).map((point) => [
    point[0],
    terrainHeightAt(elevation, point, roadRings),
    point[1],
  ]);

  triangulateRegion3D(builder, outer, holes, interior, surfaceId);
}

export function addTerrainMultiPolygon(
  builder: MeshBuilder,
  multiPolygon: MultiPolygon2,
  bounds: Bounds,
  elevation: ProjectElevation,
  surfaceId: number,
): void {
  for (const polygon of multiPolygon) {
    addTerrainPolygon(builder, polygon, bounds, elevation, surfaceId);
  }
}

export function addPointTerrainMultiPolygon(
  builder: MeshBuilder,
  multiPolygon: MultiPolygon2,
  points: readonly { position: Vec2; height: number }[],
  surfaceId: number,
): void {
  for (const polygon of multiPolygon) {
    const outerRing = polygon[0];
    if (!outerRing || outerRing.length < 3) {
      continue;
    }

    const outer: Vec3[] = outerRing.map((point) => [point[0], 0, point[1]]);
    const holes: Vec3[][] = [];
    for (let index = 1; index < polygon.length; index += 1) {
      holes.push(polygon[index]!.map((point) => [point[0], 0, point[1]]));
    }

    const interior = points
      .filter((point) => pointInPolygon(point.position, polygon))
      .sort(
        (left, right) =>
          left.position[0] - right.position[0] ||
          left.position[1] - right.position[1],
      )
      .map((point) => [point.position[0], point.height, point.position[1]] as Vec3);

    triangulateRegion3D(builder, outer, holes, interior, surfaceId);
  }
}

interface HeightPoint {
  x: number;
  y: number;
  height: number;
}

function pointInTriangle(
  point: Vec2,
  a: HeightPoint,
  b: HeightPoint,
  c: HeightPoint,
): [number, number, number] | null {
  const denominator =
    (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) <= 1e-12) {
    return null;
  }
  const u =
    ((b.y - c.y) * (point[0] - c.x) + (c.x - b.x) * (point[1] - c.y)) /
    denominator;
  const v =
    ((c.y - a.y) * (point[0] - c.x) + (a.x - c.x) * (point[1] - c.y)) /
    denominator;
  const w = 1 - u - v;
  const epsilon = -1e-8;
  if (u >= epsilon && v >= epsilon && w >= epsilon) {
    return [u, v, w];
  }
  return null;
}

export function buildPointTerrainSampler(
  points: readonly { position: Vec2; height: number }[],
  bounds: Bounds,
): (point: Vec2) => number {
  const minX = bounds.min[0];
  const maxX = bounds.max[0];
  const minZ = bounds.min[2];
  const maxZ = bounds.max[2];
  const inside = points
    .filter(
      (point) =>
        point.position[0] > minX + 1e-6 &&
        point.position[0] < maxX - 1e-6 &&
        point.position[1] > minZ + 1e-6 &&
        point.position[1] < maxZ - 1e-6,
    )
    .sort(
      (left, right) =>
        left.position[0] - right.position[0] ||
        left.position[1] - right.position[1],
    );

  if (inside.length === 0) {
    return () => 0;
  }

  const contour: HeightPoint[] = [
    { x: minX, y: minZ, height: 0 },
    { x: maxX, y: minZ, height: 0 },
    { x: maxX, y: maxZ, height: 0 },
    { x: minX, y: maxZ, height: 0 },
  ];
  const context = new SweepContext(contour, { cloneArrays: true });
  for (const point of inside) {
    const heightPoint: HeightPoint = {
      x: point.position[0],
      y: point.position[1],
      height: point.height,
    };
    context.addPoint(heightPoint);
  }
  context.triangulate();
  const triangles = context.getTriangles().map((triangle) => [
    triangle.getPoint(0) as HeightPoint,
    triangle.getPoint(1) as HeightPoint,
    triangle.getPoint(2) as HeightPoint,
  ]);

  return (point: Vec2): number => {
    for (const triangle of triangles) {
      const weights = pointInTriangle(point, triangle[0]!, triangle[1]!, triangle[2]!);
      if (!weights) {
        continue;
      }
      return (
        weights[0] * triangle[0]!.height +
        weights[1] * triangle[1]!.height +
        weights[2] * triangle[2]!.height
      );
    }
    return 0;
  };
}
