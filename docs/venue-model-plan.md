# Venue section graph — implementation plan

Status: in progress. Slices 1 and 2 (`project@3` sections, multiple loops, dead-ended opens, general junction members, open-section junctions, and multi-way junctions) are implemented in the kernel and validated against Lapster; app authoring, routes, and loop splitting remain.

## Goal

Replace the current “one closed main loop plus branches” model with a venue model:

- A venue is a collection of road sections.
- A section may be open or closed.
- Dead-ended open sections are valid.
- No section has a special “main” role.
- Junctions connect control points on any sections.
- Routes/laps are deferred; the venue is geometry, not a race route.

## Settled decisions

- Dead-ended open sections are allowed.
- No section is privileged.
- An open end may connect to any control point on any other section.
- The target control point is the junction anchor; the open end snaps to it.
- If the target point already belongs to a junction, the open end joins that junction.
- Dropping one loose end onto another loose end merges them into one open section, rather than creating a junction.
- Self-connections and self-junctions are rejected for now.
- Splitting a closed loop produces one open section with a small gap.
- The split gap is one road width, centred on the split point. With the current 5 m half-width that is 10 m total, 5 m either side.
- Export length is the sum of all section lengths while routes are absent. When routes exist, length is the sum of route lengths.
- Routes/laps are not part of this implementation slice.

## Target model

Proposed `track-ed/project@3`:

```text
sections: [
  {
    id,
    closed,
    points: [{ id, position }],
    spline?
  }
]

junctions: [
  {
    id,
    members: [{ section, point }],
    anchor?: { section, point }
  }
]
```

Rules:

- No `attach` or `endAttach`; connectivity lives in junctions.
- The explicit anchor, or the first member when no anchor is declared, is authoritative for position.
- All other members snap to the anchor.
- A section point belongs to at most one junction.
- A junction may have two or more members, including multi-way junctions.
- Closed sections may have junctions at any control point.
- Open sections may have junctions at endpoints or interior control points.
- An open section may have zero, one, or two loose ends.
- A section may be disconnected from every other section.

## Geometry and kernel changes

- Replace `main + branches` baking with all-section baking.
- Generate a closed annulus for a closed section and a ribbon for an open section.
- Determine end treatment from junction membership:
  - junction-connected end: normal cap;
  - loose end: extended shoulder cap.
- Snap all junction members to the anchor before generating ribbons.
- Union every section’s asphalt and shoulder footprint, then derive dirt and grass as today.
- Replace “branch crosses the main loop” checks with pairwise section crossing checks, excluding shared junction contacts.
- Preserve point-based TIN terrain and the shared surface graph.
- Remove the main-loop length source; use the settled length rule.
- Spawn references an explicit section and fraction; no main fallback.

## App and authoring changes

- Remove `mainOf()` and all main-loop assumptions.
- Distinguish “add section” from “add junction”.
- Allow junction creation on any section control point.
- Allow an open end to target any other section control point.
- Keep loose-end-to-loose-end merging as a section merge.
- Removing a junction detaches its members and leaves every section alive.
- Add closed-loop split:
  - open the selected loop;
  - create one open section;
  - offset the two endpoints by half a road width along the local tangent;
  - preserve deterministic point ids and undo.
- Spawn may target any section.
- Show sections independently of junctions in authoring UI.

## Compatibility and migration

- The app writes `project@3`.
- `project@1` and `project@2` remain import-only.
- Convert old `centerlines` to `sections`.
- Convert old junction hosts and `attach`/`endAttach` references to junction members.
- Legacy `project@1` fraction attachments need an explicit conversion decision:
  - insert a host control point at the sampled attachment position, or
  - keep them import-only with documented geometry preservation limits.
- Keep current fixtures passing through migration.

## Delivery slices

### Slice 1 — Foundation and non-junction venues

Estimate: 2–3 focused days.

- Add `project@3` types, schema, parser, and migration.
- Support multiple closed sections and dead-ended open sections.
- Remove the one-closed-section restriction and main-loop bake requirement.
- Implement sum-of-sections length.
- Add fixtures and kernel tests for multiple loops and dead ends.
- Keep export valid.

### Slice 2 — General junctions

Estimate: 4–5 focused days.

- Add junction members and anchor snapping.
- Support junctions on closed and open sections, including interior points.
- Support multi-way junctions.
- Allow open ends to connect to any other section control point.
- Generalize crossing validation.
- Add kernel and fixture coverage for T-junctions, open/open junctions, and multi-way junctions.

### Slice 3 — Authoring operations

Estimate: 3–4 focused days.

- Remove app main-loop assumptions.
- Add section/junction authoring on any control point.
- Keep loose-end merge behavior.
- Change junction removal to detach rather than delete sections.
- Add one-road-width closed-loop split.
- Allow spawn on any section.
- Add app-level tests and browser verification.

### Slice 4 — Conformance and polish

Estimate: 2–3 focused days.

- Run all legacy and new fixtures through bake/validate.
- Export a venue with multiple loops and dead ends to the Lapster profile.
- Re-run Lapster `bake-glb-track`, `inspect`, and `validate`.
- Check performance of pairwise crossing validation.
- Update contracts, decisions, README, and roadmap.
- Record any follow-up route/lap work.

## Acceptance criteria

- A venue with two disjoint closed loops bakes and exports successfully.
- A venue with a dead-ended open section bakes successfully.
- An open end can attach to a closed section, an open section endpoint, an open section interior point, or an existing junction.
- Multiple sections can share one junction.
- Removing a junction leaves its sections as valid dead ends.
- Splitting a closed loop produces one open section with a one-road-width gap.
- Export length is the sum of section lengths when no routes exist.
- `project@1` and `project@2` fixtures still import and validate under the documented migration.
- Lapster conformance still passes for a representative venue.

## Risks

- Pairwise crossing checks may become slow on large venues; start simple, optimize later.
- Open-section T-junctions need careful shoulder-cap and union handling.
- Splitting a spline loop at a gap changes local curvature; validate and document.
- Legacy fraction attachments may not migrate without inserting a host point.
- Multi-way junction anchor choice must remain deterministic.
- Removing `main` touches validation, baking, app editing, spawn, length, and tests, so partial migrations can leave inconsistent behavior.

## Explicitly deferred

- Route/lap objects and route-based length.
- Race sectors, checkpoints, and start/finish logic.
- Multiple layouts or runtime section switching.
- Blank-sheet authoring.
- Kerbs and props.
