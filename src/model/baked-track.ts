export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface SurfaceGraph {
  positions: Vec3[];
  indices: number[];
  triangleSurfaces: number[];
}

export interface LineGraph {
  positions: Vec3[];
  uvs: [number, number][];
  indices: number[];
}

export interface Surface {
  id: number;
  name: string;
  friction: number;
  roughness: number;
}

export interface Spawn {
  name: string;
  position: Vec3;
  rotation: Quat;
}

export interface Camera {
  name: string;
  position: Vec3;
  target: Vec3;
  fovY: number;
}

export type PropKind = "tree" | "tyre" | "block";

export interface Prop {
  id: string;
  kind: PropKind;
  position: Vec3;
  rotation: Quat;
  scale: number;
  collision: boolean;
}

export type LayoutDirection = "forward" | "reverse";

export interface RaceLayout {
  layout_id: string;
  closed: boolean;
  direction: LayoutDirection;
  points: Vec3[];
  half_width: number;
}

export interface RaceStartFinish {
  section_id: string;
  fraction: number;
  position: Vec3;
  rotation_xyzw: Quat;
}

export interface RaceGridSlot {
  name: string;
  position: Vec3;
  rotation_xyzw: Quat;
}

export interface RaceSector {
  name: string;
  start_fraction: number;
  end_fraction: number;
}

export interface RaceData {
  version: number;
  layout: RaceLayout;
  start_finish: RaceStartFinish;
  grid: RaceGridSlot[];
  sectors: RaceSector[];
}

export interface BakedTrack {
  kind: "track";
  name: string;
  length: number;
  bounds: Bounds;
  surfaceGraph: SurfaceGraph;
  kerbGraph?: SurfaceGraph;
  wallGraph?: SurfaceGraph;
  racingLine?: LineGraph;
  props?: Prop[];
  race?: RaceData;
  warnings?: string[];
  surfaces: Surface[];
  spawns: Spawn[];
  cameras: Camera[];
}
