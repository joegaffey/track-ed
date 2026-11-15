import earcut from "earcut";
import { SweepContext } from "poly2tri";
import type { SurfaceGraph, Vec3 } from "../model/baked-track";
import type { Vec2 } from "./math2";

function vertexKey3(position: Vec3): string {
  return `${Math.round(position[0] * 1e9)}:${Math.round(position[1] * 1e9)}:${Math.round(position[2] * 1e9)}`;
}

export class MeshBuilder {
  private readonly positions: Vec3[] = [];
  private readonly indices: number[] = [];
  private readonly triangleSurfaces: number[] = [];
  private readonly vertexKeys = new Map<string, number>();

  addVertex(point: Vec2): number {
    return this.addVertex3([point[0], 0, point[1]]);
  }

  addVertex3(position: Vec3): number {
    const key = vertexKey3(position);
    const existing = this.vertexKeys.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const index = this.positions.length;
    this.positions.push([position[0], position[1], position[2]]);
    this.vertexKeys.set(key, index);
    return index;
  }

  addVertices(points: readonly Vec2[]): number[] {
    return points.map((point) => this.addVertex(point));
  }

  addVertices3(points: readonly Vec3[]): number[] {
    return points.map((point) => this.addVertex3(point));
  }

  getPosition(index: number): Vec3 {
    const position = this.positions[index];
    if (!position) {
      throw new Error(`vertex index ${index} is out of range`);
    }
    return position;
  }

  addTriangle(a: number, b: number, c: number, surfaceId: number): void {
    this.indices.push(a, b, c);
    this.triangleSurfaces.push(surfaceId);
  }

  build(): SurfaceGraph {
    return {
      positions: this.positions.map((position) => [position[0], position[1], position[2]]),
      indices: [...this.indices],
      triangleSurfaces: [...this.triangleSurfaces],
    };
  }
}

export function triangulateRegion(
  builder: MeshBuilder,
  outer: readonly number[],
  holes: readonly (readonly number[])[],
  surfaceId: number,
): number {
  const flat: number[] = [];
  const holeIndices: number[] = [];
  const globalIndices: number[] = [];

  const addRing = (ring: readonly number[], isHole: boolean): void => {
    if (isHole) {
      holeIndices.push(globalIndices.length);
    }
    for (const index of ring) {
      const position = builder.getPosition(index);
      flat.push(position[0], -position[2]);
      globalIndices.push(index);
    }
  };

  addRing(outer, false);
  for (const hole of holes) {
    addRing(hole, true);
  }

  const triangles = earcut(flat, holeIndices.length > 0 ? holeIndices : null, 2);

  for (let i = 0; i < triangles.length; i += 3) {
    const a = globalIndices[triangles[i]!]!;
    const b = globalIndices[triangles[i + 1]!]!;
    const c = globalIndices[triangles[i + 2]!]!;
    builder.addTriangle(a, b, c, surfaceId);
  }

  return triangles.length / 3;
}

interface IndexedPoint {
  x: number;
  y: number;
  index: number;
}

export function triangulateRegionPoints(
  builder: MeshBuilder,
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
  surfaceId: number,
): number {
  const makePoints = (ring: readonly Vec2[]): IndexedPoint[] => {
    const indices = builder.addVertices(ring);
    return ring.map((point, index) => ({
      x: point[0],
      y: point[1],
      index: indices[index]!,
    }));
  };

  const outerPoints = makePoints(outer);
  if (outerPoints.length < 3) {
    return 0;
  }

  const context = new SweepContext(outerPoints, { cloneArrays: true });
  for (const hole of holes) {
    const holePoints = makePoints(hole);
    if (holePoints.length >= 3) {
      context.addHole(holePoints);
    }
  }

  context.triangulate();
  const triangles = context.getTriangles();

  for (const triangle of triangles) {
    const a = triangle.getPoint(0) as IndexedPoint;
    const b = triangle.getPoint(1) as IndexedPoint;
    const c = triangle.getPoint(2) as IndexedPoint;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cross > 0) {
      builder.addTriangle(a.index, c.index, b.index, surfaceId);
    } else {
      builder.addTriangle(a.index, b.index, c.index, surfaceId);
    }
  }

  return triangles.length;
}

export function triangulateRegion3D(
  builder: MeshBuilder,
  outer: readonly Vec3[],
  holes: readonly (readonly Vec3[])[],
  interior: readonly Vec3[],
  surfaceId: number,
): number {
  const makePoints = (positions: readonly Vec3[]): IndexedPoint[] => {
    const indices = builder.addVertices3(positions);
    return positions.map((position, index) => ({
      x: position[0],
      y: position[2],
      index: indices[index]!,
    }));
  };

  const outerPoints = makePoints(outer);
  if (outerPoints.length < 3) {
    return 0;
  }

  const context = new SweepContext(outerPoints, { cloneArrays: true });
  for (const hole of holes) {
    const holePoints = makePoints(hole);
    if (holePoints.length >= 3) {
      context.addHole(holePoints);
    }
  }
  for (const point of makePoints(interior)) {
    context.addPoint(point);
  }

  context.triangulate();
  const triangles = context.getTriangles();

  for (const triangle of triangles) {
    const a = triangle.getPoint(0) as IndexedPoint;
    const b = triangle.getPoint(1) as IndexedPoint;
    const c = triangle.getPoint(2) as IndexedPoint;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cross > 0) {
      builder.addTriangle(a.index, c.index, b.index, surfaceId);
    } else {
      builder.addTriangle(a.index, b.index, c.index, surfaceId);
    }
  }

  return triangles.length;
}
