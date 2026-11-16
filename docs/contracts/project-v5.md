# Contract — `track-ed/project@5`

Status: implemented. `@5` replaces separate kerb, wall, and prop arrays with section-local roadside splines.

## Purpose

A roadside spline is a persistent offset path along a section. It owns one or more ordered runs. Runs may be surface features (kerb, wall) or instance features (tree, tyre, block). Every section has two fixed kerb-edge splines: `kerb-left` and `kerb-right`.

The executable schema is `schemas/project-v5.schema.json`.

## Shape

```json
{
  "schema": "track-ed/project@5",
  "name": "Roadside demo",
  "generator": "track-ed v1",
  "road": { "halfWidth": 5, "shoulderHalfWidth": 8 },
  "terrain": { "margin": 30, "mode": "conform" },
  "spawn": { "centerline": "loop", "fraction": 0.1, "lateral": 0 },
  "sections": [
    {
      "id": "loop",
      "closed": true,
      "points": [],
      "roadside": [
        {
          "id": "loop:kerb-left",
          "role": "kerb-left",
          "side": "left",
          "offset": 5,
          "runs": [
            { "kind": "kerb", "start": 0.05, "length": 0.2 },
            { "kind": "wall", "start": 0.3, "length": 0.2, "height": 1.2 },
            {
              "kind": "tree",
              "start": 0.55,
              "length": 0.25,
              "outwardOffset": 7,
              "spacing": 4.5
            }
          ]
        },
        {
          "id": "left-16",
          "side": "left",
          "offset": 16,
          "runs": [
            { "kind": "tree", "start": 0.1, "length": 0.6, "spacing": 4.5 }
          ]
        }
      ]
    }
  ]
}
```

## Spline fields

- `id` — non-empty and unique within the section.
- `role?` — `kerb-left` or `kerb-right` for the two fixed edge splines.
- `side` — `left` or `right`; must match `role` when present.
- `offset` — distance in metres from the section centreline to the spline reference line. Fixed kerb splines use `road.halfWidth`; free splines may use any non-negative offset.
- `runs` — ordered runs; MAY be empty.

## Fixed kerb-edge splines

- Every section MUST have exactly one `kerb-left` and one `kerb-right` spline.
- Their offset is always `road.halfWidth`.
- They are not shown in the spline GUI and cannot be moved or deleted.
- They start empty.
- They may host any run type.
- The fixed splines are selected by clicking their 3D rail.

## Run fields

Common:

- `kind` — `kerb`, `wall`, `tree`, `tyre`, or `block`.
- `start` — forward section-local arc fraction in `[0, 1)`.
- `length` — forward arc fraction greater than zero.

Surface runs:

- kerb and wall geometry starts at the spline reference line and extends outward.

Instance runs:

- `outwardOffset?` — non-negative distance from the spline reference line to the instance centre.
- On fixed kerb splines, the defaults are: tree `7 m`, tyre `0.8 m`, block `4 m`.
- On free splines, the default is `0 m`.

Kerb:

- `flatHeight?` — non-negative.
- `cornerHeight?` — positive; effective corner height must exceed flat height.

Wall:

- `height?` — positive; default `1.0 m`.

Instances:

- `spacing?` — positive centre-to-centre spacing.
- `collision?` — `solid` or `none`; default `solid`.

## Semantic rules

- A section may have any number of roadside splines at different offsets.
- A spline may have runs of different kinds.
- Runs within one spline MUST NOT overlap. Wrapped intervals are compared on the circle.
- Different splines MAY overlap in `start/length`; offsets keep them separate.
- On an open section, `start + length` MUST be at most 1.
- On a closed section, a run wraps through the seam when `start + length > 1`; a single run MUST be shorter than the full loop.
- Kerbs and walls use the declared `kerb_*` and `wall` surfaces. Their profiles extend outward from the spline reference line.
- Kerbs on the same side are suppressed where a wall run overlaps them, even if the wall is on another spline.
- A wall on a fixed kerb spline starts exactly at the tarmac edge and extends outward.
- Tree, tyre, and block instances are expanded deterministically along the spline with terrain-sampled bases, spacing, jitter, and tangent-facing rotation.
- Blocks remain equal-sized and evenly spaced with a gap.
- Tree collision is trunk-only; canopies are visual-only.
- Props MUST NOT alter the welded ground surface graph.

## Defaults

- Fixed kerb spline offset: `road.halfWidth`.
- Free block spline offset: `9 m`.
- Free tyre spline offset: `5.8 m`.
- Free tree spline offset: `12 m`.
- Spacing: tree `4.5 m`, tyre `0.8 m`, block `2.4 m`.

## Migration

- `track-ed/project@1` remains import-only.
- `project@2` and `project@3` upgrade through the existing junction/section migration.
- Every section gets empty fixed `kerb-left` and `kerb-right` splines at `halfWidth`.
- `project@4` kerbs attach to the matching fixed spline.
- `project@4` walls become free splines at `halfWidth + oldOffset` (inner edge).
- `project@4` props become free splines at `halfWidth + oldOffset` (centre) with `outwardOffset = 0`.
- The app reads `@1–@5` and writes `@5`.

## Deferred

- Named spline presets and cross-section splines.
- Spline-level spacing/offset inheritance.
- Additional roadside feature kinds.
- Non-uniform prop scale and asset libraries.
