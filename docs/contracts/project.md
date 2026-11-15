# Contract — `track-ed/project@1`

Status: legacy authoring format. New junction graphs use `track-ed/project@2`; see `docs/contracts/project-v2.md`.

## Purpose

`track-ed/project@1` is the authoring format. It is self-contained JSON with no binary references and no consumer-specific fields.

The executable schema is `schemas/project.schema.json`. This document defines the semantic rules that JSON Schema cannot express.

## Coordinate and unit contract

- Units: metres, radians, seconds.
- Right-handed frame: `+Y` up, `-Z` forward, `+X` right.
- Points are `[x, z]` on the ground plane.
- v0 geometry is flat at `y = 0`.
- glTF front faces are CCW; flat road normals point `+Y`.

## Example

```json
{
  "schema": "track-ed/project@1",
  "name": "Untitled Loop",
  "generator": "track-ed 0.1.0",
  "road": {
    "halfWidth": 5.0,
    "shoulderHalfWidth": 8.0
  },
  "terrain": {
    "margin": 30.0
  },
  "centerlines": [
    {
      "id": "main",
      "closed": true,
      "points": [[0, 0], [60, 0], [80, 40], [40, 80], [-20, 60], [-30, 20]]
    },
    {
      "id": "branch-a",
      "closed": false,
      "attach": { "to": "main", "fraction": 0.35 },
      "points": [[-4.2, 18.0], [12, 18], [28, 18]]
    }
  ],
  "spawn": { "centerline": "main", "fraction": 0.0, "lateral": 0.0 },
  "cameras": []
}
```

## Fields

### Root

- `schema` — required, exactly `track-ed/project@1`.
- `name` — required, non-empty string.
- `generator` — required, non-empty string. Informational only; not part of deterministic geometry.
- `road` — required object; see below.
- `terrain` — required object; see below.
- `centerlines` — required array, one or two entries in v0.
- `spawn` — required object; see below.
- `cameras` — optional array; defaults to empty.

### `road`

- `halfWidth` — required, finite, greater than zero. Asphalt half-width in metres.
- `shoulderHalfWidth` — required, finite, greater than `halfWidth`. Outer dirt-shoulder half-width in metres.

### `terrain`

- `margin` — required, finite, greater than zero. Scene bounds are the axis-aligned bounds of the sampled centrelines expanded by this margin in metres.
- `mode` — optional, `"conform"` (default) or `"follow"`. `conform` makes the road the source of truth and cuts/fills terrain around it. `follow` makes the terrain heightfield the source of truth and drapes the road over it.
- `elevation` — optional terrain height source:
  - `amplitude` — required, finite, greater than zero. Peak positive/negative height in metres.
  - `wavelength` — required, finite, greater than zero. Height variation wavelength in metres.
  - `phase` — optional radians, default `0`.
  - `blend` — optional, greater than zero, default `20`. Embankment/blend distance from the road boundary in metres.
  - `gridSpacing` — optional, greater than zero, default `10`. Terrain grid spacing in metres.
- If `elevation` is absent, terrain is flat at `y = 0`.
- In `conform` mode, terrain vertices on the road/shoulder boundary are at road height and blend outward to the heightfield. In v1 the road is still flat at `y = 0`.

### `centerlines[]`

- `id` — required, non-empty, unique within the project.
- `closed` — required boolean.
- `points` — required array of `[x, z]` pairs. Closed centrelines need at least 3 distinct points; open centrelines need at least 2.
- `spline` — optional object; when present, `points` are control points for a sampled curved centreline.
- `attach` — required for open centrelines; forbidden for closed centrelines.

### `spline`

- `type` — required, exactly `"catmull-rom"`.
- `samplesPerSegment` — optional integer in `[2, 64]`, default `12`.
- When present, the control points define a deterministic centripetal Catmull-Rom curve. The sampled polyline is authoritative for geometry, length, spawn, attachment, and topology validation. Control points remain the authoring handles.
- Closed centrelines wrap the spline through the seam. Open centrelines extrapolate the endpoint tangents; the first and last control points are included exactly.
- The sampled polyline MUST not self-intersect.
- Polyline centrelines (no `spline`) retain the original piecewise-linear behaviour.

### `attach`

- `to` — required, must reference the closed centreline (`main`) in v0.
- `fraction` — required number in `[0, 1)`. Position along the host sampled centreline, measured by arc length.
- **Snapping.** The baker MUST sample the host centreline at `fraction` and replace the branch's `points[0]` with that exact sample. The authored `points[0]` is a hint, not authoritative.
- **Heading.** The branch tangent MUST be derived from the first non-degenerate branch segment after snapping. If snapping leaves no non-degenerate segment, or the resulting heading is ambiguous, the project MUST be rejected.

### `spawn`

- `centerline` — required, must reference an existing centreline.
- `fraction` — required number in `[0, 1)`, measured along the sampled centreline.
- `lateral` — optional number, default `0`. Signed offset within the asphalt band. Positive is to the right of the forward direction.

### `cameras[]`

- `name` — required, non-empty.
- `position` — required `[x, y, z]` in metres.
- `target` — required `[x, y, z]` in metres.
- `fovY` — required, finite, greater than zero, radians.

## Semantic rules

- Exactly one closed centreline is permitted in v0. It SHOULD be named `main`.
- At most one open centreline is permitted in v0. The schema enforces `maxItems: 2`.
- Centreline ids MUST be unique.
- Consecutive duplicate points and zero-length segments MUST be rejected.
- The main loop MUST NOT self-intersect. When `spline` is present, the sampled polyline is the main loop for this rule.
- A spline centreline is sampled deterministically before geometry, length, spawn, and attachment are computed.
- An attached branch MUST connect to the closed centreline at the exact host sample. `points[0]` SHOULD equal the host sample; the baker MUST snap it and derive the branch heading from the first non-degenerate segment after snapping. If no stable heading exists, the project MUST be rejected.
- The attached branch MUST NOT intersect the main loop except at the attachment.
- `spawn.centerline` MUST reference an existing centreline. v0 SHOULD use `main`.
- The project MUST NOT contain consumer-specific fields such as `.sima`, pack chunks, importer node names, game surface IDs, or game metadata.
- Unknown fields MUST be rejected.

## Versioning

- The `schema` string is the version. Breaking changes require a new version.
- v0 supports only `track-ed/project@1`.
- Migrations are explicit; no silent upgrades.

## Validation

1. Validate against `schemas/project.schema.json`.
2. Apply the semantic rules above.
3. Pass the validated project to the kernel.
4. Reject unknown fields and invalid references before baking.
