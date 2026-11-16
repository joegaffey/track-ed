import type { Project } from "./project";

export const KERB_WIDTH = 0.8;
export const DEFAULT_KERB_FLAT_HEIGHT = 0.06;
export const DEFAULT_KERB_CORNER_HEIGHT = 0.155;
export const KERB_ELEMENT_LENGTH = 2;
export const KERB_SAMPLE_SPACING = 2;

export const WALL_THICKNESS = 0.3;
export const DEFAULT_WALL_HEIGHT = 1;
export const DEFAULT_WALL_OFFSET = 0;
export const WALL_SAMPLE_SPACING = 2;

export const DEFAULT_PROP_OFFSETS: Record<"tree" | "tyre" | "block", number> = {
  tree: 4.5,
  tyre: 0.8,
  block: 1,
};
export const DEFAULT_PROP_SPACING: Record<"tree" | "tyre" | "block", number> = {
  tree: 4.5,
  tyre: 0.8,
  block: 2.4,
};

export const DEFAULT_PROP_CENTERLINE_OFFSETS: Record<
  "tree" | "tyre" | "block",
  number
> = {
  tree: 12,
  tyre: 5.8,
  block: 9,
};

export type RoadsideSide = "left" | "right";
export type RoadsideSurfaceKind = "kerb" | "wall";
export type RoadsideInstanceKind = "tree" | "tyre" | "block";
export type RoadsideKind = RoadsideSurfaceKind | RoadsideInstanceKind;
export type RoadsideCollision = "solid" | "none";

export interface RoadsideLeg {
  section: string;
  start: number;
  length: number;
}

export interface RoadsideKerbProfile {
  kind: "kerb";
  width: number;
  flatHeight: number;
  cornerHeight: number;
  elementLength: number;
}

export interface RoadsideWallProfile {
  kind: "wall";
  width: number;
  height: number;
}

export type RoadsideSurfaceProfile = RoadsideKerbProfile | RoadsideWallProfile;

export interface RoadsideSurfaceRun {
  id: string;
  kind: RoadsideSurfaceKind;
  mechanism: "surface";
  side: RoadsideSide;
  legs: RoadsideLeg[];
  offset: number;
  collision: "solid";
  profile: RoadsideSurfaceProfile;
}

export interface RoadsideInstanceRun {
  id: string;
  kind: RoadsideInstanceKind;
  mechanism: "instances";
  side: RoadsideSide;
  legs: RoadsideLeg[];
  offset: number;
  collision: RoadsideCollision;
  spacing: number;
}

export type RoadsideRun = RoadsideSurfaceRun | RoadsideInstanceRun;

interface FractionInterval {
  start: number;
  end: number;
}

function spanIntervals(
  start: number,
  length: number,
  closed: boolean,
): FractionInterval[] {
  const end = start + length;
  if (closed && end > 1 + 1e-9) {
    return [
      { start, end: 1 },
      { start: 0, end: end - 1 },
    ];
  }
  return [{ start, end }];
}

function subtractInterval(
  pieces: FractionInterval[],
  cut: FractionInterval,
): FractionInterval[] {
  const result: FractionInterval[] = [];
  for (const piece of pieces) {
    const overlapStart = Math.max(piece.start, cut.start);
    const overlapEnd = Math.min(piece.end, cut.end);
    if (overlapEnd <= overlapStart + 1e-9) {
      result.push(piece);
      continue;
    }
    if (overlapStart - piece.start > 1e-9) {
      result.push({ start: piece.start, end: overlapStart });
    }
    if (piece.end - overlapEnd > 1e-9) {
      result.push({ start: overlapEnd, end: piece.end });
    }
  }
  return result;
}

function kerbProfile(
  project: Project,
  run: { flatHeight?: number; cornerHeight?: number },
): RoadsideKerbProfile {
  return {
    kind: "kerb",
    width: KERB_WIDTH,
    flatHeight:
      run.flatHeight ??
      project.kerbs?.flatHeight ??
      DEFAULT_KERB_FLAT_HEIGHT,
    cornerHeight:
      run.cornerHeight ??
      project.kerbs?.cornerHeight ??
      DEFAULT_KERB_CORNER_HEIGHT,
    elementLength: KERB_ELEMENT_LENGTH,
  };
}

function legacyRuns(project: Project): RoadsideRun[] {
  const runs: RoadsideRun[] = [];
  for (const section of project.centerlines) {
    const kerbOffset = project.road.halfWidth;
    for (let index = 0; index < (section.kerbs ?? []).length; index += 1) {
      const span = section.kerbs![index]!;
      if (span.length <= 1e-9) {
        continue;
      }
      runs.push({
        id: `${section.id}:kerb:${index}`,
        kind: "kerb",
        mechanism: "surface",
        side: span.side,
        legs: [{ section: section.id, start: span.start, length: span.length }],
        offset: kerbOffset,
        collision: "solid",
        profile: kerbProfile(project, span),
      });
    }
    for (let index = 0; index < (section.walls ?? []).length; index += 1) {
      const span = section.walls![index]!;
      if (span.length <= 1e-9) {
        continue;
      }
      runs.push({
        id: `${section.id}:wall:${index}`,
        kind: "wall",
        mechanism: "surface",
        side: span.side,
        legs: [{ section: section.id, start: span.start, length: span.length }],
        offset: project.road.halfWidth + (span.offset ?? DEFAULT_WALL_OFFSET),
        collision: "solid",
        profile: {
          kind: "wall",
          width: WALL_THICKNESS,
          height: span.height ?? DEFAULT_WALL_HEIGHT,
        },
      });
    }
    for (let index = 0; index < (section.props ?? []).length; index += 1) {
      const span = section.props![index]!;
      if (span.length <= 1e-9) {
        continue;
      }
      runs.push({
        id: `${section.id}:prop:${index}`,
        kind: span.kind,
        mechanism: "instances",
        side: span.side,
        legs: [{ section: section.id, start: span.start, length: span.length }],
        offset:
          project.road.halfWidth +
          (span.offset ?? DEFAULT_PROP_OFFSETS[span.kind]),
        collision:
          span.collision === undefined
            ? "solid"
            : span.collision === "solid"
              ? "solid"
              : "none",
        spacing: span.spacing ?? DEFAULT_PROP_SPACING[span.kind],
      });
    }
  }
  return runs;
}

function splineRuns(project: Project): RoadsideRun[] {
  const runs: RoadsideRun[] = [];
  for (const section of project.centerlines) {
    for (let splineIndex = 0; splineIndex < (section.roadside ?? []).length; splineIndex += 1) {
      const spline = section.roadside![splineIndex]!;
      for (let runIndex = 0; runIndex < spline.runs.length; runIndex += 1) {
        const run = spline.runs[runIndex]!;
        if (run.length <= 1e-9) {
          continue;
        }
        const id = `${section.id}:${spline.id}:${runIndex}`;
        const leg = {
          section: section.id,
          start: run.start,
          length: run.length,
        };
        if (run.kind === "kerb") {
          runs.push({
            id,
            kind: "kerb",
            mechanism: "surface",
            side: spline.side,
            legs: [leg],
            offset: spline.offset,
            collision: "solid",
            profile: kerbProfile(project, run),
          });
        } else if (run.kind === "wall") {
          runs.push({
            id,
            kind: "wall",
            mechanism: "surface",
            side: spline.side,
            legs: [leg],
            offset: spline.offset,
            collision: "solid",
            profile: {
              kind: "wall",
              width: WALL_THICKNESS,
              height: run.height ?? DEFAULT_WALL_HEIGHT,
            },
          });
        } else {
          const outwardOffset =
            run.outwardOffset ??
            (spline.role !== undefined
              ? DEFAULT_PROP_CENTERLINE_OFFSETS[run.kind] -
                project.road.halfWidth
              : 0);
          runs.push({
            id,
            kind: run.kind,
            mechanism: "instances",
            side: spline.side,
            legs: [leg],
            offset: spline.offset + outwardOffset,
            collision:
              run.collision === undefined
                ? "solid"
                : run.collision === "solid"
                  ? "solid"
                  : "none",
            spacing: run.spacing ?? DEFAULT_PROP_SPACING[run.kind],
          });
        }
      }
    }
  }
  return runs;
}

function suppressKerbsUnderWalls(
  project: Project,
  runs: readonly RoadsideRun[],
): RoadsideRun[] {
  const wallIntervals = new Map<string, FractionInterval[]>();
  for (const run of runs) {
    if (run.kind !== "wall") {
      continue;
    }
    for (const leg of run.legs) {
      const section = project.centerlines.find(
        (candidate) => candidate.id === leg.section,
      );
      if (!section) {
        continue;
      }
      const key = `${leg.section}:${run.side}`;
      const intervals = wallIntervals.get(key) ?? [];
      intervals.push(...spanIntervals(leg.start, leg.length, section.closed));
      wallIntervals.set(key, intervals);
    }
  }
  if (wallIntervals.size === 0) {
    return [...runs];
  }

  const result: RoadsideRun[] = [];
  for (const run of runs) {
    if (run.kind !== "kerb") {
      result.push(run);
      continue;
    }
    for (let legIndex = 0; legIndex < run.legs.length; legIndex += 1) {
      const leg = run.legs[legIndex]!;
      const section = project.centerlines.find(
        (candidate) => candidate.id === leg.section,
      );
      if (!section) {
        continue;
      }
      let pieces = spanIntervals(leg.start, leg.length, section.closed);
      for (const wall of wallIntervals.get(`${leg.section}:${run.side}`) ?? []) {
        pieces = subtractInterval(pieces, wall);
      }
      for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
        const piece = pieces[pieceIndex]!;
        const length = piece.end - piece.start;
        if (length <= 1e-9) {
          continue;
        }
        result.push({
          ...run,
          id: `${run.id}:${legIndex}:${pieceIndex}`,
          legs: [{ section: leg.section, start: piece.start, length }],
        });
      }
    }
  }
  return result;
}

export function roadsideRunsFromProject(project: Project): RoadsideRun[] {
  const runs =
    project.centerlines.some((section) => section.roadside !== undefined)
      ? splineRuns(project)
      : legacyRuns(project);
  return suppressKerbsUnderWalls(project, runs);
}
