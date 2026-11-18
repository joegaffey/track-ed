# Conformance report — `lapster-glb-track@4`

Status: v1-G5 re-conformance passed for all 19 fixtures. Outcome: promote to production. The visual racing line is exported as a separate visual-only node. Banking/crown is deferred as a post-promotion follow-up.
Date: 2026-11-18 (v1-G5 full-fixture rerun, track/drive viewer checks, and performance refresh).

## Environment

- track-ed: working tree, v1 implementation including procedural textures, outlines, and the visual racing line.
- Lapster: local checkout at branch `feat/junction-road-geometry`, commit `0b78c05` (set `$LAPSTER_DIR` or use your clone path).
- Export path: browser download from the track-ed app.
- Compiler: `cargo run -p asset-compiler -- bake-glb-track`, then `inspect` and `validate`.
- Viewer: `python3 -m http.server 8123 --bind 127.0.0.1` from the Lapster root.

The compiler emits a benign Cargo warning about `workspace.package.rust-version`; it is unrelated to track-ed.

The per-feature sections below record the earlier `@3` runs that established each feature. The G5 full-fixture table and the racing-line section have been refreshed for `@4`, which adds the visual-only `racing_line` node; collision and surface counts are unchanged.

## Fixtures

| Fixture | `track.glb` | `track.sima` | Vertices | Triangles | Surfaces | Spawns | Length |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `loop` | 3028 B | 8260 B | 84 | 50 | 3 | 1 | 360 m |
| `branch-90` | 3412 B | 10068 B | 108 | 66 | 3 | 1 | 360 m |
| `branch-45` | 3412 B | 10068 B | 108 | 66 | 3 | 1 | 360 m |
| `branch-30` | 3420 B | 10068 B | 108 | 66 | 3 | 1 | 360 m |

All four bundles produced `inspect` output of the form `<name> (Track)` and `validate` output `ok: <name> (Track), 3 chunks, <size> bytes`.

## Spline conformance (v1-G1)

All four spline fixtures, including a spline-sampled branch/junction road, passed the same Lapster path:

| Fixture | `track.sima` | Vertices | Triangles | Length | Inspect | Validate |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `loop-spline` | 66380 B | 876 | 578 | 371.36 m | `loop-spline (Track)` | ok |
| `branch-90-spline` | 84188 B | 1119 | 740 | 371.36 m | `branch-90-spline (Track)` | ok |
| `branch-45-spline` | 83356 B | 1107 | 732 | 371.36 m | `branch-45-spline (Track)` | ok |
| `branch-30-spline` | 82652 B | 1098 | 726 | 371.36 m | `branch-30-spline (Track)` | ok |

## Terrain conformance (v1-G2a)

| Fixture | `track.sima` | Vertices | Triangles | Length | Inspect | Validate |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `loop-spline-terrain` | 129100 B | 1758 | 1090 | 371.36 m | `loop-spline-terrain (Track)` | ok |
| `branch-90-spline-terrain` | 166948 B | 2274 | 1432 | 371.36 m | `branch-90-spline-terrain (Track)` | ok |

### Follow mode

| Fixture | `track.sima` | Vertices | Triangles | Length | Inspect | Validate |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `loop-spline-terrain-follow` | 129108 B | 1758 | 1090 | 371.36 m | `loop-spline-terrain-follow (Track)` | ok |
| `branch-90-spline-terrain-follow` | 166952 B | 2274 | 1432 | 371.36 m | `branch-90-spline-terrain-follow (Track)` | ok |

The terrain bundles use the same GLB nodes and collision mesh as the flat fixtures; elevation is in the shared surface graph. In follow mode the spawn height is sampled from the terrain (`y = 4` at the fixture spawn).

## Multi-junction conformance (`project@2`)

A `project@2` fixture with two junctions and three branches (two branches sharing one junction) passed:

| Asset | `track.sima` | Vertices | Triangles | Inspect | Validate |
| --- | ---: | ---: | ---: | --- | --- |
| multi-junction loop | 69460 B | 918 | 606 | `... (Track)` | ok |

The branch shoulder now extends past the asphalt end cap so dirt wraps the end without a self-touching ring. This also removes a T-junction/non-manifold edge that appeared at some branch end orientations.

A connector branch joined at both ends (`endAttach`) also passed: 66580 B `.sima`, 879 vertices, 580 triangles, `Track`, `validate ok`.

Merging two loose branch ends into one centreline passed: 67668 B `.sima`, 894 vertices, 590 triangles, `Track`, `validate ok`.

The `project@3` venue fixture with two disjoint closed sections and a dead-ended open spur passed (with authored kerbs): 609928 B `.sima`, 9460 vertices, 2980 triangles, `Two Loops and Spur (Track)`, `validate ok`.

The `project@3` junction fixture with a closed loop and an open spur attached at an interior loop control point passed (with authored kerbs): 366220 B `.sima`, 5670 vertices, 1755 triangles, `Loop and Spur Junction (Track)`, `validate ok`.

## Kerb conformance (v1-G3)

Two checked-in venue fixtures now author kerb spans across straights, corners, and junction approaches. The kerbs are exported as separate `surface_kerb_red` and `surface_kerb_white` nodes with solid collision on all faces.

| Fixture | `track.sima` | Vertices | Triangles | Surfaces | Inspect | Validate |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `venue-loop-spur-junction` | 366220 B | 5670 | 1755 | 5 | `venue-loop-spur-junction (Track)` | ok |
| `venue-two-loops-spur` | 609928 B | 9460 | 2980 | 5 | `venue-two-loops-spur (Track)` | ok |
| `venue-wrapped-kerb` | 296584 B | 4505 | 1601 | 5 | `venue-wrapped-kerb (Track)` | ok |

The loop-spur fixture has 1167 kerb triangles with continuous junction overlaps; the wrapped-kerb fixture has 447. Browser regression: opening `venue-wrapped-kerb` in Kerbs mode shows `0.900 – 0.100 (wraps)` and validates cleanly. Each contiguous kerb run is split into equal-length elements with a flat approach and one raised corner per element. Collision triangle counts equal the visual totals, confirming that kerb tops, risers, sides, and end caps are included. Section kerbs are no longer clipped at junctions; overlaps between adjacent section kerbs are intentional and included in collision.

## Wall and prop conformance (v1-G4)

`venue-walls-props` exercises two fixed kerb-edge splines and four free roadside splines on a closed loop: wall and kerb runs at the tarmac edge, block and tyre runs, and two tree layers at different free offsets.

| Fixture | `track.sima` | Vertices | Triangles | Surfaces | Inspect | Validate |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `venue-walls-props` | 4762560 B | 71325 | 34113 | 6 | `venue-walls-props (Track)` | ok |

The bundle has 15 materials, 15 textures, 15 draw calls, and 4,773 collision triangles. Asphalt, dirt, and grass use deterministic procedural textures with `TEXCOORD_0`; kerbs, walls, concrete, and tyres carry outline extras, while tree trunks and all foliage tones explicitly disable outlines for the softer layered conifers. `surface_wall` is exported as a separate wall graph; kerbs on the same side are suppressed under wall spans; props export as `prop_*` visual meshes using Lapster-derived block, tyre, and layered conifer geometry, plus a merged `col_prop` collision mesh using the `wall` material. Props default to solid collision and can opt out with `collision: "none"`; tree collision is trunk-only. The manifest uses `visual.include = ["surface_*", "prop_*", "racing_line"]` and `collision.include = ["surface_*", "col_*"]`. The track viewer and drive viewer loaded the bundle with no console errors; trees, tyres, blocks, walls, and the racing line render, the car spawns on the track, and the asphalt/grass textures and kerb/wall/prop outlines match the OG track editor style. Lapster also adds distant mountain terrain and dithered material fringes at runtime, bringing the scene to 40,833 triangles, 75,702 vertices, 17 textures, and 18 draw calls.

## G5 full-fixture re-conformance

All 19 checked-in project fixtures were parsed, baked, validated in-process, exported to `track.glb` + `track.json` with `@4`, and compiled with the Lapster debug binary at `0b78c05`. Every fixture produced `inspect` output ending in `(Track)` and `validate` output `ok`.

| Fixture | `.sima` | Vertices | Triangles | Surfaces | Length | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `loop` | 1139012 B | 1351 | 2210 | 3 | 360.00 m | ok |
| `loop-spline` | 1199820 B | 2185 | 2810 | 3 | 371.36 m | ok |
| `loop-spline-terrain` | 1262540 B | 3067 | 3322 | 3 | 371.36 m | ok |
| `loop-spline-terrain-follow` | 1262548 B | 3067 | 3322 | 3 | 371.36 m | ok |
| `loop-spline-terrain-junctions` | 1201172 B | 2203 | 2822 | 3 | 371.36 m | ok |
| `loop-spline-terrain-points` | 1201172 B | 2203 | 2822 | 3 | 371.36 m | ok |
| `loop-two-loose-branches` | 1259916 B | 3057 | 3800 | 3 | 371.36 m | ok |
| `loop-with-branch-30` | 1150612 B | 1529 | 2478 | 3 | 360.00 m | ok |
| `loop-with-branch-30-spline` | 1228252 B | 2596 | 3270 | 3 | 371.36 m | ok |
| `loop-with-branch-45` | 1154644 B | 1592 | 2586 | 3 | 360.00 m | ok |
| `loop-with-branch-45-spline` | 1229340 B | 2612 | 3288 | 3 | 371.36 m | ok |
| `loop-with-branch-90` | 1154644 B | 1592 | 2586 | 3 | 360.00 m | ok |
| `loop-with-branch-90-spline` | 1232412 B | 2659 | 3356 | 3 | 371.36 m | ok |
| `loop-with-branch-90-spline-terrain` | 1315172 B | 3814 | 4048 | 3 | 371.36 m | ok |
| `loop-with-branch-90-spline-terrain-follow` | 1315176 B | 3814 | 4048 | 3 | 371.36 m | ok |
| `venue-loop-spur-junction` | 1516492 B | 7245 | 4431 | 5 | 444.37 m | ok |
| `venue-two-loops-spur` | 1844488 B | 12337 | 7876 | 5 | 813.65 m | ok |
| `venue-walls-props` | 4762560 B | 71325 | 34113 | 6 | 371.36 m | ok |
| `venue-wrapped-kerb` | 1417096 B | 5611 | 3485 | 5 | 313.85 m | ok |

The `.sima` sizes include the procedural textures, outline extras, and the racing-line ribbon. Every bundle now contains one extra material, texture, and draw call for `racing_line`; collision totals are unchanged from `@3`. The venue length is the sum of all section lengths. Kerb fixtures add two surfaces and a separate kerb graph; wall/prop fixtures add the `wall` surface, prop visual nodes, and optional `col_prop` collision. Ground node names and spawn/collision rules are unchanged from `@1`. The two-loop venue has two disjoint spline loops plus a dead-ended open spur; the junction venue has a closed loop with an open spur attached at an interior control point.

The fixture matrix is enforced by `src/kernel/fixture-matrix.test.ts`; venue export determinism and manifest length are covered in `src/export/lapster/export.test.ts`.

## Racing line conformance (`@4`)

The visual racing line is generated per section, clamped inside the authored asphalt width, lifted `0.02 m`, and exported as a separate `racing_line` node. It is included in `visual.include` and excluded from `collision.include`; manifest `surfaces` and collision totals are unchanged.

| Fixture | Visual meshes | Vertices | Triangles | Materials | Textures | Draw calls | Collision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `loop` | 4 | 1351 | 2210 | 4 | 4 | 4 | 84 verts / 50 tris |
| `venue-two-loops-spur` | 6 | 12337 | 7876 | 6 | 6 | 6 | 9460 verts / 2980 tris |

Both bundles compile, inspect as `Track`, and validate `ok`. The loop bundle reports `bounds.max.y = 0.02` for the line lift. The follow-mode fixtures keep the line on the sampled terrain height source.

## G5 viewer checks

- All 19 bundles loaded in `web/track-viewer/?track=<bundle>.sima`, reached `ready`, and reported the expected `(Track)` asset, surfaces, spawn, and collision-triangle count with zero page errors. The only console output was the existing `sim_render` deprecation warning and the headless `No available adapters` warning.
- All 19 bundles loaded in `web/drive/?track=<bundle>.sima` with the `mazda-rx7` car. Every fixture spawned with `contacts 4/4` on `asphalt`, and holding throttle for 1.5 s produced roughly 20–24 km/h from rest. The two `follow` fixtures started at about 9 km/h on their initial slope.
- `venue-walls-props` rendered all 12 meshes and textures in the track viewer at 60.0 FPS. Walls, tyres, blocks, trees, and the racing line are visible.
- track-ed preview held 60.8 FPS on the default spline-terrain-junction project. In-page export compute (excluding browser download handling) had a 19.1 ms median over five runs, range 15.8–35.0 ms.

## G5 performance summary

Median of five in-process runs on Node 26.13.1 with `performance.now()`; export includes its validation pass. These timings predate the racing-line overlay; the current `@4` bundles add one visual mesh and its line generation.

| Fixture | Bake | Validate | Export bundle |
| --- | ---: | ---: | ---: |
| `loop` | 0.10 ms | 0.84 ms | 1.27 ms |
| `loop-spline` | 0.76 ms | 17.6 ms | 18.0 ms |
| `loop-with-branch-90-spline` | 164.8 ms | 23.8 ms | 24.2 ms |
| `loop-spline-terrain` | 2.28 ms | 42.2 ms | 41.9 ms |
| `venue-two-loops-spur` | 354.5 ms | 190.8 ms | 190.8 ms |
| `venue-walls-props` | 94.6 ms | 49.2 ms | 69.0 ms |
| `venue-wrapped-kerb` | 524.0 ms | 66.5 ms | 66.8 ms |

All fixtures stay below the 2 s export budget. The heaviest bake is the wrapped-kerb fixture at 524 ms; the heaviest export is the two-loop venue at 191 ms.

## Decision

- v0 conformance passes; v1-G1 splines, v1-G2 terrain, v1-G3 kerbs, v1-G4 walls/props, the visual racing line, and v1-G5 re-conformance pass.
- Outcome: **promote track-ed to production**.
- Banking/crown is deferred as a post-promotion follow-up; it is not part of the promotion gate.
- A direct live iteration-time trial against the current Lapster builder remains a follow-up user check. Track-ed's measured bake/validate/export and preview numbers are comfortably within budget.

## Post-promotion follow-ups

- Banking and crown.
- A7 current-builder iteration-time trial using a defined open → move one point → rebuild → export → load workflow.
- Extend curve-shape fixture coverage as new spline shapes are authored.
