import type {
  Project,
  ProjectKerbSpan,
  ProjectWallSpan,
} from "./project";

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
  block: 2,
};

export type RoadsideSide = "left" | "right";
export type RoadsideSurfaceKind = "kerb" | "wall";
export type RoadsideOffsetReference =
  | "centerline"
  | "asphalt-edge"
  | "shoulder-edge";
export type RoadsideJunctionPolicy = "clip" | "follow";
export type RoadsideCollision = "solid" | "mountable" | "none";

export interface RoadsideLeg {
  section: string;
  start: number;
  length: number;
}

export interface RoadsideOffset {
  reference: RoadsideOffsetReference;
  distance: number;
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
  offset: RoadsideOffset;
  junctionPolicy: RoadsideJunctionPolicy;
  collision: RoadsideCollision;
  profile: RoadsideSurfaceProfile;
}

export type RoadsideRun = RoadsideSurfaceRun;

function kerbSpanLeg(sectionId: string, span: ProjectKerbSpan): RoadsideLeg {
  return {
    section: sectionId,
    start: span.start,
    length: span.length,
  };
}

function wallSpanLeg(sectionId: string, span: ProjectWallSpan): RoadsideLeg {
  return {
    section: sectionId,
    start: span.start,
    length: span.length,
  };
}

function kerbSpanProfile(
  project: Project,
  span: ProjectKerbSpan,
): RoadsideKerbProfile {
  return {
    kind: "kerb",
    width: KERB_WIDTH,
    flatHeight:
      span.flatHeight ??
      project.kerbs?.flatHeight ??
      DEFAULT_KERB_FLAT_HEIGHT,
    cornerHeight:
      span.cornerHeight ??
      project.kerbs?.cornerHeight ??
      DEFAULT_KERB_CORNER_HEIGHT,
    elementLength: KERB_ELEMENT_LENGTH,
  };
}

export function roadsideRunsFromProject(project: Project): RoadsideRun[] {
  const runs: RoadsideRun[] = [];
  for (const section of project.centerlines) {
    const kerbSpans = section.kerbs ?? [];
    for (let index = 0; index < kerbSpans.length; index += 1) {
      const span = kerbSpans[index]!;
      if (span.length <= 1e-9) {
        continue;
      }
      runs.push({
        id: `${section.id}:kerb:${index}`,
        kind: "kerb",
        mechanism: "surface",
        side: span.side,
        legs: [kerbSpanLeg(section.id, span)],
        offset: {
          reference: "asphalt-edge",
          distance: KERB_WIDTH / 2,
        },
        junctionPolicy: "clip",
        collision: "solid",
        profile: kerbSpanProfile(project, span),
      });
    }

    const wallSpans = section.walls ?? [];
    for (let index = 0; index < wallSpans.length; index += 1) {
      const span = wallSpans[index]!;
      if (span.length <= 1e-9) {
        continue;
      }
      runs.push({
        id: `${section.id}:wall:${index}`,
        kind: "wall",
        mechanism: "surface",
        side: span.side,
        legs: [wallSpanLeg(section.id, span)],
        offset: {
          reference: "asphalt-edge",
          distance: span.offset ?? DEFAULT_WALL_OFFSET,
        },
        junctionPolicy: "follow",
        collision: "solid",
        profile: {
          kind: "wall",
          width: WALL_THICKNESS,
          height: span.height ?? DEFAULT_WALL_HEIGHT,
        },
      });
    }
  }
  return runs;
}
