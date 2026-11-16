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

export interface BakedTrack {
  kind: "track";
  name: string;
  length: number;
  bounds: Bounds;
  surfaceGraph: SurfaceGraph;
  kerbGraph?: SurfaceGraph;
  surfaces: Surface[];
  spawns: Spawn[];
  cameras: Camera[];
}
