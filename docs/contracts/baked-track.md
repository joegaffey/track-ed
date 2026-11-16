# Contract — `BakedTrack` v1

Status: normative for v1. `kerbGraph` is an additive optional graph.

## Purpose

`BakedTrack` is the consumer-neutral contract between the geometry kernel and every export profile. It is an in-memory model, not a file format.

The TypeScript reference is `src/model/baked-track.ts`. This document defines the rules that types cannot express.

## Boundary

- The kernel produces `BakedTrack`.
- An export profile consumes `BakedTrack`.
- `BakedTrack` MUST NOT contain consumer-specific fields: no `.sima`, pack chunks, rkyv, importer node names, game surface IDs, or game-specific metadata.
- The model is not persisted. `track-ed/project@3` is the current authoring format; `project@1` and `project@2` are legacy inputs.

## Shape

```ts
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

interface BakedTrack {
  kind: "track";
  name: string;
  length: number;
  bounds: { min: Vec3; max: Vec3 };
  surfaceGraph: SurfaceGraph;
  kerbGraph?: SurfaceGraph;
  surfaces: Surface[];
  spawns: Spawn[];
  cameras: Camera[];
}

interface SurfaceGraph {
  positions: Vec3[];
  indices: number[];
  triangleSurfaces: number[];
}

interface Surface {
  id: number;
  name: string;
  friction: number;
  roughness: number;
}

interface Spawn {
  name: string;
  position: Vec3;
  rotation: Quat;
}

interface Camera {
  name: string;
  position: Vec3;
  target: Vec3;
  fovY: number;
}
```

## Normative rules

- **BM1** The model MUST NOT contain consumer-specific fields.
- **BM2** `positions` MUST be finite. `indices` MUST reference valid positions and contain whole triangles.
- **BM3** `triangleSurfaces.length` MUST equal `indices.length / 3`. Every id MUST exist in `surfaces`.
- **BM4** `surfaces[].id` MUST be unique. `surfaces[].name` MUST be unique and non-empty.
- **BM5** `bounds` MUST enclose every position.
- **BM6** `length` MUST be the track length in metres. For `project@3` it is the sum of all section lengths; for legacy single-main-loop projects it is the main-loop arc length. Spline sections are measured on the sampled polyline. Branches and dead ends are included for `project@3`.
- **BM7** `spawns` MUST contain at least one spawn. Rotations MUST be normalized and face the centreline tangent.
- **BM8** `cameras` MAY be empty.
- **BM9** `surfaceGraph` MUST satisfy geometry requirements G3–G11 from `SPEC.md` before any profile may export it. `kerbGraph`, when present, MUST satisfy K1–K3.
- **BM9a** `kerbGraph` is separate from `surfaceGraph` and does not change the welded ground graph. It contains raised kerb tops, sides, and end caps. Kerb triangles MAY have non-vertical or vertical normals.
- **BM10** The model MUST be deterministic: the same project yields the same positions, indices, surface ids, and ordering.
- **BM11** No timestamps, generated-by strings, or environment-dependent values may appear in the model.
- **BM12** The model is not persisted.
- **BM13** Quaternions are `xyzw`. Vectors and positions are `[x, y, z]` in metres.

## Geometry invariants

The kernel MUST validate, and the inspector MUST expose:

- one non-overlapping welded surface graph;
- terrain fills the infield and outfield within scene bounds;
- no base plane under road surfaces;
- shared boundary positions match within `1e-5 m`;
- after welding, every interior edge has exactly two adjacent triangles;
- boundary edges only on the outer perimeter;
- no T-junctions;
- no degenerate triangles;
- consistent winding;
- every triangle assigned exactly one surface;
- collision geometry identical to visual geometry;
- branch ends capped and integrated into the terrain.

Kerb rules:

- **K1** Kerb triangles MUST be non-degenerate and MUST NOT duplicate one another.
- **K2** After welding, the kerb graph MUST NOT contain T-junctions.
- **K3** Kerb surfaces MUST use declared `kerb_*` surfaces and MUST be separate from the ground surface graph. Collision policy is declared by the export profile; v1 exports all kerb faces as solid.
- **K4** Each contiguous kerb run MUST use equal-length elements with a flat leading edge and one raised corner per element. The raised corner MUST be higher than the flat edge. Riser faces MUST point along the direction of travel.
- Kerb spans MAY terminate at junction mouths. Their exposed ends MUST be capped, and no kerb top may cover junction asphalt.
- Kerb base heights MUST follow the same ground/terrain height source as the adjacent road and shoulder.

## Profile obligations

- An export profile MUST be a pure mapping from `BakedTrack` to a bundle.
- A profile MUST NOT repair, retriangulate, or alter geometry.
- A profile MAY apply a declared coordinate convention conversion. v0 applies none.
- All consumer-specific naming, defaults, and metadata live in the profile.
- A profile MUST reject an invalid `BakedTrack` rather than exporting it.

## Determinism

- Stable ordering for positions, indices, surfaces, spawns, and cameras.
- No timestamps.
- No random identifiers.
- Repeat export of the same project must be byte-identical.

## Validation

1. Validate the structural rules BM1–BM8, BM12, and BM13.
2. Validate the geometry invariants above.
3. Pass only a valid model to the profile.
4. The inspector and exporter share the same validation implementation.
