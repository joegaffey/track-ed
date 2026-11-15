import {
  absSignedArea,
  hasDuplicateConsecutivePoints,
  polylineSelfIntersections,
  type Vec2,
} from "./geometry";

export type ProjectVec2 = [number, number];
export type ProjectVec3 = [number, number, number];
export type ProjectSchema =
  | "track-ed/project@1"
  | "track-ed/project@2"
  | "track-ed/project@3";

export interface ProjectRoad {
  halfWidth: number;
  shoulderHalfWidth: number;
}

export interface ProjectElevation {
  amplitude: number;
  wavelength: number;
  phase: number;
  blend: number;
  gridSpacing: number;
}

export interface ProjectTerrainPoint {
  position: ProjectVec2;
  height: number;
}

export interface ProjectTerrain {
  margin: number;
  mode: "conform" | "follow";
  elevation?: ProjectElevation;
  points?: ProjectTerrainPoint[];
}

export type ProjectAttach =
  | { to: string; fraction: number }
  | { junction: string };

export interface ProjectJunctionMember {
  section: string;
  point: string;
}

export interface ProjectJunction {
  id: string;
  centerline: string;
  point: string;
  members?: ProjectJunctionMember[];
}

export interface ProjectSpline {
  type: "catmull-rom";
  samplesPerSegment: number;
}

export interface ProjectCenterline {
  id: string;
  closed: boolean;
  points: ProjectVec2[];
  pointIds: string[];
  attach?: ProjectAttach;
  endAttach?: ProjectAttach;
  spline?: ProjectSpline;
}

export interface ProjectSpawn {
  centerline: string;
  fraction: number;
  lateral: number;
}

export interface ProjectCamera {
  name: string;
  position: ProjectVec3;
  target: ProjectVec3;
  fovY: number;
}

export interface Project {
  schema: ProjectSchema;
  name: string;
  generator: string;
  road: ProjectRoad;
  terrain: ProjectTerrain;
  centerlines: ProjectCenterline[];
  junctions: ProjectJunction[];
  spawn: ProjectSpawn;
  cameras: ProjectCamera[];
}

export interface ProjectIssue {
  path: string;
  message: string;
}

export interface ProjectParseResult {
  project: Project | null;
  issues: ProjectIssue[];
  warnings: ProjectIssue[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectObject(value: unknown, path: string, issues: ProjectIssue[]): JsonObject | null {
  if (!isObject(value)) {
    issues.push({ path, message: "must be an object" });
    return null;
  }
  return value;
}

function rejectUnknownKeys(
  object: JsonObject,
  allowed: readonly string[],
  path: string,
  issues: ProjectIssue[],
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      issues.push({ path: `${path}.${key}`, message: "unknown field" });
    }
  }
}

function readString(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
): string | null {
  if (typeof value !== "string" || value.length === 0) {
    issues.push({ path, message: "must be a non-empty string" });
    return null;
  }
  return value;
}

function readBoolean(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
): boolean | null {
  if (typeof value !== "boolean") {
    issues.push({ path, message: "must be a boolean" });
    return null;
  }
  return value;
}

function readNumber(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({ path, message: "must be a finite number" });
    return null;
  }
  return value;
}

function readPositiveNumber(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
): number | null {
  const number = readNumber(value, path, issues);
  if (number !== null && number <= 0) {
    issues.push({ path, message: "must be greater than zero" });
    return null;
  }
  return number;
}

function readFraction(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
): number | null {
  const number = readNumber(value, path, issues);
  if (number !== null && (number < 0 || number >= 1)) {
    issues.push({ path, message: "must be in [0, 1)" });
    return null;
  }
  return number;
}

function readNumberTuple(
  value: unknown,
  length: number,
  path: string,
  issues: ProjectIssue[],
): number[] | null {
  if (!Array.isArray(value) || value.length !== length) {
    issues.push({ path, message: `must be an array of ${length} numbers` });
    return null;
  }
  const result: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const number = readNumber(value[i], `${path}[${i}]`, issues);
    if (number === null) {
      return null;
    }
    result.push(number);
  }
  return result;
}

function readVec2(value: unknown, path: string, issues: ProjectIssue[]): ProjectVec2 | null {
  const tuple = readNumberTuple(value, 2, path, issues);
  return tuple ? [tuple[0]!, tuple[1]!] : null;
}

function readVec3(value: unknown, path: string, issues: ProjectIssue[]): ProjectVec3 | null {
  const tuple = readNumberTuple(value, 3, path, issues);
  return tuple ? [tuple[0]!, tuple[1]!, tuple[2]!] : null;
}

function readVec2Array(
  value: unknown,
  path: string,
  minItems: number,
  issues: ProjectIssue[],
): ProjectVec2[] | null {
  if (!Array.isArray(value) || value.length < minItems) {
    issues.push({ path, message: `must be an array with at least ${minItems} points` });
    return null;
  }
  const points: ProjectVec2[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const point = readVec2(value[i], `${path}[${i}]`, issues);
    if (!point) {
      return null;
    }
    points.push(point);
  }
  return points;
}

function parseRoad(value: unknown, path: string, issues: ProjectIssue[]): ProjectRoad | null {
  const object = expectObject(value, path, issues);
  if (!object) {
    return null;
  }
  rejectUnknownKeys(object, ["halfWidth", "shoulderHalfWidth"], path, issues);
  const halfWidth = readPositiveNumber(object.halfWidth, `${path}.halfWidth`, issues);
  const shoulderHalfWidth = readPositiveNumber(
    object.shoulderHalfWidth,
    `${path}.shoulderHalfWidth`,
    issues,
  );
  if (halfWidth === null || shoulderHalfWidth === null) {
    return null;
  }
  if (shoulderHalfWidth <= halfWidth) {
    issues.push({
      path: `${path}.shoulderHalfWidth`,
      message: "must be greater than road.halfWidth",
    });
    return null;
  }
  return { halfWidth, shoulderHalfWidth };
}

function parseElevation(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
): ProjectElevation | null {
  const object = expectObject(value, path, issues);
  if (!object) {
    return null;
  }
  rejectUnknownKeys(
    object,
    ["amplitude", "wavelength", "phase", "blend", "gridSpacing"],
    path,
    issues,
  );

  const amplitude = readPositiveNumber(object.amplitude, `${path}.amplitude`, issues);
  const wavelength = readPositiveNumber(object.wavelength, `${path}.wavelength`, issues);
  const phase =
    object.phase === undefined ? 0 : readNumber(object.phase, `${path}.phase`, issues);
  const blend =
    object.blend === undefined
      ? 20
      : readPositiveNumber(object.blend, `${path}.blend`, issues);
  const gridSpacing =
    object.gridSpacing === undefined
      ? 10
      : readPositiveNumber(object.gridSpacing, `${path}.gridSpacing`, issues);

  if (
    amplitude === null ||
    wavelength === null ||
    phase === null ||
    blend === null ||
    gridSpacing === null
  ) {
    return null;
  }
  return { amplitude, wavelength, phase, blend, gridSpacing };
}

function parseTerrainPoint(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
): ProjectTerrainPoint | null {
  const object = expectObject(value, path, issues);
  if (!object) {
    return null;
  }
  rejectUnknownKeys(object, ["position", "height"], path, issues);
  const position = readVec2(object.position, `${path}.position`, issues);
  const height = readNumber(object.height, `${path}.height`, issues);
  return position === null || height === null ? null : { position, height };
}

function parseTerrain(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
): ProjectTerrain | null {
  const object = expectObject(value, path, issues);
  if (!object) {
    return null;
  }
  rejectUnknownKeys(object, ["margin", "mode", "elevation", "points"], path, issues);
  const margin = readPositiveNumber(object.margin, `${path}.margin`, issues);
  let mode: "conform" | "follow" = "conform";
  if (object.mode !== undefined) {
    const value = readString(object.mode, `${path}.mode`, issues);
    if (value !== null && value !== "conform" && value !== "follow") {
      issues.push({ path: `${path}.mode`, message: 'must be "conform" or "follow"' });
    } else if (value !== null) {
      mode = value;
    }
  }
  const elevation =
    object.elevation === undefined
      ? undefined
      : parseElevation(object.elevation, `${path}.elevation`, issues);

  let points: ProjectTerrainPoint[] | undefined;
  if (object.points !== undefined) {
    if (!Array.isArray(object.points)) {
      issues.push({ path: `${path}.points`, message: "must be an array" });
      points = undefined;
    } else {
      points = [];
      for (let i = 0; i < object.points.length; i += 1) {
        const point = parseTerrainPoint(object.points[i], `${path}.points[${i}]`, issues);
        if (!point) {
          points = undefined;
          break;
        }
        points.push(point);
      }
    }
  }

  if (margin === null) {
    return null;
  }
  if (object.elevation !== undefined && elevation === null) {
    return null;
  }
  if (object.points !== undefined && points === undefined) {
    return null;
  }

  if (points) {
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i]!.position;
        const b = points[j]!.position;
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.25) {
          issues.push({
            path: `${path}.points[${j}]`,
            message: "terrain points must be at least 0.25 m apart",
          });
        }
      }
    }
  }

  return {
    margin,
    mode,
    ...(elevation ? { elevation } : {}),
    ...(points ? { points } : {}),
  };
}

function parseAttach(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
  schema: ProjectSchema,
): ProjectAttach | null {
  const object = expectObject(value, path, issues);
  if (!object) {
    return null;
  }
  if (schema === "track-ed/project@2") {
    rejectUnknownKeys(object, ["junction"], path, issues);
    const junction = readString(object.junction, `${path}.junction`, issues);
    return junction === null ? null : { junction };
  }

  rejectUnknownKeys(object, ["to", "fraction"], path, issues);
  const to = readString(object.to, `${path}.to`, issues);
  const fraction = readFraction(object.fraction, `${path}.fraction`, issues);
  return to === null || fraction === null ? null : { to, fraction };
}

function parsePointObjects(
  value: unknown,
  path: string,
  minItems: number,
  issues: ProjectIssue[],
): { points: ProjectVec2[]; pointIds: string[] } | null {
  if (!Array.isArray(value) || value.length < minItems) {
    issues.push({ path, message: `must be an array with at least ${minItems} points` });
    return null;
  }

  const points: ProjectVec2[] = [];
  const pointIds: string[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${path}[${index}]`;
    const object = expectObject(value[index], itemPath, issues);
    if (!object) {
      return null;
    }
    rejectUnknownKeys(object, ["id", "position"], itemPath, issues);
    const id = readString(object.id, `${itemPath}.id`, issues);
    const position = readVec2(object.position, `${itemPath}.position`, issues);
    if (id === null || position === null) {
      return null;
    }
    if (ids.has(id)) {
      issues.push({ path: itemPath, message: `duplicate point id "${id}"` });
      return null;
    }
    ids.add(id);
    pointIds.push(id);
    points.push(position);
  }
  return { points, pointIds };
}

function parseJunctionMember(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
): ProjectJunctionMember | null {
  const object = expectObject(value, path, issues);
  if (!object) {
    return null;
  }
  rejectUnknownKeys(object, ["section", "point"], path, issues);
  const section = readString(object.section, `${path}.section`, issues);
  const point = readString(object.point, `${path}.point`, issues);
  return section === null || point === null ? null : { section, point };
}

function parseJunction(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
  schema: ProjectSchema,
): ProjectJunction | null {
  const object = expectObject(value, path, issues);
  if (!object) {
    return null;
  }

  const id = readString(object.id, `${path}.id`, issues);
  if (schema === "track-ed/project@3") {
    rejectUnknownKeys(object, ["id", "members", "anchor"], path, issues);
    if (!Array.isArray(object.members) || object.members.length < 2) {
      issues.push({
        path: `${path}.members`,
        message: "must be an array with at least two members",
      });
      return null;
    }
    const members: ProjectJunctionMember[] = [];
    for (let i = 0; i < object.members.length; i += 1) {
      const member = parseJunctionMember(object.members[i], `${path}.members[${i}]`, issues);
      if (!member) {
        return null;
      }
      members.push(member);
    }
    const anchor =
      object.anchor === undefined
        ? members[0]!
        : parseJunctionMember(object.anchor, `${path}.anchor`, issues);
    if (!anchor || id === null) {
      return null;
    }
    return {
      id,
      centerline: anchor.section,
      point: anchor.point,
      members,
    };
  }

  rejectUnknownKeys(object, ["id", "centerline", "point"], path, issues);
  const centerline = readString(object.centerline, `${path}.centerline`, issues);
  const point = readString(object.point, `${path}.point`, issues);
  return id === null || centerline === null || point === null
    ? null
    : { id, centerline, point };
}

function parseSpline(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
): ProjectSpline | null {
  const object = expectObject(value, path, issues);
  if (!object) {
    return null;
  }
  rejectUnknownKeys(object, ["type", "samplesPerSegment"], path, issues);
  const type = readString(object.type, `${path}.type`, issues);
  if (type !== null && type !== "catmull-rom") {
    issues.push({ path: `${path}.type`, message: 'must be "catmull-rom"' });
  }

  let samplesPerSegment = 12;
  if (object.samplesPerSegment !== undefined) {
    const value = readNumber(object.samplesPerSegment, `${path}.samplesPerSegment`, issues);
    if (value !== null && (!Number.isInteger(value) || value < 2 || value > 64)) {
      issues.push({
        path: `${path}.samplesPerSegment`,
        message: "must be an integer between 2 and 64",
      });
    } else if (value !== null) {
      samplesPerSegment = value;
    }
  }

  return type === "catmull-rom" ? { type, samplesPerSegment } : null;
}

function parseCenterline(
  value: unknown,
  path: string,
  issues: ProjectIssue[],
  schema: ProjectSchema,
): ProjectCenterline | null {
  const object = expectObject(value, path, issues);
  if (!object) {
    return null;
  }
  const isV3 = schema === "track-ed/project@3";
  rejectUnknownKeys(
    object,
    isV3
      ? ["id", "closed", "points", "spline"]
      : ["id", "closed", "points", "attach", "endAttach", "spline"],
    path,
    issues,
  );

  const id = readString(object.id, `${path}.id`, issues);
  const closed = readBoolean(object.closed, `${path}.closed`, issues);
  let points: ProjectVec2[] | null;
  let pointIds: string[];
  if (schema === "track-ed/project@2" || isV3) {
    const parsedPoints = parsePointObjects(object.points, `${path}.points`, 2, issues);
    points = parsedPoints?.points ?? null;
    pointIds = parsedPoints?.pointIds ?? [];
  } else {
    points = readVec2Array(object.points, `${path}.points`, 2, issues);
    pointIds = points ? points.map((_, index) => `${id ?? "centerline"}-p${index}`) : [];
  }
  let spline: ProjectSpline | null = null;
  if (object.spline !== undefined) {
    spline = parseSpline(object.spline, `${path}.spline`, issues);
  }

  let attach: ProjectAttach | null = null;
  if (!isV3 && object.attach !== undefined) {
    attach = parseAttach(object.attach, `${path}.attach`, issues, schema);
  }

  let endAttach: ProjectAttach | null = null;
  if (!isV3 && object.endAttach !== undefined) {
    if (schema !== "track-ed/project@2") {
      issues.push({
        path: `${path}.endAttach`,
        message: "endAttach is only supported in track-ed/project@2",
      });
    } else {
      endAttach = parseAttach(object.endAttach, `${path}.endAttach`, issues, schema);
    }
  }

  if (closed === true) {
    if (points && points.length < 3) {
      issues.push({
        path: `${path}.points`,
        message: "a closed centreline needs at least 3 points",
      });
    }
    if (!isV3 && object.attach !== undefined) {
      issues.push({
        path: `${path}.attach`,
        message: "must be omitted for a closed centreline",
      });
    }
    if (!isV3 && object.endAttach !== undefined) {
      issues.push({
        path: `${path}.endAttach`,
        message: "must be omitted for a closed centreline",
      });
    }
  } else if (closed === false && !isV3 && object.attach === undefined) {
    issues.push({
      path: `${path}.attach`,
      message: "is required for an open centreline",
    });
  }

  if (id === null || closed === null || points === null) {
    return null;
  }
  if (closed === false && !isV3 && attach === null) {
    return null;
  }

  return {
    id,
    closed,
    points,
    pointIds,
    ...(attach ? { attach } : {}),
    ...(endAttach ? { endAttach } : {}),
    ...(spline ? { spline } : {}),
  };
}

function parseSpawn(value: unknown, path: string, issues: ProjectIssue[]): ProjectSpawn | null {
  const object = expectObject(value, path, issues);
  if (!object) {
    return null;
  }
  rejectUnknownKeys(object, ["centerline", "fraction", "lateral"], path, issues);
  const centerline = readString(object.centerline, `${path}.centerline`, issues);
  const fraction = readFraction(object.fraction, `${path}.fraction`, issues);
  const lateral =
    object.lateral === undefined ? 0 : readNumber(object.lateral, `${path}.lateral`, issues);
  return centerline === null || fraction === null || lateral === null
    ? null
    : { centerline, fraction, lateral };
}

function parseCamera(value: unknown, path: string, issues: ProjectIssue[]): ProjectCamera | null {
  const object = expectObject(value, path, issues);
  if (!object) {
    return null;
  }
  rejectUnknownKeys(object, ["name", "position", "target", "fovY"], path, issues);
  const name = readString(object.name, `${path}.name`, issues);
  const position = readVec3(object.position, `${path}.position`, issues);
  const target = readVec3(object.target, `${path}.target`, issues);
  const fovY = readPositiveNumber(object.fovY, `${path}.fovY`, issues);
  return name === null || position === null || target === null || fovY === null
    ? null
    : { name, position, target, fovY };
}

function segmentLengths(points: readonly Vec2[], closed: boolean): number[] {
  const lengths: number[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    lengths.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return lengths;
}

function validateSemantics(project: Project, issues: ProjectIssue[]): void {
  const isV1 = project.schema === "track-ed/project@1";
  const isV3 = project.schema === "track-ed/project@3";

  if (isV1 && project.centerlines.length > 2) {
    issues.push({
      path: "centerlines",
      message: "project@1 supports at most two centrelines (one closed, one open)",
    });
  }

  const ids = new Set<string>();
  for (const centerline of project.centerlines) {
    if (ids.has(centerline.id)) {
      issues.push({
        path: "centerlines",
        message: `duplicate centreline id "${centerline.id}"`,
      });
    }
    ids.add(centerline.id);
  }

  const closed = project.centerlines.filter((centerline) => centerline.closed);
  const open = project.centerlines.filter((centerline) => !centerline.closed);

  if (!isV3 && closed.length !== 1) {
    issues.push({
      path: "centerlines",
      message: "project@1 and project@2 require exactly one closed centreline",
    });
  }
  if (isV1 && open.length > 1) {
    issues.push({
      path: "centerlines",
      message: "project@1 supports at most one open centreline",
    });
  }

  const junctionIds = new Set<string>();
  const junctionPoints = new Set<string>();
  for (const junction of project.junctions) {
    if (junctionIds.has(junction.id)) {
      issues.push({ path: "junctions", message: `duplicate junction id "${junction.id}"` });
    }
    junctionIds.add(junction.id);

    const host = project.centerlines.find((candidate) => candidate.id === junction.centerline);
    if (!host) {
      issues.push({
        path: `junctions[${junction.id}].centerline`,
        message: `unknown centreline "${junction.centerline}"`,
      });
      continue;
    }
    if (!isV3 && !host.closed) {
      issues.push({
        path: `junctions[${junction.id}].centerline`,
        message: "junction host must be a closed centreline",
      });
    }
    if (!host.pointIds.includes(junction.point)) {
      issues.push({
        path: `junctions[${junction.id}].point`,
        message: `unknown point "${junction.point}" on centreline "${junction.centerline}"`,
      });
    }

    if (isV3) {
      const members = junction.members ?? [];
      if (members.length < 2) {
        issues.push({
          path: `junctions[${junction.id}].members`,
          message: "must contain at least two members",
        });
      }
      const sectionsInJunction = new Set<string>();
      const anchored = new Set<string>();
      for (let index = 0; index < members.length; index += 1) {
        const member = members[index]!;
        const section = project.centerlines.find(
          (candidate) => candidate.id === member.section,
        );
        if (!section) {
          issues.push({
            path: `junctions[${junction.id}].members[${index}].section`,
            message: `unknown section "${member.section}"`,
          });
          continue;
        }
        if (!section.pointIds.includes(member.point)) {
          issues.push({
            path: `junctions[${junction.id}].members[${index}].point`,
            message: `unknown point "${member.point}" on section "${member.section}"`,
          });
        }
        if (sectionsInJunction.has(member.section)) {
          issues.push({
            path: `junctions[${junction.id}].members[${index}].section`,
            message: "a junction cannot contain two points from the same section",
          });
        }
        sectionsInJunction.add(member.section);
        anchored.add(`${member.section}:${member.point}`);
        const key = `${member.section}:${member.point}`;
        if (junctionPoints.has(key)) {
          issues.push({
            path: `junctions[${junction.id}].members[${index}]`,
            message: "a section point can belong to only one junction",
          });
        }
        junctionPoints.add(key);
      }
      if (!anchored.has(`${junction.centerline}:${junction.point}`)) {
        issues.push({
          path: `junctions[${junction.id}].anchor`,
          message: "anchor must be one of the junction members",
        });
      }
      continue;
    }

    const key = `${junction.centerline}:${junction.point}`;
    if (junctionPoints.has(key)) {
      issues.push({
        path: `junctions[${junction.id}].point`,
        message: "only one junction is allowed at a host point",
      });
    }
    junctionPoints.add(key);
  }

  for (const centerline of project.centerlines) {
    const path = `centerlines[${centerline.id}]`;
    if (hasDuplicateConsecutivePoints(centerline.points, centerline.closed)) {
      issues.push({
        path: `${path}.points`,
        message: "consecutive duplicate points or zero-length segments are not allowed",
      });
    }

    if (centerline.closed) {
      if (Math.abs(absSignedArea(centerline.points)) < 1e-9) {
        issues.push({
          path: `${path}.points`,
          message: "closed centreline must enclose a non-zero area",
        });
      }
      if (polylineSelfIntersections(centerline.points, true).length > 0) {
        issues.push({
          path: `${path}.points`,
          message: "closed centreline must not self-intersect",
        });
      }
    } else if (polylineSelfIntersections(centerline.points, false).length > 0) {
      issues.push({
        path: `${path}.points`,
        message: "open centreline must not self-intersect",
      });
    }

    const attach = centerline.attach;
    if (attach) {
      if ("junction" in attach) {
        const junction = project.junctions.find(
          (candidate) => candidate.id === attach.junction,
        );
        if (!junction) {
          issues.push({
            path: `${path}.attach.junction`,
            message: `unknown junction "${attach.junction}"`,
          });
        } else {
          const host = project.centerlines.find(
            (candidate) => candidate.id === junction.centerline,
          );
          if (host) {
            if (centerline.pointIds[0] !== junction.point) {
              issues.push({
                path: `${path}.points[0].id`,
                message: "branch root point id must match the junction point id",
              });
            }
            const hostIndex = host.pointIds.indexOf(junction.point);
            const hostPoint = hostIndex >= 0 ? host.points[hostIndex] : undefined;
            const rootPoint = centerline.points[0];
            if (
              hostPoint &&
              rootPoint &&
              Math.hypot(hostPoint[0] - rootPoint[0], hostPoint[1] - rootPoint[1]) > 1e-6
            ) {
              issues.push({
                path: `${path}.points[0].position`,
                message: "branch root position must match the host junction point",
              });
            }
          }
        }
      } else {
        const host = project.centerlines.find(
          (candidate) => candidate.id === attach.to,
        );
        if (!host) {
          issues.push({
            path: `${path}.attach.to`,
            message: `unknown centreline "${attach.to}"`,
          });
        } else if (!host.closed) {
          issues.push({
            path: `${path}.attach.to`,
            message: "must reference a closed centreline",
          });
        }
      }
    }

    const endAttach = centerline.endAttach;
    if (endAttach) {
      if (centerline.closed) {
        issues.push({
          path: `${path}.endAttach`,
          message: "must be omitted for a closed centreline",
        });
      } else if ("junction" in endAttach) {
        const junction = project.junctions.find(
          (candidate) => candidate.id === endAttach.junction,
        );
        if (!junction) {
          issues.push({
            path: `${path}.endAttach.junction`,
            message: `unknown junction "${endAttach.junction}"`,
          });
        } else {
          const host = project.centerlines.find(
            (candidate) => candidate.id === junction.centerline,
          );
          if (host) {
            const lastIndex = centerline.pointIds.length - 1;
            if (centerline.pointIds[lastIndex] !== junction.point) {
              issues.push({
                path: `${path}.points[${lastIndex}].id`,
                message: "branch end point id must match the junction point id",
              });
            }
            const hostIndex = host.pointIds.indexOf(junction.point);
            const hostPoint = hostIndex >= 0 ? host.points[hostIndex] : undefined;
            const endPoint = centerline.points[lastIndex];
            if (
              hostPoint &&
              endPoint &&
              Math.hypot(hostPoint[0] - endPoint[0], hostPoint[1] - endPoint[1]) > 1e-6
            ) {
              issues.push({
                path: `${path}.points[${lastIndex}].position`,
                message: "branch end position must match the host junction point",
              });
            }
          }
        }
        if (
          centerline.attach &&
          "junction" in centerline.attach &&
          centerline.attach.junction === endAttach.junction
        ) {
          issues.push({
            path: `${path}.endAttach`,
            message: "branch start and end cannot reference the same junction",
          });
        }
      }
    }

    const length = segmentLengths(centerline.points, centerline.closed).reduce(
      (sum, value) => sum + value,
      0,
    );
    if (length <= 0) {
      issues.push({
        path: `${path}.points`,
        message: "centreline must have positive length",
      });
    }
  }

  if (!ids.has(project.spawn.centerline)) {
    issues.push({
      path: "spawn.centerline",
      message: `unknown centreline "${project.spawn.centerline}"`,
    });
  }

  if (Math.abs(project.spawn.lateral) > project.road.halfWidth + 1e-9) {
    issues.push({
      path: "spawn.lateral",
      message: "must stay within the asphalt band",
    });
  }
}

export function parseProject(input: unknown): ProjectParseResult {
  const issues: ProjectIssue[] = [];
  const warnings: ProjectIssue[] = [];

  const object = expectObject(input, "$", issues);
  if (!object) {
    return { project: null, issues, warnings };
  }

  rejectUnknownKeys(
    object,
    [
      "schema",
      "name",
      "generator",
      "road",
      "terrain",
      "centerlines",
      "sections",
      "junctions",
      "spawn",
      "cameras",
    ],
    "$",
    issues,
  );

  const schemaText = readString(object.schema, "$.schema", issues);
  if (
    schemaText !== null &&
    schemaText !== "track-ed/project@1" &&
    schemaText !== "track-ed/project@2" &&
    schemaText !== "track-ed/project@3"
  ) {
    issues.push({
      path: "$.schema",
      message:
        'must be "track-ed/project@1", "track-ed/project@2", or "track-ed/project@3"',
    });
  }
  const schema: ProjectSchema =
    schemaText === "track-ed/project@2" || schemaText === "track-ed/project@3"
      ? schemaText
      : "track-ed/project@1";
  const isV3 = schema === "track-ed/project@3";
  const name = readString(object.name, "$.name", issues);
  const generator = readString(object.generator, "$.generator", issues);
  const road = parseRoad(object.road, "$.road", issues);
  const terrain = parseTerrain(object.terrain, "$.terrain", issues);
  const spawn = parseSpawn(object.spawn, "$.spawn", issues);

  if (isV3 && object.centerlines !== undefined) {
    issues.push({
      path: "$.centerlines",
      message: "use sections for track-ed/project@3",
    });
  }
  if (!isV3 && object.sections !== undefined) {
    issues.push({
      path: "$.sections",
      message: "sections are only supported in track-ed/project@3",
    });
  }

  const sectionInput = isV3 ? object.sections : object.centerlines;
  const sectionPath = isV3 ? "$.sections" : "$.centerlines";
  let centerlines: ProjectCenterline[] | null = null;
  if (!Array.isArray(sectionInput) || sectionInput.length < 1) {
    issues.push({ path: sectionPath, message: "must be a non-empty array" });
  } else {
    centerlines = [];
    for (let i = 0; i < sectionInput.length; i += 1) {
      const centerline = parseCenterline(
        sectionInput[i],
        `${sectionPath}[${i}]`,
        issues,
        schema,
      );
      if (!centerline) {
        centerlines = null;
        break;
      }
      centerlines.push(centerline);
    }
  }

  let junctions: ProjectJunction[] = [];
  if (object.junctions !== undefined) {
    if (schema !== "track-ed/project@2" && schema !== "track-ed/project@3") {
      issues.push({
        path: "$.junctions",
        message: "junctions are only supported in track-ed/project@2 and project@3",
      });
    } else if (!Array.isArray(object.junctions)) {
      issues.push({ path: "$.junctions", message: "must be an array" });
    } else {
      for (let i = 0; i < object.junctions.length; i += 1) {
        const junction = parseJunction(
          object.junctions[i],
          `$.junctions[${i}]`,
          issues,
          schema,
        );
        if (!junction) {
          junctions = [];
          break;
        }
        junctions.push(junction);
      }
    }
  }

  let cameras: ProjectCamera[] = [];
  if (object.cameras !== undefined) {
    if (!Array.isArray(object.cameras)) {
      issues.push({ path: "$.cameras", message: "must be an array" });
      cameras = [];
    } else {
      for (let i = 0; i < object.cameras.length; i += 1) {
        const camera = parseCamera(object.cameras[i], `$.cameras[${i}]`, issues);
        if (!camera) {
          cameras = [];
          break;
        }
        cameras.push(camera);
      }
    }
  }

  if (
    schemaText !== "track-ed/project@1" &&
    schemaText !== "track-ed/project@2" &&
    schemaText !== "track-ed/project@3"
  ) {
    return { project: null, issues, warnings };
  }
  if (
    name === null ||
    generator === null ||
    road === null ||
    terrain === null ||
    centerlines === null ||
    spawn === null
  ) {
    return { project: null, issues, warnings };
  }

  const project: Project = {
    schema,
    name,
    generator,
    road,
    terrain,
    centerlines,
    junctions,
    spawn,
    cameras,
  };

  validateSemantics(project, issues);

  return { project: issues.length === 0 ? project : null, issues, warnings };
}

export function parseProjectJson(text: string): ProjectParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      project: null,
      issues: [{ path: "$", message: "invalid JSON" }],
      warnings: [],
    };
  }
  return parseProject(value);
}
