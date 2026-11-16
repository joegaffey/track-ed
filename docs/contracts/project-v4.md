# Contract — `track-ed/project@4`

Status: implemented. `@4` adds section-local walls and spline-following prop runs to the `project@3` venue-section model.

## Purpose

`track-ed/project@4` is the current authoring format. It keeps the open/closed venue-section graph from `project@3` and adds:

- continuous roadside walls;
- tree, tyre, and block prop runs along section splines.

The executable schema is `schemas/project-v4.schema.json`.

## Shape

`road`, `terrain`, `spawn`, `cameras`, `sections`, `junctions`, `kerbs`, and their semantic rules are unchanged from `project@3`.

Sections may author wall spans:

```json
{
  "id": "loop",
  "closed": true,
  "points": [],
  "walls": [
    { "side": "left", "start": 0.2, "length": 0.25 },
    {
      "side": "right",
      "start": 0.6,
      "length": 0.2,
      "height": 1.2,
      "offset": 1.1
    }
  ]
}
```

Sections may author prop runs:

```json
{
  "id": "loop",
  "closed": true,
  "points": [],
  "props": [
    {
      "kind": "tree",
      "side": "left",
      "start": 0.1,
      "length": 0.25,
      "offset": 4.5,
      "spacing": 4.5
    },
    {
      "kind": "tyre",
      "side": "right",
      "start": 0.4,
      "length": 0.15,
      "spacing": 0.8
    }
  ]
}
```

## Wall rules

- Wall spans are forward section-local arcs, exactly like kerbs: `start` is the entry fraction and `length` is the forward arc length.
- On an open section, `start + length` MUST be at most 1.
- On a closed section, the arc wraps through the seam when `start + length > 1`. A span MUST be shorter than the full loop.
- Spans on the same side MUST NOT overlap. Wrapped intervals are compared on the circle.
- `height` is optional and MUST be positive. The default is `1.0 m`.
- `offset` is optional and MUST be non-negative. It is the distance in metres from the asphalt edge to the wall's inner face. The default is `0 m`, so the inner face sits on the tarmac edge.
- Wall thickness is a kernel constant: `0.3 m`.
- Walls run continuously to their authored span ends. Exposed ends are capped.
- Walls from adjacent sections MAY overlap at shared junctions. No clipping, setback, or joiner is applied.
- Wall bases follow the same ground/terrain height source as the adjacent road and shoulder.
- Wall surfaces use the declared `wall` surface.

## Prop rules

- Prop runs are section-local forward arcs, exactly like kerbs and walls: `start` is the entry fraction and `length` is the forward arc length.
- On an open section, `start + length` MUST be at most 1.
- On a closed section, the arc wraps through the seam when `start + length > 1`. A run MUST be shorter than the full loop.
- `kind` MUST be one of `tree`, `tyre`, or `block`.
- `side` is `left` or `right` relative to increasing section parameterisation.
- `offset` is the optional distance in metres from the asphalt edge to the prop centreline. Defaults: tree `4.5 m`, tyre `0.8 m`, block `1.0 m`.
- `spacing` is the optional distance between instances in metres. Defaults: tree `4.5 m`, tyre `0.8 m`, block `2.4 m` (a 0.6 m gap between 1.8 m blocks).
- `collision` is optional: `solid` or `none`. When omitted, prop runs default to `solid`.
- The kernel expands each run into deterministic prop instances along the sampled section spline. Each instance gets deterministic lateral/longitudinal/yaw jitter; tree instances also get deterministic size variation. Instance rotation follows the spline tangent and instance height samples the active terrain source.
- Blocks and tyre stacks conform their mesh vertices to the terrain; trees use a terrain-sampled base and remain rigid, matching Lapster.
- Tree collision is the trunk only; tree canopies are visual-only.
- Prop runs are scene decoration and MUST NOT alter the welded ground surface graph.
- Baked prop ids and transforms are consumer-neutral. Export node/material names belong to the export profile.

## Semantic rules

All `project@3` semantic rules still apply. In addition:

- `sections[].walls` and `sections[].props` are only valid in `track-ed/project@4`.
- `project@3` files remain import-only for walls/props; they are converted to `project@4` on load.
- The app reads `project@1`–`project@4` and writes `project@4`.
- `project@1` remains import-only; `project@2` and `project@3` convert to `project@4`.
- Wall and prop authoring must preserve the existing ground, kerb, and junction invariants.

## Deferred

- Wall material variants, banking, and shaped profiles.
- Prop libraries, per-instance material overrides, and non-uniform scale.
- Additional prop kinds and per-instance variation controls.
- Dynamic or route-dependent props.
