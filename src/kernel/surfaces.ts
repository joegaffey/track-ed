import type { Surface } from "../model/baked-track";

export const DEFAULT_SURFACES: readonly Surface[] = [
  { id: 0, name: "asphalt", friction: 1.0, roughness: 0.02 },
  { id: 1, name: "dirt", friction: 0.7, roughness: 1.0 },
  { id: 2, name: "grass", friction: 0.35, roughness: 0.8 },
];
