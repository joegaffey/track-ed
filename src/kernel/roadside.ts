import type { Project, ProjectKerbSpan } from "./project";

export const KERB_WIDTH = 0.8;
export const DEFAULT_KERB_FLAT_HEIGHT = 0.06;
export const DEFAULT_KERB_CORNER_HEIGHT = 0.155;
export const KERB_ELEMENT_LENGTH = 2;
export const KERB_SAMPLE_SPACING = 2;

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
    const spans = section.kerbs ?? [];
    for (let index = 0; index < spans.length; index += 1) {
      const span = spans[index]!;
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
  }
  return runs;
}
