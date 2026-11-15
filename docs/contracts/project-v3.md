# Contract — `track-ed/project@3`

Status: implementation slice 1. Venue sections are implemented; general junctions and routes are not yet implemented.

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
- Disconnected sections MUST NOT intersect; connect them at a junction instead.
- `spawn.centerline` MUST reference a section id.
- Export length is the sum of all section lengths while routes are absent.
- A venue MAY have junctions in a later slice; slice 1 rejects `junctions`.
- `attach` and `endAttach` are not part of `project@3`.

## Migration

`project@1` and `project@2` remain import-only formats. The app writes `project@3` only when the current project is already `project@3`; legacy `project@2` projects continue to write `project@2` until the authoring migration is complete.

## Deferred

- Junction members and anchors.
- Open ends connecting to arbitrary control points.
- Route/lap objects and route-based length.
- Closed-loop splitting and section authoring UI.
