import type {
  BakedTrack,
  Camera,
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
  distancePointToSegmentSq,
  leftNormal,
  normalize2,
  scale2,
  segmentsIntersect,
  signedArea2,
  sub2,
} from "./math2";
import type { Project, ProjectCenterline } from "./project";
import { DEFAULT_SURFACES } from "./surfaces";

export class BakeError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "BakeError";
    this.issues = issues.length > 0 ? issues : [message];
  }
}

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

function spawnFor(project: Project, fallback?: ProjectCenterline): Spawn {
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
    rotation: quaternionFacing(sample.tangent),
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
  const surfaces: Surface[] = DEFAULT_SURFACES.map((surface) => ({ ...surface }));
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
  if (project.schema === "track-ed/project@3") {
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
