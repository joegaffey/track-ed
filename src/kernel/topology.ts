import type { Bounds, SurfaceGraph, Vec3 } from "../model/baked-track";
import { MIN_TRIANGLE_AREA, WELD_EPSILON } from "./constants";
import {
  clipConvexPolygon,
  distancePointToSegmentSq,
  pointOnSegmentParameter,
  type Vec2,
} from "./math2";

export interface EdgeInfo {
  a: number;
  b: number;
  count: number;
  triangles: number[];
}

export interface TJunction {
  vertex: number;
  edgeA: number;
  edgeB: number;
  triangle: number;
}

export interface TopologyReport {
  weldedPositions: Vec3[];
  vertexMap: number[];
  edges: EdgeInfo[];
  interiorBoundaryEdges: EdgeInfo[];
  outerBoundaryEdges: EdgeInfo[];
  nonManifoldEdges: EdgeInfo[];
  tJunctions: TJunction[];
  degenerateTriangles: number[];
  badWindingTriangles: number[];
  overlapPairs: Array<[number, number]>;
  duplicateTriangles: Array<[number, number]>;
  triangleCount: number;
  surfaceTriangleCounts: Array<[number, number]>;
}

function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function weldPositions(positions: readonly Vec3[]): {
  weldedPositions: Vec3[];
  vertexMap: number[];
} {
  const cells = new Map<string, number[]>();
  const weldedPositions: Vec3[] = [];
  const vertexMap: number[] = [];
  const epsilonSq = WELD_EPSILON * WELD_EPSILON;

  const cellKey = (x: number, y: number, z: number): string =>
    `${Math.floor(x / WELD_EPSILON)}:${Math.floor(y / WELD_EPSILON)}:${Math.floor(z / WELD_EPSILON)}`;

  const findExisting = (position: Vec3): number | null => {
    const cx = Math.floor(position[0] / WELD_EPSILON);
    const cy = Math.floor(position[1] / WELD_EPSILON);
    const cz = Math.floor(position[2] / WELD_EPSILON);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = cells.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!bucket) {
            continue;
          }
          for (const candidate of bucket) {
            if (distanceSq(weldedPositions[candidate]!, position) <= epsilonSq) {
              return candidate;
            }
          }
        }
      }
    }
    return null;
  };

  for (const position of positions) {
    if (
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1]) ||
      !Number.isFinite(position[2])
    ) {
      vertexMap.push(weldedPositions.length);
      weldedPositions.push([position[0], position[1], position[2]]);
      continue;
    }

    const existing = findExisting(position);
    if (existing !== null) {
      vertexMap.push(existing);
      continue;
    }

    const weldedIndex = weldedPositions.length;
    weldedPositions.push([position[0], position[1], position[2]]);
    vertexMap.push(weldedIndex);
    const key = cellKey(position[0], position[1], position[2]);
    const bucket = cells.get(key);
    if (bucket) {
      bucket.push(weldedIndex);
    } else {
      cells.set(key, [weldedIndex]);
    }
  }

  return { weldedPositions, vertexMap };
}

function isOnOuterPerimeter(a: Vec3, b: Vec3, bounds: Bounds): boolean {
  const eps = WELD_EPSILON;
  const [minX, , minZ] = bounds.min;
  const [maxX, , maxZ] = bounds.max;

  const onMinX =
    Math.abs(a[0] - minX) <= eps &&
    Math.abs(b[0] - minX) <= eps &&
    a[2] >= minZ - eps &&
    a[2] <= maxZ + eps &&
    b[2] >= minZ - eps &&
    b[2] <= maxZ + eps;
  const onMaxX =
    Math.abs(a[0] - maxX) <= eps &&
    Math.abs(b[0] - maxX) <= eps &&
    a[2] >= minZ - eps &&
    a[2] <= maxZ + eps &&
    b[2] >= minZ - eps &&
    b[2] <= maxZ + eps;
  const onMinZ =
    Math.abs(a[2] - minZ) <= eps &&
    Math.abs(b[2] - minZ) <= eps &&
    a[0] >= minX - eps &&
    a[0] <= maxX + eps &&
    b[0] >= minX - eps &&
    b[0] <= maxX + eps;
  const onMaxZ =
    Math.abs(a[2] - maxZ) <= eps &&
    Math.abs(b[2] - maxZ) <= eps &&
    a[0] >= minX - eps &&
    a[0] <= maxX + eps &&
    b[0] >= minX - eps &&
    b[0] <= maxX + eps;

  return onMinX || onMaxX || onMinZ || onMaxZ;
}

function triangleAreaAndNormalY(a: Vec3, b: Vec3, c: Vec3): {
  area: number;
  normalY: number;
} {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return { area: Math.hypot(nx, ny, nz) / 2, normalY: ny };
}

function triangleOverlapArea(
  a: readonly Vec3[],
  b: readonly Vec3[],
): number {
  const polygonA: Vec2[] = a.map((point) => [point[0], point[2]]);
  const polygonB: Vec2[] = b.map((point) => [point[0], point[2]]);
  const clipped = clipConvexPolygon(polygonA, polygonB);
  if (clipped.length < 3) {
    return 0;
  }
  let area = 0;
  for (let i = 0; i < clipped.length; i += 1) {
    const current = clipped[i]!;
    const next = clipped[(i + 1) % clipped.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area) / 2;
}

export function analyzeSurfaceGraph(
  graph: SurfaceGraph,
  bounds: Bounds,
): TopologyReport {
  const { weldedPositions, vertexMap } = weldPositions(graph.positions);
  const indices = graph.indices;
  const triangleCount = Math.floor(indices.length / 3);
  const triangles: Array<[number, number, number]> = [];

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = indices[triangle * 3];
    const b = indices[triangle * 3 + 1];
    const c = indices[triangle * 3 + 2];
    if (a === undefined || b === undefined || c === undefined) {
      continue;
    }
    if (
      a < 0 ||
      b < 0 ||
      c < 0 ||
      a >= graph.positions.length ||
      b >= graph.positions.length ||
      c >= graph.positions.length
    ) {
      continue;
    }
    triangles.push([a, b, c]);
  }

  const edgeMap = new Map<string, EdgeInfo>();
  const degenerateTriangles: number[] = [];
  const badWindingTriangles: number[] = [];
  const surfaceTriangleCounts = new Map<number, number>();

  const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

  for (let triangle = 0; triangle < triangles.length; triangle += 1) {
    const [a, b, c] = triangles[triangle]!;
    const wa = vertexMap[a]!;
    const wb = vertexMap[b]!;
    const wc = vertexMap[c]!;

    const pa = graph.positions[a]!;
    const pb = graph.positions[b]!;
    const pc = graph.positions[c]!;
    const { area, normalY } = triangleAreaAndNormalY(pa, pb, pc);

    if (area <= MIN_TRIANGLE_AREA || wa === wb || wb === wc || wc === wa) {
      degenerateTriangles.push(triangle);
    } else if (normalY <= 1e-12) {
      badWindingTriangles.push(triangle);
    }

    const surfaceId = graph.triangleSurfaces[triangle];
    if (surfaceId !== undefined) {
      surfaceTriangleCounts.set(surfaceId, (surfaceTriangleCounts.get(surfaceId) ?? 0) + 1);
    }

    for (const [from, to] of [
      [wa, wb],
      [wb, wc],
      [wc, wa],
    ] as const) {
      if (from === to) {
        continue;
      }
      const key = edgeKey(from, to);
      const existing = edgeMap.get(key);
      if (existing) {
        existing.count += 1;
        existing.triangles.push(triangle);
      } else {
        edgeMap.set(key, {
          a: Math.min(from, to),
          b: Math.max(from, to),
          count: 1,
          triangles: [triangle],
        });
      }
    }
  }

  const edges = [...edgeMap.values()];
  const interiorBoundaryEdges: EdgeInfo[] = [];
  const outerBoundaryEdges: EdgeInfo[] = [];
  const nonManifoldEdges: EdgeInfo[] = [];

  for (const edge of edges) {
    if (edge.count > 2) {
      nonManifoldEdges.push(edge);
    } else if (edge.count === 1) {
      const a = weldedPositions[edge.a]!;
      const b = weldedPositions[edge.b]!;
      if (isOnOuterPerimeter(a, b, bounds)) {
        outerBoundaryEdges.push(edge);
      } else {
        interiorBoundaryEdges.push(edge);
      }
    }
  }

  const tJunctions: TJunction[] = [];
  const seenTJunctions = new Set<string>();
  const epsilonSq = WELD_EPSILON * WELD_EPSILON;

  for (const edge of edges) {
    const a = weldedPositions[edge.a]!;
    const b = weldedPositions[edge.b]!;
    const adjacentVertices = new Set<number>([edge.a, edge.b]);
    for (const triangle of edge.triangles) {
      const triangleIndices = triangles[triangle];
      if (!triangleIndices) {
        continue;
      }
      for (const index of triangleIndices) {
        adjacentVertices.add(vertexMap[index]!);
      }
    }

    const a2: Vec2 = [a[0], a[2]];
    const b2: Vec2 = [b[0], b[2]];

    for (let vertex = 0; vertex < weldedPositions.length; vertex += 1) {
      if (adjacentVertices.has(vertex)) {
        continue;
      }
      const point = weldedPositions[vertex]!;
      if (
        point[0] < Math.min(a[0], b[0]) - WELD_EPSILON ||
        point[0] > Math.max(a[0], b[0]) + WELD_EPSILON ||
        point[2] < Math.min(a[2], b[2]) - WELD_EPSILON ||
        point[2] > Math.max(a[2], b[2]) + WELD_EPSILON
      ) {
        continue;
      }
      const point2: Vec2 = [point[0], point[2]];
      const parameter = pointOnSegmentParameter(point2, a2, b2);
      if (parameter <= 1e-9 || parameter >= 1 - 1e-9) {
        continue;
      }
      if (distancePointToSegmentSq(point2, a2, b2) > epsilonSq) {
        continue;
      }
      const key = `${vertex}:${edge.a}:${edge.b}`;
      if (seenTJunctions.has(key)) {
        continue;
      }
      seenTJunctions.add(key);
      tJunctions.push({
        vertex,
        edgeA: edge.a,
        edgeB: edge.b,
        triangle: edge.triangles[0] ?? -1,
      });
    }
  }

  const duplicateTriangles: Array<[number, number]> = [];
  const duplicateMap = new Map<string, number>();
  for (let triangle = 0; triangle < triangles.length; triangle += 1) {
    const [a, b, c] = triangles[triangle]!;
    const key = [vertexMap[a]!, vertexMap[b]!, vertexMap[c]!].sort((x, y) => x - y).join(":");
    const existing = duplicateMap.get(key);
    if (existing !== undefined) {
      duplicateTriangles.push([existing, triangle]);
    } else {
      duplicateMap.set(key, triangle);
    }
  }

  const trianglePoints = triangles.map(([a, b, c]) => [
    graph.positions[a]!,
    graph.positions[b]!,
    graph.positions[c]!,
  ] as const);
  const triangleBounds = trianglePoints.map(([a, b, c]) => ({
    minX: Math.min(a[0], b[0], c[0]),
    maxX: Math.max(a[0], b[0], c[0]),
    minZ: Math.min(a[2], b[2], c[2]),
    maxZ: Math.max(a[2], b[2], c[2]),
  }));
  const xOrder = triangleBounds
    .map((_, index) => index)
    .sort((left, right) => triangleBounds[left]!.minX - triangleBounds[right]!.minX || left - right);

  const overlapPairs: Array<[number, number]> = [];
  for (let orderIndex = 0; orderIndex < xOrder.length; orderIndex += 1) {
    const i = xOrder[orderIndex]!;
    const boundsI = triangleBounds[i]!;
    for (let other = orderIndex + 1; other < xOrder.length; other += 1) {
      const j = xOrder[other]!;
      const boundsJ = triangleBounds[j]!;
      if (boundsJ.minX > boundsI.maxX + WELD_EPSILON) {
        break;
      }
      if (
        boundsI.minZ > boundsJ.maxZ + WELD_EPSILON ||
        boundsJ.minZ > boundsI.maxZ + WELD_EPSILON
      ) {
        continue;
      }
      const aPoints = trianglePoints[i]!;
      const bPoints = trianglePoints[j]!;
      if (triangleOverlapArea(aPoints, bPoints) > MIN_TRIANGLE_AREA) {
        overlapPairs.push([i, j]);
      }
    }
  }

  return {
    weldedPositions,
    vertexMap,
    edges,
    interiorBoundaryEdges,
    outerBoundaryEdges,
    nonManifoldEdges,
    tJunctions,
    degenerateTriangles,
    badWindingTriangles,
    overlapPairs,
    duplicateTriangles,
    triangleCount,
    surfaceTriangleCounts: [...surfaceTriangleCounts.entries()].sort((a, b) => a[0] - b[0]),
  };
}
