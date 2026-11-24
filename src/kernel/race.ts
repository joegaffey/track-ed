import type {
  Quat,
  RaceData,
  RaceGridSlot,
  RaceSector,
  Vec3,
} from "../model/baked-track";
import { centerlineLength, samplePolyline, type Vec2 } from "./geometry";
import { leftNormal } from "./math2";
import type { Project } from "./project";
import { sampleCenterline } from "./spline";

export const RACE_DATA_VERSION = 1;

const ROUTE_SPACING = 2;
const GRID_SLOT_COUNT = 10;
const GRID_FIRST_DISTANCE = 4;
const GRID_ROW_SPACING = 6;
const GRID_STAGGER = 1.5;
const GRID_EDGE_MARGIN = 0.5;
const GRID_LATERAL_STEP = 0.25;
const SECTOR_COUNT = 4;
const POSITION_TOLERANCE = 1e-3;
const ROTATION_TOLERANCE = 1e-3;
const FRACTION_TOLERANCE = 1e-4;

export interface RaceHeightSamplers {
  asphaltHeightAt: (x: number, z: number) => number | null;
  groundHeightAt: (x: number, z: number) => number | null;
}

export interface RaceValidationOptions {
  asphaltHeightAt?: (x: number, z: number) => number | null;
}

export interface RaceBuildResult {
  race?: RaceData;
  warnings: string[];
}

function quaternionFacing(tangent: Vec2): Quat {
  const yaw = Math.atan2(-tangent[0], -tangent[1]);
  const half = yaw / 2;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function isFiniteVec3(value: readonly number[]): boolean {
  return value.length === 3 && value.every((component) => Number.isFinite(component));
}

function isFiniteQuat(value: readonly number[]): boolean {
  return value.length === 4 && value.every((component) => Number.isFinite(component));
}

function horizontalDistanceToSegment(point: Vec3, start: Vec3, end: Vec3): number {
  const px = point[0];
  const pz = point[2];
  const ax = start[0];
  const az = start[2];
  const dx = end[0] - ax;
  const dz = end[2] - az;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq <= Number.EPSILON
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  const nearestX = ax + dx * t;
  const nearestZ = az + dz * t;
  return Math.hypot(px - nearestX, pz - nearestZ);
}

function routeDistanceTo(point: Vec3, points: readonly Vec3[]): number {
  let nearest = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    nearest = Math.min(nearest, horizontalDistanceToSegment(point, start, end));
  }
  return nearest;
}

function buildGrid(
  project: Project,
  route: readonly Vec2[],
  samplers: RaceHeightSamplers,
): RaceGridSlot[] {
  const total = centerlineLength(route, true);
  const maxLateral = Math.max(0, project.road.halfWidth - GRID_EDGE_MARGIN);
  const slots: RaceGridSlot[] = [];

  for (let index = 0; index < GRID_SLOT_COUNT; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    const behind =
      GRID_FIRST_DISTANCE +
      row * GRID_ROW_SPACING +
      (side === 1 ? GRID_STAGGER : 0);
    const wrapped = ((behind % total) + total) % total;
    const fraction = total > 0 ? 1 - wrapped / total : 0;
    const station = samplePolyline(route, true, fraction);
    const normal = leftNormal(station.tangent);

    let lateral = maxLateral;
    let x = station.position[0];
    let z = station.position[1];
    let y = 0;
    for (;;) {
      x = station.position[0] + normal[0] * lateral * side;
      z = station.position[1] + normal[1] * lateral * side;
      const asphalt = samplers.asphaltHeightAt(x, z);
      if (asphalt !== null) {
        y = asphalt;
        break;
      }
      if (lateral <= 0) {
        y = samplers.groundHeightAt(x, z) ?? 0;
        break;
      }
      lateral = Math.max(0, lateral - GRID_LATERAL_STEP);
    }

    slots.push({
      name: `grid_${index}`,
      position: [x, y, z],
      rotation_xyzw: quaternionFacing(station.tangent),
    });
  }

  return slots;
}

function buildSectors(): RaceSector[] {
  const sectors: RaceSector[] = [];
  for (let index = 0; index < SECTOR_COUNT; index += 1) {
    sectors.push({
      name: `sector_${index + 1}`,
      start_fraction: index / SECTOR_COUNT,
      end_fraction: (index + 1) / SECTOR_COUNT,
    });
  }
  return sectors;
}

export function buildRaceLayout(
  project: Project,
  samplers: RaceHeightSamplers,
): RaceBuildResult {
  const centerline = project.centerlines.find(
    (candidate) => candidate.id === project.spawn.centerline,
  );
  if (!centerline) {
    return {
      warnings: [
        `Race layout omitted: spawn centreline "${project.spawn.centerline}" was not found.`,
      ],
    };
  }
  if (!centerline.closed) {
    return {
      warnings: [
        `Race layout omitted: spawn centreline "${centerline.id}" is open.`,
      ],
    };
  }

  const sampled = sampleCenterline(
    centerline.points as Vec2[],
    centerline.closed,
    centerline.spline,
  );
  const total = centerlineLength(sampled, true);
  if (sampled.length < 3 || total <= 1e-9) {
    return {
      warnings: [
        `Race layout omitted: spawn centreline "${centerline.id}" has no usable route.`,
      ],
    };
  }

  const count = Math.max(3, Math.round(total / ROUTE_SPACING));
  const stations: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    stations.push(samplePolyline(sampled, true, index / count).position);
  }

  const spawnSample = samplePolyline(
    sampled,
    true,
    project.spawn.fraction,
  );
  let nearest = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index < stations.length; index += 1) {
    const station = stations[index]!;
    const distance = Math.hypot(
      station[0] - spawnSample.position[0],
      station[1] - spawnSample.position[1],
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  }

  const route = stations.slice(nearest).concat(stations.slice(0, nearest));
  const start = samplePolyline(route, true, 0);
  const agreement =
    start.tangent[0] * spawnSample.tangent[0] +
    start.tangent[1] * spawnSample.tangent[1];
  if (agreement <= 0) {
    return {
      warnings: [
        `Race layout omitted: spawn tangent on "${centerline.id}" opposes the centreline direction.`,
      ],
    };
  }

  const points: Vec3[] = route.map(([x, z]) => [
    x,
    samplers.asphaltHeightAt(x, z) ?? samplers.groundHeightAt(x, z) ?? 0,
    z,
  ]);
  const startPosition = points[0]!;

  const race: RaceData = {
    version: RACE_DATA_VERSION,
    layout: {
      layout_id: centerline.id,
      closed: true,
      direction: "forward",
      points,
      half_width: project.road.halfWidth,
    },
    start_finish: {
      section_id: centerline.id,
      fraction: project.spawn.fraction,
      position: [startPosition[0], startPosition[1], startPosition[2]],
      rotation_xyzw: quaternionFacing(start.tangent),
    },
    grid: buildGrid(project, route, samplers),
    sectors: buildSectors(),
  };

  const errors = validateRaceData(race, {
    asphaltHeightAt: samplers.asphaltHeightAt,
  });
  if (errors.length > 0) {
    return {
      warnings: [`Race layout omitted: ${errors.join("; ")}`],
    };
  }

  return { race, warnings: [] };
}

export function validateRaceData(
  race: RaceData,
  options: RaceValidationOptions = {},
): string[] {
  const errors: string[] = [];
  if (race.version !== RACE_DATA_VERSION) {
    errors.push(
      `race version ${race.version} is unsupported; expected ${RACE_DATA_VERSION}`,
    );
  }

  const layout = race.layout;
  if (typeof layout.layout_id !== "string" || layout.layout_id.trim().length === 0) {
    errors.push("race layout_id must be a non-empty string");
  }
  if (layout.closed !== true) {
    errors.push("race layout must be closed");
  }
  if (layout.direction !== "forward" && layout.direction !== "reverse") {
    errors.push("race layout direction must be forward or reverse");
  }
  if (!Array.isArray(layout.points) || layout.points.length < 3) {
    errors.push("race layout must have at least 3 points");
  } else {
    for (let index = 0; index < layout.points.length; index += 1) {
      if (!isFiniteVec3(layout.points[index]!)) {
        errors.push(`race layout point ${index} must be a finite vec3`);
      }
    }
  }
  if (!Number.isFinite(layout.half_width) || layout.half_width <= 0) {
    errors.push("race layout half_width must be positive and finite");
  }

  const startFinish = race.start_finish;
  if (
    typeof startFinish.section_id !== "string" ||
    startFinish.section_id.trim().length === 0
  ) {
    errors.push("race start_finish section_id must be a non-empty string");
  }
  if (
    !Number.isFinite(startFinish.fraction) ||
    startFinish.fraction < 0 ||
    startFinish.fraction >= 1
  ) {
    errors.push("race start_finish fraction must be finite and in [0, 1)");
  }
  if (!isFiniteVec3(startFinish.position)) {
    errors.push("race start_finish position must be a finite vec3");
  }
  if (!isFiniteQuat(startFinish.rotation_xyzw)) {
    errors.push("race start_finish rotation must be a finite quaternion");
  } else {
    const [x, y, z, w] = startFinish.rotation_xyzw;
    if (Math.abs(Math.hypot(x, y, z, w) - 1) > ROTATION_TOLERANCE) {
      errors.push("race start_finish rotation must be normalized");
    }
  }
  const first = layout.points?.[0];
  if (
    first &&
    isFiniteVec3(first) &&
    isFiniteVec3(startFinish.position) &&
    first.some(
      (component, index) =>
        Math.abs(component - startFinish.position[index]!) > POSITION_TOLERANCE,
    )
  ) {
    errors.push("race start_finish position must match layout point 0");
  }

  if (!Array.isArray(race.grid) || race.grid.length < 1 || race.grid.length > 10) {
    errors.push("race grid must contain 1..10 slots");
  } else {
    for (let index = 0; index < race.grid.length; index += 1) {
      const slot = race.grid[index]!;
      if (typeof slot.name !== "string" || slot.name.length === 0) {
        errors.push(`race grid slot ${index} must have a name`);
      }
      if (!isFiniteVec3(slot.position)) {
        errors.push(`race grid slot ${index} position must be a finite vec3`);
      }
      if (!isFiniteQuat(slot.rotation_xyzw)) {
        errors.push(`race grid slot ${index} rotation must be a finite quaternion`);
      } else {
        const [x, y, z, w] = slot.rotation_xyzw;
        if (Math.abs(Math.hypot(x, y, z, w) - 1) > ROTATION_TOLERANCE) {
          errors.push(`race grid slot ${index} rotation must be normalized`);
        }
      }
      if (
        isFiniteVec3(slot.position) &&
        layout.points.length >= 3 &&
        Number.isFinite(layout.half_width)
      ) {
        const nearest = routeDistanceTo(slot.position, layout.points);
        if (nearest > layout.half_width + POSITION_TOLERANCE) {
          errors.push(
            `race grid slot ${index} is ${nearest} m from the route; max is ${layout.half_width} m`,
          );
        }
        if (options.asphaltHeightAt) {
          const asphalt = options.asphaltHeightAt(slot.position[0], slot.position[2]);
          if (asphalt === null) {
            errors.push(`race grid slot ${index} must lie on drivable asphalt`);
          }
        }
      }
    }
  }

  if (!Array.isArray(race.sectors) || race.sectors.length === 0) {
    errors.push("race sectors must cover [0, 1]");
  } else {
    let expectedStart = 0;
    for (let index = 0; index < race.sectors.length; index += 1) {
      const sector = race.sectors[index]!;
      if (
        !Number.isFinite(sector.start_fraction) ||
        !Number.isFinite(sector.end_fraction)
      ) {
        errors.push(`race sector ${index} fractions must be finite`);
        continue;
      }
      if (
        sector.start_fraction < -FRACTION_TOLERANCE ||
        sector.end_fraction > 1 + FRACTION_TOLERANCE
      ) {
        errors.push(`race sector ${index} must lie within [0, 1]`);
      }
      if (sector.end_fraction <= sector.start_fraction) {
        errors.push(`race sector ${index} must end after it starts`);
      }
      if (Math.abs(sector.start_fraction - expectedStart) > FRACTION_TOLERANCE) {
        errors.push(`race sector ${index} must start at ${expectedStart}`);
      }
      expectedStart = sector.end_fraction;
    }
    if (Math.abs(expectedStart - 1) > FRACTION_TOLERANCE) {
      errors.push(`race sectors must end at 1.0, got ${expectedStart}`);
    }
  }

  if (options.asphaltHeightAt && Array.isArray(layout.points)) {
    for (let index = 0; index < layout.points.length; index += 1) {
      const point = layout.points[index]!;
      if (!isFiniteVec3(point)) {
        continue;
      }
      if (options.asphaltHeightAt(point[0], point[2]) === null) {
        errors.push(`race layout point ${index} must lie on drivable asphalt`);
      }
    }
  }

  return errors;
}
