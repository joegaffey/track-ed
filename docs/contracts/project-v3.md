# Contract — `track-ed/project@3`

Status: legacy. `project@3` remains supported for import and is converted to `project@4` on load. New authoring writes `project@4`; routes remain deferred.

## Purpose

`track-ed/project@3` models a venue as a collection of road sections. A section may be open or closed, and dead-ended open sections are valid. No section has a special “main” role.

The executable schema is `schemas/project-v3.schema.json`.

## Shape

```json
{
  "schema": "track-ed/project@3",
  "name": "Two Loops and Spur",
  "generator": "track-ed v1",
  "road": { "halfWidth": 5, "shoulderHalfWidth": 8 },
  "terrain": { "margin": 30, "mode": "conform" },
  "spawn": { "centerline": "spur", "fraction": 0.2, "lateral": 0 },
  "cameras": [],
  "sections": [
    {
      "id": "loop-a",
      "closed": true,
      "points": [
        { "id": "a0", "position": [0, 0] },
        { "id": "a1", "position": [80, 0] },
        { "id": "a2", "position": [110, 40] }
      ],
      "spline": { "type": "catmull-rom", "samplesPerSegment": 12 }
    }
  ]
}
```

Road, terrain, spawn, and camera fields follow `track-ed/project@2`.

Global kerb profile heights are optional:

```json
"kerbs": { "flatHeight": 0.06, "cornerHeight": 0.155 }
```

Sections may author kerb spans:

```json
{
  "id": "loop-a",
  "closed": true,
  "kerbs": [
    { "side": "left", "start": 0.05, "length": 0.3 },
    {
      "side": "right",
      "start": 0.9,
      "length": 0.2,
      "flatHeight": 0.08,
      "cornerHeight": 0.12
    }
  ]
}
```

Kerb spans are forward arcs in section-local arc-length fractions. `start` is the entry fraction and `length` is the forward arc length. `left` and `right` are relative to increasing section parameterisation.

- On an open section, `start + length` MUST be at most 1.
- On a closed section, the arc wraps through the seam when `start + length > 1`; no separate wrap flag is stored.
- A span on a closed section MUST be shorter than the full loop. Use two spans if a full loop is required.
- Spans on the same side MUST NOT overlap. Wrapped intervals are compared on the circle.

Kerb geometry runs continuously to the authored span ends. Kerbs from adjacent sections may overlap each other and junction asphalt at a shared junction.

Each contiguous kerb run is divided into equal-length red/white elements. Every element starts flat at `flatHeight` and rises along the direction of travel to a single raised corner at `cornerHeight`, then drops at a forward-facing riser before the next element. A span may override `flatHeight` and/or `cornerHeight`; otherwise the global profile applies. The effective `cornerHeight` MUST be greater than the effective `flatHeight`.

Junctions connect section control points:

```json
"junctions": [
  {
    "id": "junction-1",
    "members": [
      { "section": "loop", "point": "a1" },
      { "section": "spur", "point": "s0" }
    ],
    "anchor": { "section": "loop", "point": "a1" }
  }
]
```

## Semantic rules

- `sections` MUST contain at least one section.
- A section MUST be open or closed independently; there is no main-loop requirement.
- Multiple closed sections are allowed.
- Open sections MAY have zero, one, or two loose ends.
- Open sections MUST NOT require an attachment.
- Section point ids MUST be unique within a section.
- Closed sections MUST have at least three points and enclose non-zero area.
- Open sections MUST have at least two points.
- Sections MUST NOT self-intersect.
- `spawn.centerline` MUST reference a section id.
- Export length is the sum of all section lengths while routes are absent.
- `attach` and `endAttach` are not part of `project@3`.
- A junction MUST have at least two members.
- Every junction member MUST reference an existing section point.
- A junction member may be an endpoint or an interior control point of an open or closed section.
- The `anchor` MUST be one of the junction members; the first member is the anchor when omitted.
- All members snap to the anchor position before baking.
- A section point may belong to at most one junction.
- A junction cannot contain two points from the same section.
- Multiple sections may share a junction.
- Disconnected sections MUST NOT intersect; intersections are allowed only at shared junctions.
- Loose ends may remain disconnected.
- App authoring supports adding an independent section, adding a joined section/junction, joining a loose end to any control point, merging loose ends, closing an open section into a loop, detaching junctions, and splitting any section.
- The section list reports each section independently of junctions, including open/closed state, control-point count, junction membership, and loose ends.
- Open sections are capped at every loose end.
- Splitting a closed section produces one open section with two capped ends.
- Splitting an open section produces two capped open sections with a gap between them.
- Removing a junction drops each non-anchor endpoint control point, leaving a gap; the anchor section is unchanged.
- Splitting a closed loop prefers inserting two control points on the longer adjacent segment and retaining the selected point. If that cannot produce valid geometry, it falls back to simplified sampled control points while retaining the spline. The gap is one road width minimum and expands automatically where curvature would otherwise create invalid geometry.
- Dragging one loose end of an open section onto its other loose end closes it into a loop.
- Kerb spans are split, remapped, and side-flipped by section split/merge operations.
- Kerb width and nominal red/white element length are kernel constants in v1. Flat and corner heights are authorable globally and per span.
- Each contiguous kerb run is divided into equal-length red/white elements, so junction clipping cannot leave differently sized blocks in one run.

## Migration

`project@1` remains import-only. The app upgrades `project@2` and `project@3` projects to `project@4` on load and writes `project@4` on save. Existing `project@2` junction hosts and branch `attach`/`endAttach` references become junction members. Legacy `project@1` fraction attachments are not converted automatically: inserting a host control point at the sampled attachment would change the authored points, point ids, and spline shape. See D15 in `docs/decisions.md`.

## Deferred

- Route/lap objects and route-based length.
- Richer section metadata beyond id, open/closed state, point count, junction membership, and loose ends.
- Per-section lock flags. Design only; see `docs/venue-model-plan.md`.
