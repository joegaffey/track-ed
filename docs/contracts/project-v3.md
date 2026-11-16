# Contract — `track-ed/project@3`

Status: implemented. Venue sections, general junctions, app authoring, split/merge/detach flows, and Slice 4 conformance/polish are complete; routes remain deferred.

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

## Migration

`project@1` remains import-only. The app converts `project@2` projects to `project@3` on load and writes `project@3` on save. Existing `project@2` junction hosts and branch `attach`/`endAttach` references become junction members. Legacy `project@1` fraction attachments are not converted automatically: inserting a host control point at the sampled attachment would change the authored points, point ids, and spline shape. See D15 in `docs/decisions.md`.

## Deferred

- Route/lap objects and route-based length.
- Richer section metadata beyond id, open/closed state, point count, junction membership, and loose ends.
- Per-section lock flags. Design only; see `docs/venue-model-plan.md`.
