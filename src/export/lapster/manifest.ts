import type { BakedTrack, Quat, Vec3 } from "../../model/baked-track";

export interface LapsterSurface {
  id: number;
  name: string;
  friction: number;
  roughness: number;
  materials: string[];
  mountable?: boolean;
}

export interface LapsterCamera {
  name: string;
  position: Vec3;
  target: Vec3;
  fov_y: number;
}

export interface LapsterSpawn {
  position: Vec3;
  rotation_xyzw: Quat;
}

export interface LapsterVisual {
  glb: string;
  include: string[];
  exclude: string[];
  scale: number;
  yaw_degrees: number;
  offset: Vec3;
}

export interface LapsterCollision {
  include: string[];
  exclude: string[];
}

export interface LapsterManifest {
  schema: "sim-track-glb-v1";
  kind: "track";
  name: string;
  length: number;
  spawn: LapsterSpawn;
  cameras?: LapsterCamera[];
  visual: LapsterVisual;
  collision: LapsterCollision;
  surfaces: LapsterSurface[];
  default_surface: number;
}

export function buildLapsterManifest(track: BakedTrack): LapsterManifest {
  const spawn = track.spawns[0];
  if (!spawn) {
    throw new Error("a Lapster track manifest requires at least one spawn");
  }
  if (track.surfaces.length === 0) {
    throw new Error("a Lapster track manifest requires at least one surface");
  }

  const asphalt = track.surfaces.find((surface) => surface.name === "asphalt");
  const hasProps = (track.props?.length ?? 0) > 0;
  const hasPropCollision = (track.props ?? []).some((prop) => prop.collision);
  const surfaces = track.surfaces.map((surface) => ({ ...surface }));
  if (hasPropCollision && !surfaces.some((surface) => surface.name === "wall")) {
    surfaces.push({
      id: 5,
      name: "wall",
      friction: 0.45,
      roughness: 0.65,
    });
  }
  const manifest: LapsterManifest = {
    schema: "sim-track-glb-v1",
    kind: "track",
    name: track.name,
    length: track.length,
    spawn: {
      position: [spawn.position[0], spawn.position[1], spawn.position[2]],
      rotation_xyzw: [
        spawn.rotation[0],
        spawn.rotation[1],
        spawn.rotation[2],
        spawn.rotation[3],
      ],
    },
    visual: {
      glb: "track.glb",
      include: hasProps ? ["surface_*", "prop_*"] : ["surface_*"],
      exclude: [],
      scale: 1,
      yaw_degrees: 0,
      offset: [0, 0, 0],
    },
    collision: {
      include: hasPropCollision ? ["surface_*", "col_*"] : ["surface_*"],
      exclude: [],
    },
    surfaces: surfaces.map((surface) => ({
      id: surface.id,
      name: surface.name,
      friction: surface.friction,
      roughness: surface.roughness,
      materials: [surface.name],
    })),
    default_surface: asphalt?.id ?? track.surfaces[0]!.id,
  };

  if (track.cameras.length > 0) {
    manifest.cameras = track.cameras.map((camera) => ({
      name: camera.name,
      position: [camera.position[0], camera.position[1], camera.position[2]],
      target: [camera.target[0], camera.target[1], camera.target[2]],
      fov_y: camera.fovY,
    }));
  }

  return manifest;
}
