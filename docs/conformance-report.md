# Conformance report — `lapster-glb-track@1`

Status: conformance passed. Outcome: continue the spike; do not promote to production yet.
Date: 2026-11-16 (Slice 4 full-fixture rerun).

## Environment

- track-ed: working tree, v1 implementation.
- Lapster: local checkout at branch `feat/junction-road-geometry`, commit `20547ab` (set `$LAPSTER_DIR` or use your clone path).
- Export path: browser download from the track-ed app.
- Compiler: `cargo run -p asset-compiler -- bake-glb-track`, then `inspect` and `validate`.
- Viewer: `python3 -m http.server 8123 --bind 127.0.0.1` from the Lapster root.

The compiler emits a benign Cargo warning about `workspace.package.rust-version`; it is unrelated to track-ed.

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

The `project@3` venue fixture with two disjoint closed sections and a dead-ended open spur passed: 128844 B `.sima`, 1728 vertices, 1146 triangles, `Two Loops and Spur (Track)`, `validate ok`.

The `project@3` junction fixture with a closed loop and an open spur attached at an interior loop control point passed: 67536 B `.sima`, 891 vertices, 588 triangles, `Loop and Spur Junction (Track)`, `validate ok`.

## Slice 4 full-fixture rerun

All 17 checked-in project fixtures were parsed, baked, validated in-process, exported to `track.glb` + `track.json`, and compiled with the Lapster debug binary. Every fixture produced `inspect` output ending in `(Track)` and `validate` output `ok`.

| Fixture | `.sima` | Vertices | Triangles | Length | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| `loop` | 8260 B | 84 | 50 | 360 m | ok |
| `loop-spline` | 66380 B | 876 | 578 | 371.36 m | ok |
| `loop-spline-terrain` | 129100 B | 1758 | 1090 | 371.36 m | ok |
| `loop-spline-terrain-follow` | 129108 B | 1758 | 1090 | 371.36 m | ok |
| `loop-spline-terrain-junctions` | 67668 B | 894 | 590 | 371.36 m | ok |
| `loop-spline-terrain-points` | 67668 B | 894 | 590 | 371.36 m | ok |
| `loop-two-loose-branches` | 100044 B | 1335 | 884 | 371.36 m | ok |
| `loop-with-branch-30` | 10068 B | 108 | 66 | 360 m | ok |
| `loop-with-branch-30-spline` | 82716 B | 1098 | 726 | 371.36 m | ok |
| `loop-with-branch-45` | 10068 B | 108 | 66 | 360 m | ok |
| `loop-with-branch-45-spline` | 83356 B | 1107 | 732 | 371.36 m | ok |
| `loop-with-branch-90` | 10068 B | 108 | 66 | 360 m | ok |
| `loop-with-branch-90-spline` | 84188 B | 1119 | 740 | 371.36 m | ok |
| `loop-with-branch-90-spline-terrain` | 166948 B | 2274 | 1432 | 371.36 m | ok |
| `loop-with-branch-90-spline-terrain-follow` | 166952 B | 2274 | 1432 | 371.36 m | ok |
| `venue-loop-spur-junction` | 67536 B | 891 | 588 | 444.37 m | ok |
| `venue-two-loops-spur` | 128844 B | 1728 | 1146 | 813.65 m | ok |

The venue length is the sum of all section lengths. The two-loop venue has two disjoint spline loops plus a dead-ended open spur; the junction venue has a closed loop with an open spur attached at an interior control point.

The fixture matrix is enforced by `src/kernel/fixture-matrix.test.ts`; venue export determinism and manifest length are covered in `src/export/lapster/export.test.ts`.

## Viewer checks

- `web/track-viewer/?track=<bundle>.sima` loaded the loop and 90° branch bundles with no console errors.
- The loop viewer reported `loop (Track)`, 84 vertices, 50 triangles, 3 materials, 50 collision triangles, 3 draw calls.
- The loop viewer exposed `surface_asphalt`, `surface_dirt`, and `surface_grass` meshes with the expected surface ids and friction values.
- `web/drive/?track=../track-viewer/<bundle>.sima` loaded the loop bundle with no console errors.
- The car spawned on the track and moved under throttle in the drive viewer.
- A full lap was not timed or recorded in this run.

## Decision

- v0 conformance passes.
- Outcome: **continue the spike**.
- Production promotion is deferred until the v1 gates in `docs/v1-roadmap.md` pass: rounded spline centrelines, terrain, kerbs, props, re-conformance, performance, and comparison.

## Remaining baseline work

- A6 is measured in `docs/performance-baseline.md`; preview holds ~60 fps and export work is <5 ms on the fixtures.
- A7 still needs a defined current-builder iteration-time workflow; the feature comparison is recorded in `docs/performance-baseline.md`.
- Optionally repeat the drive check for 30°/45°/90° branch bundles.
