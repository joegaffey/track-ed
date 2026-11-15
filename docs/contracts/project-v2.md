# Contract — `track-ed/project@2`

Status: normative for junction graphs. `track-ed/project@1` remains the legacy flat-fraction format.

## Purpose

`track-ed/project@2` adds stable control-point ids and shared junction nodes so multiple branches and multi-way junctions can be authored without sliding fractions.

The executable schema is `schemas/project-v2.schema.json`.

## Shape

```json
{
  "schema": "track-ed/project@2",
  "centerlines": [
    {
      "id": "main",
      "closed": true,
      "points": [
        { "id": "p0", "position": [0, 0] },
        { "id": "p1", "position": [80, 0] }
      ],
      "spline": { "type": "catmull-rom", "samplesPerSegment": 12 }
    },
    {
      "id": "branch-1",
      "closed": false,
      "attach": { "junction": "junction-1" },
      "points": [
        { "id": "p1", "position": [80, 0] },
        { "id": "branch-1-p1", "position": [96, -28] },
        { "id": "branch-1-p2", "position": [112, -56] }
      ]
    }
  ],
  "junctions": [
    { "id": "junction-1", "centerline": "main", "point": "p1" }
  ]
}
```

Road, terrain, spawn, and camera fields follow `track-ed/project@1`.

## Semantic rules

- There MUST be exactly one closed centreline in v1.
- Multiple open centrelines are allowed.
- Point ids MUST be unique within a centreline.
- Junction ids MUST be unique.
- A junction MUST reference a closed centreline and a point on that centreline.
- Only one junction may exist at a given host centreline point.
- An open centreline MUST have `attach.junction` referencing an existing junction.
- The first point of a branch MUST have the same id as the host junction point, and the same position within `1e-6 m`.
- An open centreline MAY have `endAttach.junction`; its last point MUST have the same id/position as the end junction point.
- A branch MUST NOT reference the same junction at both ends.
- Multiple branches MAY reference the same junction.
- Joining two loose branch ends merges them into one open centreline; the join point is not a junction.
- Spawn fractions remain arc-length fractions along the sampled centreline.
- Unreferenced junction nodes are permitted but SHOULD be removed.
- Unknown fields MUST be rejected.

## Versions

- `track-ed/project@1` remains the legacy format with array points and `attach.to` + `attach.fraction`.
- `track-ed/project@2` is the junction-graph format used by the app.
- `BakedTrack` and the Lapster profile are unchanged.
