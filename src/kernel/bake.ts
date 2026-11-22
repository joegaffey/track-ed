import { BakeError } from "./bake-error";
import type {
  BakedTrack,
  Camera,
  LineGraph,
  Prop,
  Quat,
  Spawn,
  Surface,
  SurfaceGraph,
  Vec3,
} from "../model/baked-track";
import {
  centerlineLength,
  isSimplePolygon,
  offsetPolyline,
  polylineSelfIntersections,
  samplePolyline,
  segmentLengths,
  simplifyPolyline,
  type Vec2,
} from "./geometry";
import {
  differencePolygons,
  normalizeMultiPolygon,
  offsetPolygonClipper,
  unionManyPolygons,
  unionPolygons,
  type MultiPolygon2,
  type Polygon2,
} from "./boolean";
import { conformMultiPolygons } from "./conform";
import { MeshBuilder, triangulateRegion, triangulateRegionPoints } from "./mesh";
import { fractionAtControlPoint, sampleCenterline } from "./spline";
import {
  addPointTerrainMultiPolygon,
  addTerrainMultiPolygon,
  buildPointTerrainSampler,
  rawTerrainHeight,
} from "./terrain";
import {
  add2,
  cross2,
  distancePointToSegmentSq,
  leftNormal,
  length2,
  normalize2,
  scale2,
  segmentsIntersect,
  signedArea2,
  sub2,
} from "./math2";
import { isVenueSchema, type Project, type ProjectCenterline } from "./project";
import { DEFAULT_SURFACES, KERB_SURFACES, WALL_SURFACES } from "./surfaces";
import {
  roadsideRunsFromProject,
  type RoadsideInstanceRun,
} from "./roadside";
import { buildKerbGraph, buildWallGraph } from "./kerbs";
import { buildRaceLayout } from "./race";

export { BakeError };

const RACING_LINE_HALF_WIDTH = 1.6;
const RACING_LINE_EDGE_MARGIN = 0.12;
const RACING_LINE_REFERENCE_TURN = 0.5;
const RACING_LINE_CURVATURE_WINDOW_METERS = 10;
const RACING_LINE_SMOOTHING_PASSES = 4;
const RACING_LINE_LIFT = 0.02;
const RACING_LINE_STATION_SPACING = 2;
const RACING_LINE_TILE_METERS = 7;
const RACING_LINE_PROFILE: readonly number[] = [-1, -0.8, -0.5, 0, 0.5, 0.8, 1];
const ASPHALT_SURFACE_ID = DEFAULT_SURFACES[0]!.id;

interface MainBands {
  points: Vec2[];
  innerSide: 1 | -1;
  outerSide: 1 | -1;
  innerAsphalt: Vec2[];
  outerAsphalt: Vec2[];
  innerShoulder: Vec2[];
  outerShoulder: Vec2[];
  bounds: { min: Vec3; max: Vec3 };
  rectangle: Vec2[];
}

function quaternionFacing(tangent: Vec2): Quat {
  const yaw = Math.atan2(-tangent[0], -tangent[1]);
  const half = yaw / 2;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

// Lapster's runtime applies a PI drive flip to the track spawn rotation before
// creating the vehicle. Pre-flip the metadata rotation so the runtime-facing
// spawn points along the centreline tangent.
function spawnQuaternionFacing(tangent: Vec2): Quat {
  const yaw = Math.atan2(-tangent[0], -tangent[1]) + Math.PI;
  const half = yaw / 2;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function sceneBounds(project: Project): { min: Vec3; max: Vec3 } {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (const centerline of project.centerlines) {
    for (const point of sampleCenterline(
      centerline.points as Vec2[],
      centerline.closed,
      centerline.spline,
    )) {
      minX = Math.min(minX, point[0]);
      minZ = Math.min(minZ, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxZ = Math.max(maxZ, point[1]);
    }
  }

  const margin = project.terrain.margin;
  return {
    min: [minX - margin, 0, minZ - margin],
    max: [maxX + margin, 0, maxZ + margin],
  };
}

export function spawnFor(project: Project, fallback?: ProjectCenterline): Spawn {
  const centerline =
    project.centerlines.find((candidate) => candidate.id === project.spawn.centerline) ??
    fallback ??
    project.centerlines[0];
  if (!centerline) {
    throw new BakeError("spawn requires at least one section");
  }
  const sampledCenterline = sampleCenterline(
    centerline.points as Vec2[],
    centerline.closed,
    centerline.spline,
  );
  const sample = samplePolyline(sampledCenterline, centerline.closed, project.spawn.fraction);
  const left = leftNormal(sample.tangent);
  const lateralOffset = scale2(left, -project.spawn.lateral);

  const x = sample.position[0] + lateralOffset[0];
  const z = sample.position[1] + lateralOffset[1];
  const y =
    project.terrain.mode === "follow" && project.terrain.elevation
      ? rawTerrainHeight(project.terrain.elevation, [x, z])
      : 0;

  return {
    name: "spawn",
    position: [x, y, z],
    rotation: spawnQuaternionFacing(sample.tangent),
  };
}

function cameraFor(camera: Project["cameras"][number]): Camera {
  return {
    name: camera.name,
    position: [camera.position[0], camera.position[1], camera.position[2]],
    target: [camera.target[0], camera.target[1], camera.target[2]],
    fovY: camera.fovY,
  };
}

function mainBands(project: Project, main: ProjectCenterline): MainBands {
  const points = simplifyPolyline(
    sampleCenterline(main.points as Vec2[], true, main.spline),
    true,
  );

  if (!isSimplePolygon(points)) {
    throw new BakeError("main centreline must be a simple closed polygon");
  }

  const area = signedArea2(points);
  if (Math.abs(area) < 1e-9) {
    throw new BakeError("main centreline must enclose a non-zero area");
  }

  const innerSide: 1 | -1 = area > 0 ? 1 : -1;
  const outerSide: 1 | -1 = innerSide === 1 ? -1 : 1;
  const halfWidth = project.road.halfWidth;
  const shoulderHalfWidth = project.road.shoulderHalfWidth;

  let innerAsphalt = offsetPolyline(points, true, innerSide, halfWidth);
  let outerAsphalt = offsetPolyline(points, true, outerSide, halfWidth);
  let innerShoulder = offsetPolyline(points, true, innerSide, shoulderHalfWidth);
  let outerShoulder = offsetPolyline(points, true, outerSide, shoulderHalfWidth);

  const manualRings = [
    ["inner asphalt", innerAsphalt],
    ["outer asphalt", outerAsphalt],
    ["inner shoulder", innerShoulder],
    ["outer shoulder", outerShoulder],
  ] as const;

  if (manualRings.some(([, ring]) => !isSimplePolygon(ring))) {
    const orientation = area > 0 ? 1 : -1;
    const clipped = (delta: number, name: string): Vec2[] => {
      const paths = offsetPolygonClipper(points, delta);
      if (paths.length !== 1) {
        throw new BakeError(
          `${name} offset collapses or splits; widen the turn or reduce the road width`,
        );
      }
      const ring = paths[0]!;
      if (!isSimplePolygon(ring)) {
        throw new BakeError(`${name} offset self-intersects`);
      }
      return ring;
    };

    innerAsphalt = clipped(-orientation * halfWidth, "inner asphalt");
    outerAsphalt = clipped(orientation * halfWidth, "outer asphalt");
    innerShoulder = clipped(-orientation * shoulderHalfWidth, "inner shoulder");
    outerShoulder = clipped(orientation * shoulderHalfWidth, "outer shoulder");
  }

  const bounds = sceneBounds(project);
  const rectangle: Vec2[] = [
    [bounds.min[0], bounds.min[2]],
    [bounds.max[0], bounds.min[2]],
    [bounds.max[0], bounds.max[2]],
    [bounds.min[0], bounds.max[2]],
  ];

  return {
    points,
    innerSide,
    outerSide,
    innerAsphalt,
    outerAsphalt,
    innerShoulder,
    outerShoulder,
    bounds,
    rectangle,
  };
}

function applyTerrainMode(
  project: Project,
  surfaceGraph: SurfaceGraph,
  bounds: { min: Vec3; max: Vec3 },
): SurfaceGraph {
  if (project.terrain.mode !== "follow") {
    return surfaceGraph;
  }

  if (project.terrain.points && project.terrain.points.length > 0) {
    const sampler = buildPointTerrainSampler(project.terrain.points, bounds);
    for (const position of surfaceGraph.positions) {
      position[1] = sampler([position[0], position[2]]);
    }
  } else if (project.terrain.elevation) {
    for (const position of surfaceGraph.positions) {
      position[1] = rawTerrainHeight(project.terrain.elevation, [position[0], position[2]]);
    }
  }
  return surfaceGraph;
}

export function sampleSurfaceHeight(
  graph: SurfaceGraph,
  x: number,
  z: number,
  surfaceId?: number,
): number | null {
  for (let triangle = 0; triangle < graph.indices.length / 3; triangle += 1) {
    if (
      surfaceId !== undefined &&
      graph.triangleSurfaces[triangle] !== surfaceId
    ) {
      continue;
    }
    const a = graph.positions[graph.indices[triangle * 3]!]!;
    const b = graph.positions[graph.indices[triangle * 3 + 1]!]!;
    const c = graph.positions[graph.indices[triangle * 3 + 2]!]!;
    const denominator =
      (b[2] - c[2]) * (a[0] - c[0]) +
      (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(denominator) < 1e-12) {
      continue;
    }
    const wa =
      ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) /
      denominator;
    const wb =
      ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) /
      denominator;
    const wc = 1 - wa - wb;
    if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) {
      continue;
    }
    return wa * a[1] + wb * b[1] + wc * c[1];
  }
  return null;
}

function groundSampler(
  graph: SurfaceGraph,
): (x: number, z: number) => number | null {
  return (x, z) => sampleSurfaceHeight(graph, x, z);
}

function resampleLinePolyline(
  points: readonly Vec2[],
  closed: boolean,
  spacing: number,
): Vec2[] {
  const total = centerlineLength(points, closed);
  if (total <= 1e-9) {
    return [];
  }
  if (closed) {
    const count = Math.max(3, Math.round(total / spacing));
    const step = total / count;
    const result: Vec2[] = [];
    for (let index = 0; index < count; index += 1) {
      const sample = sampleAtDistance(points, true, index * step);
      if (sample) {
        result.push(sample.position);
      }
    }
    return result;
  }
  const segments = Math.max(1, Math.ceil(total / spacing));
  const result: Vec2[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const sample = sampleAtDistance(points, false, (index / segments) * total);
    if (sample) {
      result.push(sample.position);
    }
  }
  return result;
}

function racingLineOffsets(
  points: readonly Vec2[],
  closed: boolean,
  maxOffset: number,
): number[] {
  const count = points.length;
  if (count < 3 || maxOffset <= 0) {
    return new Array<number>(count).fill(0);
  }

  const wrapIndex = (value: number) => ((value % count) + count) % count;
  const curvature = new Array<number>(count).fill(0);
  for (let index = 0; index < count; index += 1) {
    if (!closed && (index === 0 || index === count - 1)) {
      continue;
    }
    const previous = points[closed ? (index - 1 + count) % count : index - 1]!;
    const current = points[index]!;
    const next = points[closed ? (index + 1) % count : index + 1]!;
    const incoming = sub2(current, previous);
    const outgoing = sub2(next, current);
    const incomingLength = length2(incoming);
    const outgoingLength = length2(outgoing);
    if (incomingLength < 1e-4 || outgoingLength < 1e-4) {
      continue;
    }
    const sinTurn =
      cross2(incoming, outgoing) / (incomingLength * outgoingLength);
    const turn = Math.asin(Math.max(-1, Math.min(1, sinTurn)));
    const spacing = (incomingLength + outgoingLength) * 0.5;
    curvature[index] = turn / Math.max(spacing, 1e-3);
  }

  const totalLength = centerlineLength(points, closed);
  const segmentCount = closed ? count : count - 1;
  const spacing = totalLength / Math.max(segmentCount, 1);
  const window = Math.max(
    1,
    Math.round(RACING_LINE_CURVATURE_WINDOW_METERS / Math.max(spacing, 0.5)),
  );
  const target = new Array<number>(count).fill(0);
  for (let index = 0; index < count; index += 1) {
    if (!closed && (index === 0 || index === count - 1)) {
      continue;
    }
    let turn = 0;
    for (let offset = -window; offset <= window; offset += 1) {
      const sample = closed
        ? wrapIndex(index + offset)
        : Math.max(0, Math.min(count - 1, index + offset));
      turn += curvature[sample]! * spacing;
    }
    const strength = Math.min(
      1,
      Math.abs(turn) / RACING_LINE_REFERENCE_TURN,
    );
    target[index] = maxOffset * strength * Math.sign(turn);
  }

  let offsets = target;
  for (let pass = 0; pass < RACING_LINE_SMOOTHING_PASSES; pass += 1) {
    const previous = offsets;
    const next = new Array<number>(count).fill(0);
    for (let index = 0; index < count; index += 1) {
      if (!closed && (index === 0 || index === count - 1)) {
        continue;
      }
      const previousIndex = closed
        ? (index - 1 + count) % count
        : Math.max(0, index - 1);
      const nextIndex = closed
        ? (index + 1) % count
        : Math.min(count - 1, index + 1);
      next[index] =
        (previous[previousIndex]! +
          2 * previous[index]! +
          previous[nextIndex]!) *
        0.25;
    }
    offsets = next;
  }

  return offsets.map((offset) =>
    Math.max(-maxOffset, Math.min(maxOffset, offset)),
  );
}

function buildRacingLineGraph(
  project: Project,
  bounds: { min: Vec3; max: Vec3 },
  surfaceGraph: SurfaceGraph,
): LineGraph | undefined {
  const terrainPoints =
    project.terrain.mode === "follow" && project.terrain.points?.length
      ? project.terrain.points
      : undefined;
  const terrainSampler = terrainPoints
    ? buildPointTerrainSampler(terrainPoints, bounds)
    : null;
  const heightAt = (x: number, z: number): number => {
    if (project.terrain.mode !== "follow") {
      return 0;
    }
    if (terrainSampler) {
      return terrainSampler([x, z]);
    }
    if (project.terrain.elevation) {
      return rawTerrainHeight(project.terrain.elevation, [x, z]);
    }
    return 0;
  };
  const roadHeightAt = (x: number, z: number): number | null =>
    sampleSurfaceHeight(surfaceGraph, x, z, ASPHALT_SURFACE_ID) ??
    sampleSurfaceHeight(surfaceGraph, x, z);
  const lineHalfWidth = Math.min(
    RACING_LINE_HALF_WIDTH,
    Math.max(0, project.road.halfWidth - RACING_LINE_EDGE_MARGIN),
  );
  if (lineHalfWidth < 0.05) {
    return undefined;
  }
  const maxOffset = Math.max(
    0,
    project.road.halfWidth - lineHalfWidth - RACING_LINE_EDGE_MARGIN,
  );
  const profileCount = RACING_LINE_PROFILE.length;
  const positions: Vec3[] = [];
  const uvs: [number, number][] = [];
  const indices: number[] = [];

  for (const section of project.centerlines) {
    const sampled = sampleCenterline(
      section.points as Vec2[],
      section.closed,
      section.spline,
    );
    const stations = resampleLinePolyline(
      sampled,
      section.closed,
      RACING_LINE_STATION_SPACING,
    );
    if (stations.length < 2 || (section.closed && stations.length < 3)) {
      continue;
    }
    const total = centerlineLength(stations, section.closed);
    if (total <= 1e-9) {
      continue;
    }
    const offsets = racingLineOffsets(stations, section.closed, maxOffset);
    const base = positions.length;
    const stationCount = section.closed ? stations.length + 1 : stations.length;
    let distance = 0;

    for (let station = 0; station < stationCount; station += 1) {
      const index = station % stations.length;
      const point = stations[index]!;
      const previous = section.closed
        ? stations[(index - 1 + stations.length) % stations.length]!
        : stations[Math.max(0, index - 1)]!;
      const next = section.closed
        ? stations[(index + 1) % stations.length]!
        : stations[Math.min(stations.length - 1, index + 1)]!;
      let tangent = normalize2(sub2(next, previous));
      if (length2(tangent) <= 1e-9) {
        tangent = normalize2(
          sub2(stations[(index + 1) % stations.length]!, point),
        );
      }
      const binormal = leftNormal(tangent);
      const offset = offsets[index] ?? 0;

      for (let profile = 0; profile < profileCount; profile += 1) {
        const lateral =
          offset + RACING_LINE_PROFILE[profile]! * lineHalfWidth;
        const x = point[0] + binormal[0] * lateral;
        const z = point[1] + binormal[1] * lateral;
        const surfaceY = roadHeightAt(x, z);
        positions.push([x, (surfaceY ?? heightAt(x, z)) + RACING_LINE_LIFT, z]);
        uvs.push([
          distance / RACING_LINE_TILE_METERS,
          profile / (profileCount - 1),
        ]);
      }

      if (station < stationCount - 1) {
        for (let band = 0; band < profileCount - 1; band += 1) {
          const a = base + station * profileCount + band;
          const b = a + 1;
          const c = base + (station + 1) * profileCount + band;
          const d = c + 1;
          indices.push(a, d, c, a, b, d);
        }
        const nextIndex = section.closed
          ? (index + 1) % stations.length
          : Math.min(stations.length - 1, index + 1);
        const nextPoint = stations[nextIndex]!;
        distance += Math.hypot(
          nextPoint[0] - point[0],
          nextPoint[1] - point[1],
        );
      }
    }
  }

  return positions.length > 0 && indices.length > 0
    ? { positions, uvs, indices }
    : undefined;
}

function propNoise(id: string, salt: number): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffffffff;
}

function sampleAtDistance(
  points: readonly Vec2[],
  closed: boolean,
  distance: number,
): { position: Vec2; tangent: Vec2 } | null {
  const lengths = segmentLengths(points, closed);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 1e-9) {
    return null;
  }
  let target = distance;
  if (closed) {
    target = ((target % total) + total) % total;
  } else {
    target = Math.max(0, Math.min(total, target));
  }
  let travelled = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (length <= 1e-9) {
      continue;
    }
    if (travelled + length >= target - 1e-9) {
      const a = points[index]!;
      const b = points[(index + 1) % points.length]!;
      const t = Math.max(0, Math.min(1, (target - travelled) / length));
      return {
        position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        tangent: normalize2(sub2(b, a)),
      };
    }
    travelled += length;
  }
  return null;
}

function bakeProps(
  project: Project,
  bounds: { min: Vec3; max: Vec3 },
  surfaceGraph: SurfaceGraph,
): Prop[] | undefined {
  const heightAt = groundSampler(surfaceGraph);
  const props: Prop[] = [];
  const runs = roadsideRunsFromProject(project).filter(
    (run): run is RoadsideInstanceRun => run.mechanism === "instances",
  );
  for (const run of runs) {
    for (let legIndex = 0; legIndex < run.legs.length; legIndex += 1) {
      const leg = run.legs[legIndex]!;
      const section = project.centerlines.find(
        (candidate) => candidate.id === leg.section,
      );
      if (!section) {
        continue;
      }
      const sampled = sampleCenterline(
        section.points as Vec2[],
        section.closed,
        section.spline,
      );
      const total = centerlineLength(sampled, section.closed);
      if (total <= 1e-9) {
        continue;
      }
      const spacing = run.spacing;
      const offsetDistance = run.offset;
      const sideSign = run.side === "left" ? 1 : -1;
      const start = leg.start * total;
      const end = (leg.start + leg.length) * total;
      let distance = start + spacing / 2;
      let index = 0;
      while (distance < end - 1e-9 && index < 10000) {
        const sample = sampleAtDistance(sampled, section.closed, distance);
        if (sample) {
          const id = `${run.id}:${legIndex}:${index}`;
          const noise = (salt: number): number => propNoise(id, salt);
          const lateralJitter = (noise(1) * 2 - 1) * 0.08;
          const longitudinalJitter = (noise(2) * 2 - 1) * 0.08;
          const yawJitter = (noise(3) * 2 - 1) * 0.04;
          const binormal = leftNormal(sample.tangent);
          const offset = scale2(binormal, sideSign * offsetDistance);
          const jitterX =
            sample.tangent[0] * longitudinalJitter + binormal[0] * lateralJitter;
          const jitterZ =
            sample.tangent[1] * longitudinalJitter + binormal[1] * lateralJitter;
          const x = sample.position[0] + offset[0] + jitterX;
          const z = sample.position[1] + offset[1] + jitterZ;
          const yaw =
            Math.atan2(sample.tangent[0], sample.tangent[1]) + yawJitter;
          const scale = run.kind === "tree" ? 0.85 + 0.3 * noise(4) : 1;
          props.push({
            id,
            kind: run.kind,
            position: [x, heightAt(x, z) ?? 0, z],
            rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] as Quat,
            scale,
            collision: run.collision === "solid",
          });
        }
        distance += spacing;
        index += 1;
      }
    }
  }
  return props.length > 0 ? props : undefined;
}

function sectionLength(centerline: ProjectCenterline): number {
  return centerlineLength(
    sampleCenterline(centerline.points as Vec2[], centerline.closed, centerline.spline),
    centerline.closed,
  );
}

function finishTrack(
  project: Project,
  main: ProjectCenterline | undefined,
  bounds: { min: Vec3; max: Vec3 },
  surfaceGraph: SurfaceGraph,
  lengthOverride?: number,
): BakedTrack {
  const kerbGraph = buildKerbGraph(project, bounds);
  const wallGraph = buildWallGraph(project, bounds);
  const racingLine = buildRacingLineGraph(project, bounds, surfaceGraph);
  const props = bakeProps(project, bounds, surfaceGraph);
  const raceResult = buildRaceLayout(project, {
    asphaltHeightAt: (x, z) =>
      sampleSurfaceHeight(surfaceGraph, x, z, ASPHALT_SURFACE_ID),
    groundHeightAt: (x, z) => sampleSurfaceHeight(surfaceGraph, x, z),
  });
  const surfaces: Surface[] = DEFAULT_SURFACES.map((surface) => ({ ...surface }));
  if (kerbGraph) {
    const kerbSurfaceIds = new Set(kerbGraph.triangleSurfaces);
    surfaces.push(
      ...KERB_SURFACES.filter((surface) => kerbSurfaceIds.has(surface.id)).map(
        (surface) => ({ ...surface }),
      ),
    );
  }
  if (wallGraph) {
    const wallSurfaceIds = new Set(wallGraph.triangleSurfaces);
    surfaces.push(
      ...WALL_SURFACES.filter((surface) => wallSurfaceIds.has(surface.id)).map(
        (surface) => ({ ...surface }),
      ),
    );
  }
  const spawn = spawnFor(project, main);
  if (
    project.terrain.mode === "follow" &&
    project.terrain.points &&
    project.terrain.points.length > 0
  ) {
    const sampler = buildPointTerrainSampler(project.terrain.points, bounds);
    spawn.position = [
      spawn.position[0],
      sampler([spawn.position[0], spawn.position[2]]),
      spawn.position[2],
    ];
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (const position of surfaceGraph.positions) {
    minY = Math.min(minY, position[1]);
    maxY = Math.max(maxY, position[1]);
  }
  for (const position of kerbGraph?.positions ?? []) {
    minY = Math.min(minY, position[1]);
    maxY = Math.max(maxY, position[1]);
  }
  for (const position of wallGraph?.positions ?? []) {
    minY = Math.min(minY, position[1]);
    maxY = Math.max(maxY, position[1]);
  }
  for (const position of racingLine?.positions ?? []) {
    minY = Math.min(minY, position[1]);
    maxY = Math.max(maxY, position[1]);
  }
  for (const prop of props ?? []) {
    minY = Math.min(minY, prop.position[1]);
    maxY = Math.max(maxY, prop.position[1]);
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minY = 0;
    maxY = 0;
  }

  return {
    kind: "track",
    name: project.name,
    length:
      lengthOverride ??
      (main ? sectionLength(main) : project.centerlines.reduce((sum, section) => sum + sectionLength(section), 0)),
    bounds: {
      min: [bounds.min[0], minY, bounds.min[2]],
      max: [bounds.max[0], maxY, bounds.max[2]],
    },
    surfaceGraph,
    ...(kerbGraph ? { kerbGraph } : {}),
    ...(wallGraph ? { wallGraph } : {}),
    ...(racingLine ? { racingLine } : {}),
    ...(props ? { props } : {}),
    ...(raceResult.race ? { race: raceResult.race } : {}),
    ...(raceResult.warnings.length > 0 ? { warnings: raceResult.warnings } : {}),
    surfaces,
    spawns: [spawn],
    cameras: project.cameras.map(cameraFor),
  };
}

function addConformedMultiPolygon(
  builder: MeshBuilder,
  multiPolygon: MultiPolygon2,
  surfaceId: number,
): void {
  for (const polygon of multiPolygon) {
    const outer = polygon[0];
    if (!outer || outer.length < 3) {
      continue;
    }
    triangulateRegionPoints(builder, outer, polygon.slice(1), surfaceId);
  }
}

function bakeLoop(project: Project, main: ProjectCenterline): BakedTrack {
  const bands = mainBands(project, main);
  const builder = new MeshBuilder();

  const innerAsphalt = builder.addVertices(bands.innerAsphalt);
  const outerAsphalt = builder.addVertices(bands.outerAsphalt);
  const innerShoulder = builder.addVertices(bands.innerShoulder);
  const outerShoulder = builder.addVertices(bands.outerShoulder);
  const rectangleIndices = builder.addVertices(bands.rectangle);

  triangulateRegion(builder, outerAsphalt, [innerAsphalt], 0);
  triangulateRegion(builder, innerAsphalt, [innerShoulder], 1);
  triangulateRegion(builder, outerShoulder, [outerAsphalt], 1);

  const grassPolygons: MultiPolygon2 = [
    [bands.rectangle, bands.outerShoulder],
    [bands.innerShoulder],
  ];

  if (project.terrain.points && project.terrain.points.length > 0) {
    addPointTerrainMultiPolygon(builder, grassPolygons, project.terrain.points, 2);
  } else if (project.terrain.elevation) {
    addTerrainMultiPolygon(
      builder,
      grassPolygons,
      bands.bounds,
      project.terrain.elevation,
      2,
    );
  } else {
    triangulateRegion(builder, innerShoulder, [], 2);
    triangulateRegion(builder, rectangleIndices, [outerShoulder], 2);
  }

  return finishTrack(
    project,
    main,
    bands.bounds,
    applyTerrainMode(project, builder.build(), bands.bounds),
  );
}

function ribbon(points: Vec2[], width: number): Vec2[] {
  const left = offsetPolyline(points, false, 1, width);
  const right = offsetPolyline(points, false, -1, width);
  return [...left, ...right.slice().reverse()];
}

function extendedShoulderRibbon(points: Vec2[], width: number): Vec2[] {
  const left = offsetPolyline(points, false, 1, width);
  const right = offsetPolyline(points, false, -1, width);
  if (left.length < 2 || right.length < 2) {
    return [...left, ...right.slice().reverse()];
  }
  const last = points[points.length - 1]!;
  const previous = points[points.length - 2]!;
  const direction = normalize2(sub2(last, previous));
  const leftEnd = add2(left[left.length - 1]!, scale2(direction, width));
  const rightEnd = add2(right[right.length - 1]!, scale2(direction, width));
  return [
    ...left.slice(0, -1),
    leftEnd,
    rightEnd,
    ...right.slice(0, -1).reverse(),
  ];
}

function extendedShoulderRibbonStart(points: Vec2[], width: number): Vec2[] {
  const left = offsetPolyline(points, false, 1, width);
  const right = offsetPolyline(points, false, -1, width);
  if (left.length < 2 || right.length < 2) {
    return [...left, ...right.slice().reverse()];
  }
  const first = points[0]!;
  const second = points[1]!;
  const startDirection = normalize2(sub2(first, second));
  const leftStart = add2(left[0]!, scale2(startDirection, width));
  const rightStart = add2(right[0]!, scale2(startDirection, width));
  return [
    leftStart,
    ...left.slice(1),
    ...right.slice(1).reverse(),
    rightStart,
  ];
}

function extendedShoulderRibbonBoth(points: Vec2[], width: number): Vec2[] {
  const left = offsetPolyline(points, false, 1, width);
  const right = offsetPolyline(points, false, -1, width);
  if (left.length < 2 || right.length < 2) {
    return [...left, ...right.slice().reverse()];
  }
  const first = points[0]!;
  const second = points[1]!;
  const last = points[points.length - 1]!;
  const previous = points[points.length - 2]!;
  const startDirection = normalize2(sub2(first, second));
  const endDirection = normalize2(sub2(last, previous));
  const leftStart = add2(left[0]!, scale2(startDirection, width));
  const rightStart = add2(right[0]!, scale2(startDirection, width));
  const leftEnd = add2(left[left.length - 1]!, scale2(endDirection, width));
  const rightEnd = add2(right[right.length - 1]!, scale2(endDirection, width));
  return [
    leftStart,
    ...left.slice(1, -1),
    leftEnd,
    rightEnd,
    ...right.slice(1, -1).reverse(),
    rightStart,
  ];
}

function shoulderRibbonForEnds(
  points: Vec2[],
  width: number,
  startAttached: boolean,
  endAttached: boolean,
): Vec2[] {
  if (startAttached && endAttached) {
    return ribbon(points, width);
  }
  if (startAttached) {
    return extendedShoulderRibbon(points, width);
  }
  if (endAttached) {
    return extendedShoulderRibbonStart(points, width);
  }
  return extendedShoulderRibbonBoth(points, width);
}

function snapSectionJunctions(project: Project): void {
  for (const junction of project.junctions) {
    const members = junction.members;
    if (!members) {
      continue;
    }
    const anchorSection = project.centerlines.find(
      (section) => section.id === junction.centerline,
    );
    const anchorIndex = anchorSection?.pointIds.indexOf(junction.point) ?? -1;
    const anchorPosition =
      anchorSection && anchorIndex >= 0 ? anchorSection.points[anchorIndex] : undefined;
    if (!anchorPosition) {
      throw new BakeError(`junction "${junction.id}" has an unknown anchor point`);
    }
    for (const member of members) {
      if (member.section === junction.centerline && member.point === junction.point) {
        continue;
      }
      const section = project.centerlines.find(
        (candidate) => candidate.id === member.section,
      );
      const pointIndex = section?.pointIds.indexOf(member.point) ?? -1;
      if (!section || pointIndex < 0) {
        throw new BakeError(
          `junction "${junction.id}" references an unknown point "${member.point}" on section "${member.section}"`,
        );
      }
      section.points[pointIndex] = [anchorPosition[0], anchorPosition[1]];
    }
  }
}

function sectionAttachedPoints(project: Project): Set<string> {
  const attached = new Set<string>();
  for (const junction of project.junctions) {
    for (const member of junction.members ?? []) {
      attached.add(`${member.section}:${member.point}`);
    }
  }
  return attached;
}

function sharedJunctionPoints(
  project: Project,
  sectionA: string,
  sectionB: string,
): Vec2[] {
  const points: Vec2[] = [];
  for (const junction of project.junctions) {
    const members = junction.members ?? [];
    if (
      !members.some((member) => member.section === sectionA) ||
      !members.some((member) => member.section === sectionB)
    ) {
      continue;
    }
    const anchorSection = project.centerlines.find(
      (section) => section.id === junction.centerline,
    );
    const anchorIndex = anchorSection?.pointIds.indexOf(junction.point) ?? -1;
    const position =
      anchorSection && anchorIndex >= 0 ? anchorSection.points[anchorIndex] : undefined;
    if (position) {
      points.push([position[0], position[1]]);
    }
  }
  return points;
}


function snapBranch(
  project: Project,
  main: ProjectCenterline,
  branch: ProjectCenterline,
): Vec2[] {
  const attach = branch.attach;
  if (!attach) {
    throw new BakeError(`branch "${branch.id}" is missing an attach block`);
  }

  const sampledMain = sampleCenterline(main.points as Vec2[], true, main.spline);
  let fraction: number;
  if ("junction" in attach) {
    const junction = project.junctions.find((candidate) => candidate.id === attach.junction);
    if (!junction) {
      throw new BakeError(`branch "${branch.id}" references an unknown junction`);
    }
    const hostPointIndex = main.pointIds.indexOf(junction.point);
    if (hostPointIndex < 0) {
      throw new BakeError(`junction "${junction.id}" references an unknown host point`);
    }
    const hostFraction = fractionAtControlPoint(
      main.points as Vec2[],
      true,
      main.spline,
      hostPointIndex,
    );
    if (hostFraction === null) {
      throw new BakeError(`could not resolve junction "${junction.id}" on the host`);
    }
    fraction = hostFraction;
    branch.pointIds[0] = junction.point;
  } else {
    fraction = attach.fraction;
  }

  const host = samplePolyline(sampledMain, true, fraction);
  branch.points[0] = [host.position[0], host.position[1]];
  const snapped: Vec2[] = [host.position];

  for (let i = 1; i < branch.points.length; i += 1) {
    const point = branch.points[i]!;
    const previous = snapped[snapped.length - 1]!;
    if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-9) {
      snapped.push([point[0], point[1]]);
    }
  }

  const endAttach = branch.endAttach;
  let endHost: ReturnType<typeof samplePolyline> | null = null;
  if (endAttach && "junction" in endAttach) {
    const junction = project.junctions.find(
      (candidate) => candidate.id === endAttach.junction,
    );
    if (!junction) {
      throw new BakeError(`branch "${branch.id}" references an unknown end junction`);
    }
    const hostPointIndex = main.pointIds.indexOf(junction.point);
    if (hostPointIndex < 0) {
      throw new BakeError(`end junction "${junction.id}" references an unknown host point`);
    }
    const hostFraction = fractionAtControlPoint(
      main.points as Vec2[],
      true,
      main.spline,
      hostPointIndex,
    );
    if (hostFraction === null) {
      throw new BakeError(`could not resolve end junction "${junction.id}" on the host`);
    }
    endHost = samplePolyline(sampledMain, true, hostFraction);
    branch.pointIds[branch.pointIds.length - 1] = junction.point;
    branch.points[branch.points.length - 1] = [endHost.position[0], endHost.position[1]];
    if (snapped.length > 0) {
      snapped[snapped.length - 1] = [endHost.position[0], endHost.position[1]];
    }
  }

  if (snapped.length < 2) {
    throw new BakeError(`branch "${branch.id}" has no non-degenerate segment after snapping`);
  }
  if (polylineSelfIntersections(snapped, false).length > 0) {
    throw new BakeError(`branch "${branch.id}" self-intersects after snapping`);
  }

  const edgesAt = (position: Vec2): Set<number> => {
    const edges = new Set<number>();
    for (let i = 0; i < sampledMain.length; i += 1) {
      const a = sampledMain[i]!;
      const b = sampledMain[(i + 1) % sampledMain.length]!;
      if (distancePointToSegmentSq(position, a, b) <= 1e-10) {
        edges.add(i);
      }
    }
    return edges;
  };

  const startEdges = edgesAt(host.position);
  const endEdges = endHost ? edgesAt(endHost.position) : new Set<number>();

  for (let segment = 0; segment < snapped.length - 1; segment += 1) {
    const a = snapped[segment]!;
    const b = snapped[segment + 1]!;
    for (let edge = 0; edge < sampledMain.length; edge += 1) {
      if (
        (segment === 0 && startEdges.has(edge)) ||
        (segment === snapped.length - 2 && endEdges.has(edge))
      ) {
        continue;
      }
      const c = sampledMain[edge]!;
      const d = sampledMain[(edge + 1) % sampledMain.length]!;
      if (segmentsIntersect(a, b, c, d)) {
        throw new BakeError(`branch "${branch.id}" crosses the main loop outside the attachment`);
      }
    }
  }

  return snapped;
}

function bakeBranches(
  project: Project,
  main: ProjectCenterline,
  branches: ProjectCenterline[],
): BakedTrack {
  const bands = mainBands(project, main);
  const prepared = branches.map((branch) => {
    const branchPoints = simplifyPolyline(
      sampleCenterline(snapBranch(project, main, branch), false, branch.spline),
      false,
    );

    if (branchPoints.length < 2) {
      throw new BakeError(`branch "${branch.id}" has no usable geometry after simplification`);
    }
    if (polylineSelfIntersections(branchPoints, false).length > 0) {
      throw new BakeError(`branch "${branch.id}" sampled centreline self-intersects`);
    }

    const asphaltRing = ribbon(branchPoints, project.road.halfWidth);
    const shoulderRing = branch.endAttach
      ? ribbon(branchPoints, project.road.shoulderHalfWidth)
      : extendedShoulderRibbon(branchPoints, project.road.shoulderHalfWidth);
    for (const [name, ring] of [
      ["asphalt", asphaltRing],
      ["shoulder", shoulderRing],
    ] as const) {
      if (!isSimplePolygon(ring)) {
        throw new BakeError(`branch "${branch.id}" ${name} ribbon self-intersects`);
      }
    }
    return { asphaltRing, shoulderRing };
  });

  try {
    const mainShoulderPolygon: Polygon2 = [bands.outerShoulder, bands.innerShoulder];
    const mainAsphaltPolygon: Polygon2 = [bands.outerAsphalt, bands.innerAsphalt];

    const shoulderFootprint = unionManyPolygons([
      mainShoulderPolygon,
      ...prepared.map((branch) => [branch.shoulderRing]),
    ]);
    const asphaltFootprint = unionManyPolygons([
      mainAsphaltPolygon,
      ...prepared.map((branch) => [branch.asphaltRing]),
    ]);

    if (shoulderFootprint.length === 0 || asphaltFootprint.length === 0) {
      throw new BakeError("road footprint union produced an empty surface");
    }

    const dirtFootprint = differencePolygons(shoulderFootprint, asphaltFootprint);
    const grassFootprint = differencePolygons([[bands.rectangle]], shoulderFootprint);

    if (dirtFootprint.length === 0) {
      throw new BakeError("dirt footprint difference produced an empty surface");
    }

    const provisional = conformMultiPolygons([
      asphaltFootprint,
      dirtFootprint,
      grassFootprint,
    ]);
    const normalized = provisional.map((multiPolygon) => normalizeMultiPolygon(multiPolygon));
    const [conformedAsphalt, conformedDirt, conformedGrass] = conformMultiPolygons(normalized);

    const builder = new MeshBuilder();
    addConformedMultiPolygon(builder, conformedAsphalt!, 0);
    addConformedMultiPolygon(builder, conformedDirt!, 1);
    if (project.terrain.points && project.terrain.points.length > 0) {
      addPointTerrainMultiPolygon(builder, conformedGrass!, project.terrain.points, 2);
    } else if (project.terrain.elevation) {
      addTerrainMultiPolygon(
        builder,
        conformedGrass!,
        bands.bounds,
        project.terrain.elevation,
        2,
      );
    } else {
      addConformedMultiPolygon(builder, conformedGrass!, 2);
    }

    return finishTrack(
      project,
      main,
      bands.bounds,
      applyTerrainMode(project, builder.build(), bands.bounds),
    );
  } catch (error) {
    if (error instanceof BakeError) {
      throw error;
    }
    throw new BakeError("junction bake failed", [String(error)]);
  }
}

function sectionsCross(
  a: Vec2[],
  aClosed: boolean,
  b: Vec2[],
  bClosed: boolean,
  allowed: Vec2[],
): boolean {
  const aCount = aClosed ? a.length : a.length - 1;
  const bCount = bClosed ? b.length : b.length - 1;
  for (let aIndex = 0; aIndex < aCount; aIndex += 1) {
    const aStart = a[aIndex]!;
    const aEnd = a[(aIndex + 1) % a.length]!;
    for (let bIndex = 0; bIndex < bCount; bIndex += 1) {
      const bStart = b[bIndex]!;
      const bEnd = b[(bIndex + 1) % b.length]!;
      if (!segmentsIntersect(aStart, aEnd, bStart, bEnd)) {
        continue;
      }
      const atSharedJunction = allowed.some(
        (point) =>
          distancePointToSegmentSq(point, aStart, aEnd) <= 1e-10 &&
          distancePointToSegmentSq(point, bStart, bEnd) <= 1e-10,
      );
      if (!atSharedJunction) {
        return true;
      }
    }
  }
  return false;
}

function bakeAllSections(project: Project): BakedTrack {
  snapSectionJunctions(project);

  const attachedPoints = sectionAttachedPoints(project);
  const sampledSections = project.centerlines.map((section) => ({
    section,
    points: simplifyPolyline(
      sampleCenterline(section.points as Vec2[], section.closed, section.spline),
      section.closed,
    ),
  }));
  for (let i = 0; i < sampledSections.length; i += 1) {
    for (let j = i + 1; j < sampledSections.length; j += 1) {
      const a = sampledSections[i]!;
      const b = sampledSections[j]!;
      if (
        sectionsCross(
          a.points,
          a.section.closed,
          b.points,
          b.section.closed,
          sharedJunctionPoints(project, a.section.id, b.section.id),
        )
      ) {
        throw new BakeError(
          `sections "${a.section.id}" and "${b.section.id}" intersect; connect them at a junction instead`,
        );
      }
    }
  }

  const bounds = sceneBounds(project);
  const rectangle: Vec2[] = [
    [bounds.min[0], bounds.min[2]],
    [bounds.max[0], bounds.min[2]],
    [bounds.max[0], bounds.max[2]],
    [bounds.min[0], bounds.max[2]],
  ];

  const asphaltPolygons: Polygon2[] = [];
  const shoulderPolygons: Polygon2[] = [];

  for (let sectionIndex = 0; sectionIndex < project.centerlines.length; sectionIndex += 1) {
    const section = project.centerlines[sectionIndex]!;
    if (section.closed) {
      const bands = mainBands(project, section);
      asphaltPolygons.push([bands.outerAsphalt, bands.innerAsphalt]);
      shoulderPolygons.push([bands.outerShoulder, bands.innerShoulder]);
      continue;
    }

    const sectionPoints = sampledSections[sectionIndex]!.points;
    if (sectionPoints.length < 2) {
      throw new BakeError(`section "${section.id}" has no usable geometry after simplification`);
    }
    if (polylineSelfIntersections(sectionPoints, false).length > 0) {
      throw new BakeError(`section "${section.id}" sampled centreline self-intersects`);
    }

    const asphaltRing = ribbon(sectionPoints, project.road.halfWidth);
    const startAttached = attachedPoints.has(
      `${section.id}:${section.pointIds[0]}`,
    );
    const endAttached = attachedPoints.has(
      `${section.id}:${section.pointIds[section.pointIds.length - 1]}`,
    );
    const shoulderRing = shoulderRibbonForEnds(
      sectionPoints,
      project.road.shoulderHalfWidth,
      startAttached,
      endAttached,
    );
    for (const [name, ring] of [
      ["asphalt", asphaltRing],
      ["shoulder", shoulderRing],
    ] as const) {
      if (!isSimplePolygon(ring)) {
        throw new BakeError(`section "${section.id}" ${name} ribbon self-intersects`);
      }
    }
    asphaltPolygons.push([asphaltRing]);
    shoulderPolygons.push([shoulderRing]);
  }

  try {
    const shoulderFootprint = unionManyPolygons(shoulderPolygons);
    const asphaltFootprint = unionManyPolygons(asphaltPolygons);

    if (shoulderFootprint.length === 0 || asphaltFootprint.length === 0) {
      throw new BakeError("road footprint union produced an empty surface");
    }

    const dirtFootprint = differencePolygons(shoulderFootprint, asphaltFootprint);
    const grassFootprint = differencePolygons([[rectangle]], shoulderFootprint);

    if (dirtFootprint.length === 0) {
      throw new BakeError("dirt footprint difference produced an empty surface");
    }

    const provisional = conformMultiPolygons([
      asphaltFootprint,
      dirtFootprint,
      grassFootprint,
    ]);
    const normalized = provisional.map((multiPolygon) => normalizeMultiPolygon(multiPolygon));
    const [conformedAsphalt, conformedDirt, conformedGrass] = conformMultiPolygons(normalized);

    const builder = new MeshBuilder();
    addConformedMultiPolygon(builder, conformedAsphalt!, 0);
    addConformedMultiPolygon(builder, conformedDirt!, 1);
    if (project.terrain.points && project.terrain.points.length > 0) {
      addPointTerrainMultiPolygon(builder, conformedGrass!, project.terrain.points, 2);
    } else if (project.terrain.elevation) {
      addTerrainMultiPolygon(
        builder,
        conformedGrass!,
        bounds,
        project.terrain.elevation,
        2,
      );
    } else {
      addConformedMultiPolygon(builder, conformedGrass!, 2);
    }

    const length = project.centerlines.reduce(
      (sum, section) => sum + sectionLength(section),
      0,
    );
    return finishTrack(
      project,
      undefined,
      bounds,
      applyTerrainMode(project, builder.build(), bounds),
      length,
    );
  } catch (error) {
    if (error instanceof BakeError) {
      throw error;
    }
    throw new BakeError("section bake failed", [String(error)]);
  }
}

export function bakeProject(project: Project): BakedTrack {
  if (isVenueSchema(project.schema)) {
    return bakeAllSections(project);
  }

  const closed = project.centerlines.filter((centerline) => centerline.closed);
  const open = project.centerlines.filter((centerline) => !centerline.closed);

  if (closed.length !== 1) {
    throw new BakeError("bake requires exactly one closed centreline");
  }

  const main = closed[0]!;

  if (open.length === 0) {
    return bakeLoop(project, main);
  }

  return bakeBranches(project, main, open);
}
