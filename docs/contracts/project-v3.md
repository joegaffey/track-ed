# Contract — `track-ed/project@3`

Status: implementation slice 2. Venue sections and general junctions are implemented; routes and app authoring remain deferred.

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

## Migration

`project@1` and `project@2` remain import-only formats. The app writes `project@3` only when the current project is already `project@3`; legacy `project@2` projects continue to write `project@2` until the authoring migration is complete.

## Deferred

- App authoring for general junctions.
- Route/lap objects and route-based length.
- Closed-loop splitting and section authoring UI.
- Loose-to-loose authoring merge in `project@3`.
