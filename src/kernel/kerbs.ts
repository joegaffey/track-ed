import type { Bounds, SurfaceGraph, Vec3 } from "../model/baked-track";
import { BakeError } from "./bake-error";
import {
  offsetPolyline,
  polylineSelfIntersections,
  type Vec2,
} from "./geometry";
import { MeshBuilder } from "./mesh";
import { clipConvexPolygon, leftNormal, normalize2, sub2 } from "./math2";
import type { Project, ProjectCenterline, ProjectKerbSpan } from "./project";
import { sampleCenterline } from "./spline";
import {
  buildPointTerrainSampler,
  rawTerrainHeight,
} from "./terrain";
import {
  KERB_RED_SURFACE,
  KERB_WHITE_SURFACE,
} from "./surfaces";

export const KERB_WIDTH = 0.8;
export const DEFAULT_KERB_FLAT_HEIGHT = 0.06;
export const DEFAULT_KERB_CORNER_HEIGHT = 0.155;
export const KERB_ELEMENT_LENGTH = 2;
export const KERB_SAMPLE_SPACING = 2;

const ASPHALT_SURFACE = 0;
const ASPHALT_CELL_SIZE = 4;
const KERB_CELL_SIZE = 2;
const OVERLAP_EPSILON = 1e-7;
const MIN_SEGMENT_LENGTH = 1e-6;

interface GroundTriangle {
  a: Vec2;
  b: Vec2;
  c: Vec2;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

function cellKey(x: number, z: number, size: number): string {
  return `${Math.floor(x / size)}:${Math.floor(z / size)}`;
}

function triangleCells(triangle: GroundTriangle, size: number): string[] {
  const cells: string[] = [];
  const minX = Math.floor(triangle.minX / size);
  const minZ = Math.floor(triangle.minZ / size);
  const maxX = Math.floor(triangle.maxX / size);
  const maxZ = Math.floor(triangle.maxZ / size);
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      cells.push(`${x}:${z}`);
    }
  }
  return cells;
}

function cross2(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

function pointInTriangle(point: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const ab = sub2(b, a);
  const bc = sub2(c, b);
  const ca = sub2(a, c);
  const ap = sub2(point, a);
  const bp = sub2(point, b);
  const cp = sub2(point, c);
  const d1 = cross2(ab, ap);
  const d2 = cross2(bc, bp);
  const d3 = cross2(ca, cp);
  const hasNegative = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const hasPositive = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(hasNegative && hasPositive);
}

class AsphaltIndex {
  private readonly cells = new Map<string, GroundTriangle[]>();

  constructor(graph: SurfaceGraph) {
    const positions = graph.positions;
    const triangleCount = Math.floor(graph.indices.length / 3);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      if (graph.triangleSurfaces[triangle] !== ASPHALT_SURFACE) {
        continue;
      }
      const a = positions[graph.indices[triangle * 3]!]!;
      const b = positions[graph.indices[triangle * 3 + 1]!]!;
      const c = positions[graph.indices[triangle * 3 + 2]!]!;
      const ground: GroundTriangle = {
        a: [a[0], a[2]],
        b: [b[0], b[2]],
        c: [c[0], c[2]],
        minX: Math.min(a[0], b[0], c[0]),
        minZ: Math.min(a[2], b[2], c[2]),
        maxX: Math.max(a[0], b[0], c[0]),
        maxZ: Math.max(a[2], b[2], c[2]),
      };
      for (const key of triangleCells(ground, ASPHALT_CELL_SIZE)) {
        const bucket = this.cells.get(key);
        if (bucket) {
          bucket.push(ground);
        } else {
          this.cells.set(key, [ground]);
        }
      }
    }
  }

  contains(point: Vec2): boolean {
    const bucket = this.cells.get(cellKey(point[0], point[1], ASPHALT_CELL_SIZE));
    if (!bucket) {
      return false;
    }
    for (const triangle of bucket) {
      if (
        point[0] < triangle.minX - 1e-9 ||
        point[0] > triangle.maxX + 1e-9 ||
        point[1] < triangle.minZ - 1e-9 ||
        point[1] > triangle.maxZ + 1e-9
      ) {
        continue;
      }
      if (pointInTriangle(point, triangle.a, triangle.b, triangle.c)) {
        return true;
      }
    }
    return false;
  }
}

interface QuadRecord {
  points: Vec2[];
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

class KerbOccupancy {
  private readonly cells = new Map<string, QuadRecord[]>();

  overlaps(points: Vec2[]): boolean {
    const minX = Math.min(...points.map((point) => point[0]));
    const minZ = Math.min(...points.map((point) => point[1]));
    const maxX = Math.max(...points.map((point) => point[0]));
    const maxZ = Math.max(...points.map((point) => point[1]));
    const minCellX = Math.floor(minX / KERB_CELL_SIZE);
    const minCellZ = Math.floor(minZ / KERB_CELL_SIZE);
    const maxCellX = Math.floor(maxX / KERB_CELL_SIZE);
    const maxCellZ = Math.floor(maxZ / KERB_CELL_SIZE);
    const checked = new Set<QuadRecord>();
    for (let x = minCellX; x <= maxCellX; x += 1) {
      for (let z = minCellZ; z <= maxCellZ; z += 1) {
        const bucket = this.cells.get(`${x}:${z}`);
        if (!bucket) {
          continue;
        }
        for (const quad of bucket) {
          if (checked.has(quad)) {
            continue;
          }
          checked.add(quad);
          if (
            maxX < quad.minX - 1e-9 ||
            minX > quad.maxX + 1e-9 ||
            maxZ < quad.minZ - 1e-9 ||
            minZ > quad.maxZ + 1e-9
          ) {
            continue;
          }
          const clipped = clipConvexPolygon(points, quad.points);
          if (clipped.length >= 3) {
            let area = 0;
            for (let index = 0; index < clipped.length; index += 1) {
              const current = clipped[index]!;
              const next = clipped[(index + 1) % clipped.length]!;
              area += current[0] * next[1] - next[0] * current[1];
            }
            if (Math.abs(area) / 2 > OVERLAP_EPSILON) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  add(points: Vec2[]): void {
    const record: QuadRecord = {
      points: points.map((point) => [point[0], point[1]]),
      minX: Math.min(...points.map((point) => point[0])),
      minZ: Math.min(...points.map((point) => point[1])),
      maxX: Math.max(...points.map((point) => point[0])),
      maxZ: Math.max(...points.map((point) => point[1])),
    };
    const minCellX = Math.floor(record.minX / KERB_CELL_SIZE);
    const minCellZ = Math.floor(record.minZ / KERB_CELL_SIZE);
    const maxCellX = Math.floor(record.maxX / KERB_CELL_SIZE);
    const maxCellZ = Math.floor(record.maxZ / KERB_CELL_SIZE);
    for (let x = minCellX; x <= maxCellX; x += 1) {
      for (let z = minCellZ; z <= maxCellZ; z += 1) {
        const key = `${x}:${z}`;
        const bucket = this.cells.get(key);
        if (bucket) {
          bucket.push(record);
        } else {
          this.cells.set(key, [record]);
        }
      }
    }
  }
}

interface Station {
  inner: Vec2;
  outer: Vec2;
  innerBaseY: number;
  outerBaseY: number;
  distance: number;
}

interface Segment {
  start: Station;
  end: Station;
  side: 1 | -1;
}

function terrainHeightAt(
  project: Project,
  bounds: Bounds,
): (point: Vec2) => number {
  if (project.terrain.mode !== "follow") {
    return () => 0;
  }
  if (project.terrain.points && project.terrain.points.length > 0) {
    return buildPointTerrainSampler(project.terrain.points, bounds);
  }
  if (project.terrain.elevation) {
    const elevation = project.terrain.elevation;
    return (point) => rawTerrainHeight(elevation, point);
  }
  return () => 0;
}

function slicePolyline(
  points: readonly Vec2[],
  closed: boolean,
  startFraction: number,
  endFraction: number,
): Vec2[] {
  const segmentCount = closed ? points.length : points.length - 1;
  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    lengths.push(length);
    total += length;
  }
  if (total <= 0) {
    return [];
  }

  const startDistance = Math.max(0, Math.min(1, startFraction)) * total;
  const endDistance = Math.max(0, Math.min(1, endFraction)) * total;
  if (endDistance - startDistance <= MIN_SEGMENT_LENGTH) {
    return [];
  }

  const result: Vec2[] = [];
  let travelled = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const segmentStart = travelled;
    const segmentEnd = travelled + lengths[index]!;
    travelled = segmentEnd;
    if (segmentEnd < startDistance - 1e-9) {
      continue;
    }
    if (segmentStart > endDistance + 1e-9) {
      break;
    }
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const length = lengths[index]!;
    const startT =
      length > 0
        ? Math.max(0, Math.min(1, (startDistance - segmentStart) / length))
        : 0;
    const endT =
      length > 0
        ? Math.max(0, Math.min(1, (endDistance - segmentStart) / length))
        : 0;
    const from: Vec2 = [a[0] + (b[0] - a[0]) * startT, a[1] + (b[1] - a[1]) * startT];
    const to: Vec2 = [a[0] + (b[0] - a[0]) * endT, a[1] + (b[1] - a[1]) * endT];
    if (result.length === 0) {
      result.push(from);
    } else {
      const previous = result[result.length - 1]!;
      if (Math.hypot(previous[0] - from[0], previous[1] - from[1]) > MIN_SEGMENT_LENGTH) {
        result.push(from);
      }
    }
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) > MIN_SEGMENT_LENGTH) {
      result.push(to);
    }
    if (segmentEnd >= endDistance - 1e-9) {
      break;
    }
  }

  return result;
}

function resamplePolyline(points: readonly Vec2[], spacing: number): Vec2[] {
  if (points.length < 2) {
    return points.map((point) => [point[0], point[1]]);
  }
  const result: Vec2[] = [[points[0]![0], points[0]![1]]];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length <= MIN_SEGMENT_LENGTH) {
      continue;
    }
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}

function sliceSpanPolyline(
  points: readonly Vec2[],
  closed: boolean,
  start: number,
  length: number,
): Vec2[] {
  if (!closed) {
    return slicePolyline(points, false, start, start + length);
  }
  const end = start + length;
  if (end <= 1 + 1e-9) {
    return slicePolyline(points, true, start, Math.min(1, end));
  }
  const first = slicePolyline(points, true, start, 1);
  const second = slicePolyline(points, true, 0, end - 1);
  if (first.length === 0) {
    return second;
  }
  if (second.length === 0) {
    return first;
  }
  const last = first[first.length - 1]!;
  const next = second[0]!;
  return Math.hypot(last[0] - next[0], last[1] - next[1]) <= MIN_SEGMENT_LENGTH
    ? [...first, ...second.slice(1)]
    : [...first, ...second];
}

function stationsForSpan(
  project: Project,
  bounds: Bounds,
  section: ProjectCenterline,
  span: ProjectKerbSpan,
): Station[] {
  const sampled = sampleCenterline(section.points as Vec2[], section.closed, section.spline);
  const sliced = sliceSpanPolyline(sampled, section.closed, span.start, span.length);
  const points = resamplePolyline(sliced, KERB_SAMPLE_SPACING);
  if (points.length < 2) {
    return [];
  }
  const side = span.side === "left" ? 1 : -1;
  const inner = offsetPolyline(points, false, side, project.road.halfWidth);
  const outer = offsetPolyline(points, false, side, project.road.halfWidth + KERB_WIDTH);
  if (inner.length !== points.length || outer.length !== points.length) {
    throw new BakeError(
      `kerb span ${section.id} [${span.start.toFixed(3)} + ${span.length.toFixed(3)}] could not be offset`,
    );
  }
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = inner[index]!;
    const b = inner[index + 1]!;
    const c = outer[index]!;
    const d = outer[index + 1]!;
    if (
      Math.hypot(b[0] - a[0], b[1] - a[1]) <= MIN_SEGMENT_LENGTH ||
      Math.hypot(d[0] - c[0], d[1] - c[1]) <= MIN_SEGMENT_LENGTH
    ) {
      throw new BakeError(
        `kerb span ${section.id} [${span.start.toFixed(3)} + ${span.length.toFixed(3)}] collapses; widen the turn or reduce the kerb width`,
      );
    }
  }
  if (
    polylineSelfIntersections(inner, false).length > 0 ||
    polylineSelfIntersections(outer, false).length > 0
  ) {
    throw new BakeError(
      `kerb span ${section.id} [${span.start.toFixed(3)} + ${span.length.toFixed(3)}] self-intersects; widen the turn or reduce the kerb width`,
    );
  }

  const heightAt = terrainHeightAt(project, bounds);
  const stations: Station[] = [];
  let distance = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) {
      const previous = inner[index - 1]!;
      const current = inner[index]!;
      distance += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    }
    stations.push({
      inner: inner[index]!,
      outer: outer[index]!,
      innerBaseY: heightAt(inner[index]!),
      outerBaseY: heightAt(outer[index]!),
      distance,
    });
  }
  return stations;
}

function addOrientedQuad(
  builder: MeshBuilder,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  surfaceId: number,
  desiredNormal: Vec3,
): void {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal: Vec3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const dot =
    normal[0] * desiredNormal[0] +
    normal[1] * desiredNormal[1] +
    normal[2] * desiredNormal[2];
  const ia = builder.addVertex3(a);
  const ib = builder.addVertex3(b);
  const ic = builder.addVertex3(c);
  const id = builder.addVertex3(d);
  if (dot >= 0) {
    builder.addTriangle(ia, ib, ic, surfaceId);
    builder.addTriangle(ia, ic, id, surfaceId);
  } else {
    builder.addTriangle(ia, id, ic, surfaceId);
    builder.addTriangle(ia, ic, ib, surfaceId);
  }
}

function addOrientedTriangle(
  builder: MeshBuilder,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  surfaceId: number,
  desiredNormal: Vec3,
): void {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal: Vec3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const dot =
    normal[0] * desiredNormal[0] +
    normal[1] * desiredNormal[1] +
    normal[2] * desiredNormal[2];
  const ia = builder.addVertex3(a);
  const ib = builder.addVertex3(b);
  const ic = builder.addVertex3(c);
  if (dot >= 0) {
    builder.addTriangle(ia, ib, ic, surfaceId);
  } else {
    builder.addTriangle(ia, ic, ib, surfaceId);
  }
}

function interpolateStation(a: Station, b: Station, t: number): Station {
  return {
    inner: [
      a.inner[0] + (b.inner[0] - a.inner[0]) * t,
      a.inner[1] + (b.inner[1] - a.inner[1]) * t,
    ],
    outer: [
      a.outer[0] + (b.outer[0] - a.outer[0]) * t,
      a.outer[1] + (b.outer[1] - a.outer[1]) * t,
    ],
    innerBaseY: a.innerBaseY + (b.innerBaseY - a.innerBaseY) * t,
    outerBaseY: a.outerBaseY + (b.outerBaseY - a.outerBaseY) * t,
    distance: a.distance + (b.distance - a.distance) * t,
  };
}

function basePositions(station: Station, flatHeight: number): {
  innerBase: Vec3;
  innerTop: Vec3;
  innerTopY: number;
  outerBase: Vec3;
} {
  const innerTopY = station.innerBaseY + flatHeight;
  return {
    innerBase: [station.inner[0], station.innerBaseY, station.inner[1]],
    innerTop: [station.inner[0], innerTopY, station.inner[1]],
    innerTopY,
    outerBase: [station.outer[0], station.outerBaseY, station.outer[1]],
  };
}

function outerTopAt(station: Station, height: number, minimumY: number): Vec3 {
  return [station.outer[0], Math.max(station.outerBaseY + height, minimumY), station.outer[1]];
}

function buildRun(
  builder: MeshBuilder,
  segments: Segment[],
  flatHeight: number,
  cornerHeight: number,
): void {
  if (segments.length === 0) {
    return;
  }
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const runLength = last.end.distance - first.start.distance;
  if (runLength <= MIN_SEGMENT_LENGTH) {
    return;
  }
  const elementCount = Math.max(1, Math.round(runLength / KERB_ELEMENT_LENGTH));
  const elementLength = runLength / elementCount;
  const stations = [first.start, ...segments.map((segment) => segment.end)];
  let stationIndex = 0;
  const stationAt = (distance: number): Station => {
    while (
      stationIndex < stations.length - 2 &&
      stations[stationIndex + 1]!.distance < distance - 1e-9
    ) {
      stationIndex += 1;
    }
    const a = stations[stationIndex]!;
    const b = stations[Math.min(stationIndex + 1, stations.length - 1)]!;
    const span = b.distance - a.distance;
    if (span <= 1e-12) {
      return a;
    }
    return interpolateStation(a, b, Math.max(0, Math.min(1, (distance - a.distance) / span)));
  };

  const startBase = basePositions(first.start, flatHeight);
  const startOuterTop = outerTopAt(first.start, flatHeight, startBase.innerTopY - 0.02);
  const firstDirection = normalize2(sub2(first.end.inner, first.start.inner));
  addOrientedQuad(
    builder,
    startBase.innerBase,
    startBase.outerBase,
    startOuterTop,
    startBase.innerTop,
    KERB_RED_SURFACE,
    [-firstDirection[0], 0, -firstDirection[1]],
  );

  let previous: {
    innerTop: Vec3;
    outerTop: Vec3;
    direction: Vec2;
    surfaceId: number;
  } | null = null;

  for (let element = 0; element < elementCount; element += 1) {
    const startDistance = first.start.distance + element * elementLength;
    const endDistance = startDistance + elementLength;
    const start = stationAt(startDistance);
    const end = stationAt(endDistance);
    const startBase = basePositions(start, flatHeight);
    const endBase = basePositions(end, flatHeight);
    const elementStartTop = outerTopAt(start, flatHeight, startBase.innerTopY - 0.02);
    const elementEndTop = outerTopAt(end, cornerHeight, endBase.innerTopY + 0.02);
    const direction = normalize2(sub2(end.inner, start.inner));
    const normal = leftNormal(direction);
    const outward: Vec3 = [normal[0] * first.side, 0, normal[1] * first.side];
    const inward: Vec3 = [-outward[0], 0, -outward[2]];
    const surfaceId = element % 2 === 0 ? KERB_RED_SURFACE : KERB_WHITE_SURFACE;

    if (previous) {
      addOrientedTriangle(
        builder,
        previous.innerTop,
        previous.outerTop,
        elementStartTop,
        previous.surfaceId,
        [previous.direction[0], 0, previous.direction[1]],
      );
    }

    addOrientedQuad(
      builder,
      startBase.innerTop,
      elementStartTop,
      elementEndTop,
      endBase.innerTop,
      surfaceId,
      [0, 1, 0],
    );
    addOrientedQuad(
      builder,
      startBase.innerBase,
      endBase.innerBase,
      endBase.innerTop,
      startBase.innerTop,
      surfaceId,
      inward,
    );
    addOrientedQuad(
      builder,
      startBase.outerBase,
      elementStartTop,
      elementEndTop,
      endBase.outerBase,
      surfaceId,
      outward,
    );

    previous = {
      innerTop: endBase.innerTop,
      outerTop: elementEndTop,
      direction,
      surfaceId,
    };
  }

  if (previous) {
    const lastBase = basePositions(last.end, flatHeight);
    addOrientedQuad(
      builder,
      lastBase.innerBase,
      previous.innerTop,
      previous.outerTop,
      lastBase.outerBase,
      previous.surfaceId,
      [previous.direction[0], 0, previous.direction[1]],
    );
  }
}

export function buildKerbGraph(
  project: Project,
  groundGraph: SurfaceGraph,
  bounds: Bounds,
): SurfaceGraph | undefined {
  const spans = project.centerlines.flatMap((section) =>
    (section.kerbs ?? []).map((span) => ({ section, span })),
  );
  if (spans.length === 0) {
    return undefined;
  }

  const asphalt = new AsphaltIndex(groundGraph);
  const occupancy = new KerbOccupancy();
  const builder = new MeshBuilder();
  const globalFlatHeight = project.kerbs?.flatHeight ?? DEFAULT_KERB_FLAT_HEIGHT;
  const globalCornerHeight = project.kerbs?.cornerHeight ?? DEFAULT_KERB_CORNER_HEIGHT;

  for (const { section, span } of spans) {
    const flatHeight = span.flatHeight ?? globalFlatHeight;
    const cornerHeight = span.cornerHeight ?? globalCornerHeight;
    if (cornerHeight <= flatHeight) {
      throw new BakeError(
        `kerb span ${section.id} [${span.start.toFixed(3)} + ${span.length.toFixed(3)}] cornerHeight must be greater than flatHeight`,
      );
    }
    const stations = stationsForSpan(project, bounds, section, span);
    if (stations.length < 2) {
      continue;
    }

    const segments: Segment[] = [];
    for (let index = 0; index < stations.length - 1; index += 1) {
      const start = stations[index]!;
      const end = stations[index + 1]!;
      const direction = sub2(end.inner, start.inner);
      const normal = leftNormal(direction);
      const side = span.side === "left" ? 1 : -1;
      const outward: Vec2 = [normal[0] * side, normal[1] * side];
      const probes: Vec2[] = [
        [start.inner[0] + outward[0] * 0.1, start.inner[1] + outward[1] * 0.1],
        [end.inner[0] + outward[0] * 0.1, end.inner[1] + outward[1] * 0.1],
        start.outer,
        end.outer,
        [(start.outer[0] + end.outer[0]) / 2, (start.outer[1] + end.outer[1]) / 2],
        [
          (start.inner[0] + start.outer[0] + end.inner[0] + end.outer[0]) / 4,
          (start.inner[1] + start.outer[1] + end.inner[1] + end.outer[1]) / 4,
        ],
      ];
      const top: Vec2[] = [
        [start.inner[0], start.inner[1]],
        [start.outer[0], start.outer[1]],
        [end.outer[0], end.outer[1]],
        [end.inner[0], end.inner[1]],
      ];
      if (
        probes.some((point) => asphalt.contains(point)) ||
        occupancy.overlaps(top)
      ) {
        continue;
      }
      occupancy.add(top);
      segments.push({ start, end, side });
    }

    let runStart = 0;
    while (runStart < segments.length) {
      let runEnd = runStart + 1;
      while (
        runEnd < segments.length &&
        segments[runEnd]!.start === segments[runEnd - 1]!.end
      ) {
        runEnd += 1;
      }
      buildRun(builder, segments.slice(runStart, runEnd), flatHeight, cornerHeight);
      runStart = runEnd;
    }
  }

  const graph = builder.build();
  return graph.indices.length > 0 ? graph : undefined;
}
