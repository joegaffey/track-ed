# Contract — `lapster-glb-track@3`

Status: normative for v1. `@3` adds wall nodes, prop nodes, and prop collision nodes to `@2`; the manifest schema remains `sim-track-glb-v1`.

## Purpose

`lapster-glb-track@3` is the current export profile. It maps a valid `BakedTrack` to two files consumed by Lapster's asset compiler:

- `track.glb`;
- `track.json`, satisfying Lapster's `sim-track-glb-v1` manifest.

`track.glb` is standard glTF 2.0. This profile owns the Lapster-specific manifest, `surface_*` node/material naming, surface metadata, spawn/collision rules, and bundle filenames.

The `.sima` pack is produced downstream by Lapster, not by track-ed.

The executable manifest schema is `schemas/lapster-track-manifest.schema.json`.

## Output files

```text
<export-dir>/
  track.glb
  track.json
```

`track.json` references the GLB by relative filename.

## Manifest

```json
{
  "schema": "sim-track-glb-v1",
  "kind": "track",
  "name": "Untitled Loop",
  "length": 312.4,
  "spawn": {
    "position": [0.0, 0.0, 0.0],
    "rotation_xyzw": [0.0, 0.0, 0.0, 1.0]
  },
  "visual": {
    "glb": "track.glb",
    "include": ["surface_*", "prop_*"],
    "exclude": [],
    "scale": 1.0,
    "yaw_degrees": 0.0,
    "offset": [0.0, 0.0, 0.0]
  },
  "collision": {
    "include": ["surface_*", "col_*"],
    "exclude": []
  },
  "surfaces": [
    { "id": 0, "name": "asphalt", "friction": 1.0, "roughness": 0.02, "materials": ["asphalt"] },
    { "id": 1, "name": "dirt", "friction": 0.7, "roughness": 1.0, "materials": ["dirt"] },
    { "id": 2, "name": "grass", "friction": 0.35, "roughness": 0.8, "materials": ["grass"] },
    { "id": 3, "name": "kerb_red", "friction": 0.9, "roughness": 0.2, "materials": ["kerb_red"] },
    { "id": 4, "name": "kerb_white", "friction": 0.9, "roughness": 0.2, "materials": ["kerb_white"] },
    { "id": 5, "name": "wall", "friction": 0.45, "roughness": 0.65, "materials": ["wall"] }
  ],
  "default_surface": 0
}
```

## Mapping from `BakedTrack`

- `name` -> `name`.
- `length` -> `length`.
- first spawn -> `spawn`.
- `cameras` -> `cameras`, or omitted when empty.
- `surfaces` -> `surfaces`.
- surface graph -> GLB visual and collision meshes without geometry changes.
- `kerbGraph` -> additional `surface_kerb_*` GLB visual and collision meshes without geometry changes. When `kerbGraph` is absent, no kerb nodes or surfaces are emitted.
- `wallGraph` -> additional `surface_wall` GLB visual and collision mesh without geometry changes. When `wallGraph` is absent, no wall node is emitted.
- `BakedTrack.props` instances -> world-space `prop_*` visual meshes grouped by prop material. Prop geometry follows Lapster's procedural prop conventions: concrete barrier blocks, alternating blue/white tyre stacks, and conifer tree tiers. Props with `collision: true` also emit a merged `col_prop` collision mesh using the `wall` material. Tree collision uses the trunk cylinder only; canopies are visual-only. Props never alter the surface or roadside graphs.

## Lapster GLB conventions

- Ground GLB scene nodes MUST be named `surface_asphalt`, `surface_dirt`, `surface_grass`.
- Asphalt and dirt materials MUST embed deterministic 256x256 procedural tarmac `image/png` textures tinted to the surface colour. Grass MUST embed a deterministic 256x256 procedural grass texture. Kerbs, walls, and props MUST embed deterministic solid-colour `image/png` textures. All material `baseColorFactor` values are white because tint is baked into the texture; Lapster's GLB track importer supplies white vertex colours to GLB track meshes.
- Every visual mesh primitive MUST include `TEXCOORD_0` using repeat-wrapped planar XZ UVs; texture samplers use repeat wrapping.
- Kerb, wall, concrete, tyre, and tree materials MUST set `extras.outline = true` so Lapster restores the OG editor's ink outlines. Asphalt, dirt, and grass materials omit the flag.
- Kerb GLB scene nodes MUST be named `surface_kerb_red` and `surface_kerb_white`.
- Wall GLB scene nodes MUST be named `surface_wall`.
- Prop visual GLB scene nodes MUST be named `prop_*` (`prop_tree_trunk`, `prop_tree_foliage`, `prop_tire_blue`, `prop_tire_white`, `prop_block`).
- Prop materials MUST use Lapster's conventional names: `tree_trunk`, `tree_foliage`, `tire_blue`, `tire_white`, and `concrete`.
- Prop collision GLB scene nodes MUST be named `col_*` (`col_prop`) and MUST use the `wall` material.
- Each surface node MUST use a material with the matching surface name.
- `visual.include` MUST be `["surface_*"]` when the track has no props, or `["surface_*", "prop_*"]` when it has props.
- `visual.exclude` MUST be `[]`.
- `collision.include` MUST be `["surface_*"]` when no prop has solid collision, or `["surface_*", "col_*"]` when at least one prop does.
- `collision.exclude` MUST be `[]`.
- v1 uses the same GLB nodes for visual and collision.
- If visual detail diverges later, emit separate `col_*` nodes and include those for collision.
- `visual.scale` MUST be `1`, `yaw_degrees` MUST be `0`, and `offset` MUST be `[0, 0, 0]`.

## Surfaces

- `id` MUST be unique.
- `name` MUST be unique and non-empty.
- `default_surface` MUST reference a declared surface.
- `materials` MUST contain at least one material name.
- v1 defaults:
  - asphalt: id `0`, friction `1.0`, roughness `0.02`;
  - dirt: id `1`, friction `0.7`, roughness `1.0`;
  - grass: id `2`, friction `0.35`, roughness `0.8`;
  - kerb_red: id `3`, friction `0.9`, roughness `0.2`;
  - kerb_white: id `4`, friction `0.9`, roughness `0.2`;
  - wall: id `5`, friction `0.45`, roughness `0.65`.
- Kerb surfaces are emitted only when a kerb graph is present.
- The wall surface is emitted when a wall graph is present or when any prop has solid collision.
- `mountable` is omitted in `@3`; Lapster treats omitted as `false`, so all kerb and wall faces participate in collision. This matches the v1 all-kerb-faces-solid decision.

## Spawn

- `position` is `[x, y, z]` in metres.
- `rotation_xyzw` is a normalized `xyzw` quaternion that maps track-ed's local `-Z` forward axis to the centreline tangent with `+Y` up.
- `position.y` MAY be `0`; Lapster snaps it to the collision height.
- v1 applies no axis conversion. The GLB geometry is authored in track-ed axes; glTF defines the asset front as `+Z`, and this profile does not rotate the asset to match it. Conformance MUST verify that Lapster uses the manifest spawn rotation and does not apply an additional asset-front rotation.
- If Lapster requires a different forward axis or asset orientation, the conversion MUST be declared in this profile and the profile version bumped.

## Length

- `length` is `BakedTrack.length` in metres.
- For `track-ed/project@3` it is the sum of all section lengths, including dead-ended open sections and every loop.
- For legacy `project@1`/`project@2` projects it is the main-loop arc length and branches are excluded.
- Spline sections are measured on the sampled polyline.

## Cameras

- v1 SHOULD omit `cameras`; Lapster synthesises a start camera.
- If present, camera fields are `name`, `position`, `target`, and `fov_y` in radians.

## Profile obligations

- The profile MUST be a pure mapping from `BakedTrack`.
- The profile MUST NOT repair, retriangulate, or alter geometry.
- The profile MUST reject an invalid `BakedTrack`.
- All Lapster-specific naming and defaults live in this profile.
- The profile is the only place where `.sima`, Lapster importer assumptions, and `sim-track-glb-v1` may be mentioned.

## Conformance

Run from a Lapster checkout:

```bash
cargo run -p asset-compiler -- bake-glb-track <export-dir> <out.sima>
cargo run -p asset-compiler -- inspect <out.sima>
cargo run -p asset-compiler -- validate <out.sima>
```

Then load the pack:

```text
http://127.0.0.1:8123/web/track-viewer/?track=../../<out.sima>
http://127.0.0.1:8123/web/drive/?track=../../<out.sima>
```

Acceptance: the pack validates, `inspect` reports `Track`, the track viewer shows the expected surfaces, and the car spawns and drives.

## Known importer gaps and assumptions

- Lapster's GLB track importer reads one spawn.
- It sets `pit_boxes` and `sectors` empty.
- It ignores multiple layouts and routes.
- The same GLB mesh may be used for visual and collision.
- Wildcard matching is case-insensitive; `*` and `?` are supported.
- An empty include list matches nothing.
- `length` is trusted from the manifest.
- `.sima` is produced by Lapster's compiler, not by track-ed.

## Versioning

- The profile version is `lapster-glb-track@3`.
- Changes to node names, material names, manifest fields, or surface defaults require a version bump. Texture content, UV accessors, and outline extras may evolve within `lapster-glb-track@3`.
- `@2` extends `@1` with optional kerb nodes and surfaces; ground nodes and manifest fields are unchanged.
- `@3` extends `@2` with optional wall, prop visual, and prop collision nodes. The manifest `visual.include` and `collision.include` patterns become conditional on the presence of walls/props.
- Lapster owns `sim-track-glb-v1`; track-ed pins a copy of the schema.
