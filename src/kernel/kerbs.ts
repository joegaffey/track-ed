import type { Bounds, SurfaceGraph, Vec3 } from "../model/baked-track";
import { BakeError } from "./bake-error";
import {
  offsetPolyline,
  polylineSelfIntersections,
  type Vec2,
} from "./geometry";
import { MeshBuilder } from "./mesh";
import { leftNormal, normalize2, scale2, sub2 } from "./math2";
import type { Project, ProjectCenterline, ProjectKerbSpan } from "./project";
import { fractionAtControlPoint, sampleCenterline } from "./spline";
import {
  buildPointTerrainSampler,
  rawTerrainHeight,
} from "./terrain";
import {
  KERB_RED_SURFACE,
  KERB_WHITE_SURFACE,
  WALL_SURFACE,
} from "./surfaces";

import {
  KERB_ELEMENT_LENGTH,
  KERB_SAMPLE_SPACING,
  KERB_WIDTH,
  WALL_SAMPLE_SPACING,
  roadsideRunsFromProject,
  type RoadsideSurfaceRun,
} from "./roadside";

const MIN_SEGMENT_LENGTH = 1e-6;

export {
  KERB_WIDTH,
  DEFAULT_KERB_FLAT_HEIGHT,
  DEFAULT_KERB_CORNER_HEIGHT,
  KERB_ELEMENT_LENGTH,
  KERB_SAMPLE_SPACING,
  WALL_SAMPLE_SPACING,
  WALL_THICKNESS,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_OFFSET,
  DEFAULT_PROP_OFFSETS,
  DEFAULT_PROP_SPACING,
  DEFAULT_PROP_CENTERLINE_OFFSETS,
} from "./roadside";

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
  sideName: "left" | "right",
  start: number,
  length: number,
  innerDistance: number,
  outerDistance: number,
  spacing = KERB_SAMPLE_SPACING,
): Station[] {
  const sampled = sampleCenterline(section.points as Vec2[], section.closed, section.spline);
  const sliced = sliceSpanPolyline(sampled, section.closed, start, length);
  const points = resamplePolyline(sliced, spacing);
  if (points.length < 2) {
    return [];
  }
  const side = sideName === "left" ? 1 : -1;
  const inner = offsetPolyline(points, false, side, innerDistance);
  const outer = offsetPolyline(points, false, side, outerDistance);
  if (inner.length !== points.length || outer.length !== points.length) {
    throw new BakeError(
      `roadside span ${section.id} [${start.toFixed(3)} + ${length.toFixed(3)}] could not be offset`,
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
        `roadside span ${section.id} [${start.toFixed(3)} + ${length.toFixed(3)}] collapses; widen the turn or reduce the width`,
      );
    }
  }
  if (
    polylineSelfIntersections(inner, false).length > 0 ||
    polylineSelfIntersections(outer, false).length > 0
  ) {
    throw new BakeError(
      `roadside span ${section.id} [${start.toFixed(3)} + ${length.toFixed(3)}] self-intersects; widen the turn or reduce the width`,
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
  if (Math.hypot(normal[0], normal[1], normal[2]) <= 1e-9) {
    return;
  }
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
  runStations: Station[],
  sideSign: 1 | -1,
  flatHeight: number,
  cornerHeight: number,
  colorPhase = 0,
): number {
  if (runStations.length < 2) {
    return 0;
  }
  const first = { start: runStations[0]!, end: runStations[1]! };
  const last = {
    start: runStations[runStations.length - 2]!,
    end: runStations[runStations.length - 1]!,
  };
  const runLength = last.end.distance - first.start.distance;
  if (runLength <= MIN_SEGMENT_LENGTH) {
    return 0;
  }
  const elementCount = Math.max(1, Math.round(runLength / KERB_ELEMENT_LENGTH));
  const elementLength = runLength / elementCount;
  const stations = runStations;
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
    colorPhase % 2 === 0 ? KERB_RED_SURFACE : KERB_WHITE_SURFACE,
    [-firstDirection[0], 0, -firstDirection[1]],
  );

  let previous: {
    innerTop: Vec3;
    outerTop: Vec3;
    direction: Vec2;
    surfaceId: number;
  } | null = null;

  const outerHeightAt = (t: number): number =>
    flatHeight + (cornerHeight - flatHeight) * Math.max(0, Math.min(1, t));

  for (let element = 0; element < elementCount; element += 1) {
    const startDistance = first.start.distance + element * elementLength;
    const endDistance = startDistance + elementLength;
    const surfaceId =
      (colorPhase + element) % 2 === 0 ? KERB_RED_SURFACE : KERB_WHITE_SURFACE;
    const uniqueBoundaries = [startDistance, endDistance];

    let elementStartTop: Vec3 | null = null;
    let elementEndTop: Vec3 | null = null;
    let elementEndInnerTop: Vec3 | null = null;
    let elementDirection: Vec2 | null = null;

    for (let index = 0; index < uniqueBoundaries.length - 1; index += 1) {
      const fromDistance = uniqueBoundaries[index]!;
      const toDistance = uniqueBoundaries[index + 1]!;
      const from = stationAt(fromDistance);
      const to = stationAt(toDistance);
      const fromBase = basePositions(from, flatHeight);
      const toBase = basePositions(to, flatHeight);
      const t0 = (fromDistance - startDistance) / elementLength;
      const t1 = (toDistance - startDistance) / elementLength;
      const fromTop = outerTopAt(from, outerHeightAt(t0), fromBase.innerTopY - 0.02);
      const toTop = outerTopAt(to, outerHeightAt(t1), toBase.innerTopY - 0.02);
      const direction = normalize2(sub2(to.inner, from.inner));
      const normal = leftNormal(direction);
      const outward: Vec3 = [normal[0] * sideSign, 0, normal[1] * sideSign];
      const inward: Vec3 = [-outward[0], 0, -outward[2]];

      if (index === 0) {
        elementStartTop = fromTop;
        if (previous) {
          addOrientedTriangle(
            builder,
            previous.innerTop,
            previous.outerTop,
            fromTop,
            previous.surfaceId,
            [previous.direction[0], 0, previous.direction[1]],
          );
        }
      }

      addOrientedQuad(
        builder,
        fromBase.innerTop,
        fromTop,
        toTop,
        toBase.innerTop,
        surfaceId,
        [0, 1, 0],
      );
      addOrientedQuad(
        builder,
        fromBase.innerBase,
        toBase.innerBase,
        toBase.innerTop,
        fromBase.innerTop,
        surfaceId,
        inward,
      );
      addOrientedQuad(
        builder,
        fromBase.outerBase,
        fromTop,
        toTop,
        toBase.outerBase,
        surfaceId,
        outward,
      );

      elementEndTop = toTop;
      elementEndInnerTop = toBase.innerTop;
      elementDirection = direction;
    }

    if (elementEndTop && elementEndInnerTop && elementDirection) {
      previous = {
        innerTop: elementEndInnerTop,
        outerTop: elementEndTop,
        direction: elementDirection,
        surfaceId,
      };
    }
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
  return elementCount;
}

function buildWallRun(
  builder: MeshBuilder,
  runStations: Station[],
  sideSign: 1 | -1,
  height: number,
): void {
  if (runStations.length < 2) {
    return;
  }
  for (let index = 0; index < runStations.length - 1; index += 1) {
    const from = runStations[index]!;
    const to = runStations[index + 1]!;
    const direction = normalize2(sub2(to.inner, from.inner));
    if (Math.hypot(direction[0], direction[1]) <= MIN_SEGMENT_LENGTH) {
      continue;
    }
    const normal = leftNormal(direction);
    const outward: Vec3 = [normal[0] * sideSign, 0, normal[1] * sideSign];
    const inward: Vec3 = [-outward[0], 0, -outward[2]];
    const fromInnerBase: Vec3 = [from.inner[0], from.innerBaseY, from.inner[1]];
    const fromInnerTop: Vec3 = [
      from.inner[0],
      from.innerBaseY + height,
      from.inner[1],
    ];
    const fromOuterBase: Vec3 = [from.outer[0], from.outerBaseY, from.outer[1]];
    const fromOuterTop: Vec3 = [
      from.outer[0],
      from.outerBaseY + height,
      from.outer[1],
    ];
    const toInnerBase: Vec3 = [to.inner[0], to.innerBaseY, to.inner[1]];
    const toInnerTop: Vec3 = [to.inner[0], to.innerBaseY + height, to.inner[1]];
    const toOuterBase: Vec3 = [to.outer[0], to.outerBaseY, to.outer[1]];
    const toOuterTop: Vec3 = [to.outer[0], to.outerBaseY + height, to.outer[1]];

    addOrientedQuad(
      builder,
      fromInnerBase,
      fromInnerTop,
      toInnerTop,
      toInnerBase,
      WALL_SURFACE,
      inward,
    );
    addOrientedQuad(
      builder,
      fromOuterBase,
      toOuterBase,
      toOuterTop,
      fromOuterTop,
      WALL_SURFACE,
      outward,
    );
    addOrientedQuad(
      builder,
      fromInnerTop,
      fromOuterTop,
      toOuterTop,
      toInnerTop,
      WALL_SURFACE,
      [0, 1, 0],
    );
  }

  const first = runStations[0]!;
  const second = runStations[1]!;
  const startDirection = normalize2(sub2(first.inner, second.inner));
  addOrientedQuad(
    builder,
    [first.inner[0], first.innerBaseY, first.inner[1]],
    [first.outer[0], first.outerBaseY, first.outer[1]],
    [first.outer[0], first.outerBaseY + height, first.outer[1]],
    [first.inner[0], first.innerBaseY + height, first.inner[1]],
    WALL_SURFACE,
    [startDirection[0], 0, startDirection[1]],
  );

  const last = runStations[runStations.length - 1]!;
  const previous = runStations[runStations.length - 2]!;
  const endDirection = normalize2(sub2(last.inner, previous.inner));
  addOrientedQuad(
    builder,
    [last.inner[0], last.innerBaseY, last.inner[1]],
    [last.outer[0], last.outerBaseY, last.outer[1]],
    [last.outer[0], last.outerBaseY + height, last.outer[1]],
    [last.inner[0], last.innerBaseY + height, last.inner[1]],
    WALL_SURFACE,
    [endDirection[0], 0, endDirection[1]],
  );
}

export function buildWallGraph(
  project: Project,
  bounds: Bounds,
): SurfaceGraph | undefined {
  const runs = roadsideRunsFromProject(project).filter(
    (run): run is RoadsideSurfaceRun =>
      run.mechanism === "surface" && run.profile.kind === "wall",
  );
  if (runs.length === 0) {
    return undefined;
  }

  const builder = new MeshBuilder();
  for (const run of runs) {
    const profile = run.profile;
    if (profile.kind !== "wall") {
      continue;
    }
    if (profile.height <= 0 || profile.width <= 0) {
      throw new BakeError(`wall run "${run.id}" has invalid dimensions`);
    }
    for (const leg of run.legs) {
      const section = project.centerlines.find(
        (candidate) => candidate.id === leg.section,
      );
      if (!section) {
        throw new BakeError(`wall run "${run.id}" references an unknown section`);
      }
      const stations = stationsForSpan(
        project,
        bounds,
        section,
        run.side,
        leg.start,
        leg.length,
        run.offset,
        run.offset + profile.width,
        WALL_SAMPLE_SPACING,
      );
      if (stations.length < 2) {
        continue;
      }
      buildWallRun(
        builder,
        stations,
        run.side === "left" ? 1 : -1,
        profile.height,
      );
    }
  }

  const graph = builder.build();
  return graph.indices.length > 0 ? graph : undefined;
}

export function buildKerbGraph(
  project: Project,
  bounds: Bounds,
): SurfaceGraph | undefined {
  const runs = roadsideRunsFromProject(project).filter(
    (run): run is RoadsideSurfaceRun =>
      run.mechanism === "surface" && run.profile.kind === "kerb",
  );
  if (runs.length === 0) {
    return undefined;
  }

  const builder = new MeshBuilder();
  for (const run of runs) {
    const profile = run.profile;
    if (profile.kind !== "kerb") {
      continue;
    }
    if (profile.cornerHeight <= profile.flatHeight) {
      throw new BakeError(
        `kerb run "${run.id}" cornerHeight must be greater than flatHeight`,
      );
    }
    for (const leg of run.legs) {
      const section = project.centerlines.find(
        (candidate) => candidate.id === leg.section,
      );
      if (!section) {
        throw new BakeError(`kerb run "${run.id}" references an unknown section`);
      }
      const stations = stationsForSpan(
        project,
        bounds,
        section,
        run.side,
        leg.start,
        leg.length,
        run.offset,
        run.offset + profile.width,
        KERB_SAMPLE_SPACING,
      );
      if (stations.length < 2) {
        continue;
      }
      buildRun(
        builder,
        stations,
        run.side === "left" ? 1 : -1,
        profile.flatHeight,
        profile.cornerHeight,
      );
    }
  }

  const graph = builder.build();
  return graph.indices.length > 0 ? graph : undefined;
}
