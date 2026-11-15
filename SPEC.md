# track-ed — Functional Specification v1.0

Status: v1 implementation in progress; M4 conformance passed. Scope: v0 spike plus v1 gates (splines, terrain/TIN, and `project@2` junctions). `project@3` venue sections are in progress.

## 1. Purpose

`track-ed` is a standalone browser editor for authoring simple track geometry, inspecting the baked result, and exporting a GLB plus a manifest. The v0 goal is to prove whether a clean-room three.js-based editor and geometry pipeline can produce acceptable closed-loop and junction geometry faster and more inspectably than the current in-engine builder.

The project model is track-ed's own. Lapster is the first consumer, not the definition of the tool. v0 ships one export profile, `lapster-glb-track@1`, which emits `track.glb` + `track.json` satisfying Lapster's `sim-track-glb-v1` importer. The `.sima` pack is produced downstream by Lapster's asset compiler.

## 2. Status

- M0 is implemented: the browser app bakes a closed loop into one welded surface graph, renders it, reports topology and invariants in the inspector, and downloads `track.glb` + `track.json`.
- M1 is implemented: one branch at 30°, 45°, or 90° bakes through a planar arrangement with a conforming triangulation, a capped branch end, and zero interior boundary edges, T-junctions, non-manifold edges, or overlaps.
- M2 is implemented: loop control points can be dragged, inserted, and deleted; one branch can be added, removed, and reattached; edits re-bake through the kernel with undo/redo and project JSON save/open.
- M3 is implemented: spawn centreline, fraction, and lateral offset are editable, the spawn arrow is draggable, and validation/export/undo/save-open polish is in place.
- M4 conformance has passed for the loop and the 30°/45°/90° branch fixtures against Lapster `feat/junction-road-geometry` at `20547ab`; see `docs/conformance-report.md`.
- M4 outcome: **continue the spike; do not promote to production yet**. Production promotion is deferred until the v1 gates in `docs/v1-roadmap.md` are met: spline centrelines with rounded corners, terrain, kerbs, and props.
- v1-G1 is implemented: optional deterministic centripetal Catmull-Rom centrelines with rounded corners, spline fixtures, sampled arc-length semantics, and app preview.
- v1-G2a is implemented: optional terrain elevation with cut/fill and embankments welded to the flat road, terrain controls, fixtures, and kernel tests.
- v1-G2b is implemented: `follow` mode drapes the road, shoulder, and terrain over the same heightfield while keeping seams welded.
- v1-G2c1 is implemented: terrain is authored by absolute point heights as a TIN, with click-add, vertical drag, numeric height, delete/clear, and undo/redo. Preview and GLB normals are computed from geometry.
- v1-G2c4 is implemented: road-follow mode now samples a global TIN built from the terrain points, so the road, shoulder, and terrain follow the same surface.
- `track-ed/project@3` is in progress: multiple closed sections, dead-ended open sections, multi-way junction members, and open-section junctions bake without a main loop. Routes and app authoring migration remain deferred.
- `track-ed/project@2` is implemented: shared junction nodes with stable point ids support multiple junctions and multi-way branches. Moving a shared junction point moves every connected branch. A loose branch end can be dragged onto a main-loop control point to join it (`endAttach`), and dragging a joined end pulls it free. Dragging one loose branch end onto another merges both branches into a single open centreline.
- v1-G3 kerbs are next. The v0 performance comparison remains useful baseline input for the v1 decision.

## 3. Scope

### 3.1 In scope for v0

- One closed main centreline.
- Zero or one open branch centreline attached to the main loop, forming a T/Y junction.
- Flat terrain (`y = 0`).
- One welded surface graph containing asphalt, dirt shoulder, and grass terrain.
- Browser preview, geometry inspection, validation, and browser download export.
- Deterministic output.

### 3.2 Out of scope for v0

- Multiple loops, multiple branches per junction, shared sections.
- Pit lanes, routes, sectors, multiple layouts.
- Elevation, terrain relief, water, sky.
- Kerbs, props, barriers, decorations, start gantries.
- Textures and advanced materials.
- Direct `.sima` export.
- CLI or headless export app.
- Game runtime, physics, audio, multiplayer.

## 4. Consumer and export-profile model

### 4.1 Principles

- The kernel and baked track model are consumer-agnostic.
- The GLB container and its mesh/accessor layout are standard glTF 2.0. The export profile owns consumer-specific node names, materials, manifest fields, and collision selection.
- Lapster is the first consumer; future consumers such as Assetto Corsa or rFactor 2 would be additional export profiles.
- v0 ships exactly one export profile.
- v0 does not add a plugin system, exporter registry, or generic exporter interface. Future profiles are separate modules.

### 4.2 Boundaries

```text
src/kernel/         consumer-neutral geometry
src/model/          BakedTrack contract
src/export/lapster/ lapster-glb-track@1 profile
src/app/            three.js editor and inspector
```

- `src/kernel/` and `src/model/` MUST NOT import `src/export/lapster/`, three.js, or Lapster code.
- `src/app/` MAY use three.js for rendering and interaction.
- `src/export/lapster/` is the only place where Lapster-specific terms, `.sima`, importer node names, and `sim-track-glb-v1` may appear.
- The v0 profile is a pure mapping from `BakedTrack` to `track.glb` + `track.json`.

## 5. Terms

- **Centreline**: ordered 2D control points in XZ that define the road path.
- **Road footprint**: the union of the asphalt and dirt-shoulder bands.
- **Surface graph**: positions, triangles, and per-triangle surface assignment.
- **Welded graph**: vertices at the same position within `1e-5 m` are treated as the same topological vertex for validation.
- **Scene bounds**: the axis-aligned rectangle derived from all centreline bounds expanded by `terrain.margin`.
- **Outer perimeter**: the boundary of the scene-bounds rectangle. It is the only permitted open boundary.
- **Baked track model**: consumer-neutral surface graph plus metadata produced by the kernel.
- **Export profile**: a mapping from the baked track model to a consumer-specific bundle.
- **Consumer**: a game or tool that imports an export profile.

## 6. Coordinate and unit contract

- Units: metres, radians, seconds.
- Right-handed frame: `+Y` up, `-Z` forward, `+X` right.
- Ground plane is XZ. v0 road surface is flat at `y = 0`.
- glTF front faces are CCW; flat road normals point `+Y`.
- Export uses `visual.scale = 1`, `yaw_degrees = 0`, `offset = [0, 0, 0]`; author directly in engine axes.

## 7. Authoring format

The authoring format is `track-ed/project@1`. The normative contract is `docs/contracts/project.md`; the executable schema is `schemas/project.schema.json`.

Summary:

- Exactly one closed centreline (`main`) in v0.
- Zero or one open attached branch.
- Constant asphalt and dirt-shoulder widths.
- A terrain margin that derives scene bounds.
- One spawn.
- Optional cameras.

The project format is strict: unknown fields MUST be rejected. It contains no consumer-specific fields.

## 8. Baked track model

The baked track model is `BakedTrack` v1. It is an in-memory contract, not a file format. The normative contract is `docs/contracts/baked-track.md`; the TypeScript reference is `src/model/baked-track.ts`.

The model contains:

- track name and main-loop length;
- bounds;
- one surface graph (positions, indices, per-triangle surface ids);
- surfaces (id, name, friction, roughness);
- spawns;
- cameras.

The model MUST be consumer-agnostic. It MUST NOT contain `.sima`, pack chunks, rkyv, importer node names, game surface IDs, or game-specific metadata. Quaternions are `xyzw`; positions are `[x, y, z]` in metres.

## 9. Export profile v0

The v0 export profile is `lapster-glb-track@1`. The normative contract is `docs/contracts/lapster-glb-track.md`; the manifest schema is `schemas/lapster-track-manifest.schema.json`.

The `track.glb` payload is standard glTF 2.0. The Lapster-specific parts are the `track.json` manifest, the `surface_*` node/material naming convention, surface metadata, spawn/collision rules, and the two-file bundle contract.

The profile emits exactly two files:

- `track.glb`;
- `track.json` satisfying `sim-track-glb-v1`.

All Lapster-specific naming, defaults, and metadata live in the profile. The profile MUST NOT alter geometry.

## 10. Geometry requirements

All requirements are normative.

- **G1 — Continuity.** The centreline is continuous. No duplicate consecutive points and no zero-length segments.
- **G2 — Bands.** Asphalt is centred on the centreline with constant width. Dirt shoulder lies outside asphalt with constant width. Grass terrain lies outside the shoulder.
- **G3 — One welded surface graph.** The exported ground and road form one non-overlapping surface graph. Terrain fills all non-road area within scene bounds, including the loop infield and outfield. There MUST NOT be a base plane under road surfaces. No two triangles may overlap in XZ.
- **G4 — Junction coverage.** At every branch attachment, exactly one road surface covers each point of the junction footprint. No overlaps, holes, or z-fighting.
- **G5 — Boundary stitching.** Where asphalt, dirt, and terrain regions meet, both sides of every shared boundary MUST reference the same ordered sequence of welded vertices (up to traversal direction), with no extra vertices on either side. Merely coincident positions within `1e-5 m` are not sufficient.
- **G6 — Hole-free topology.** After welding vertices within `1e-5 m`, every interior edge MUST have exactly two adjacent triangles. Boundary edges are permitted only on the outer perimeter.
- **G7 — No T-junctions.** After welding vertices within `1e-5 m`, no vertex may lie on the interior of another triangle's edge.
- **G8 — Collision coincidence.** Collision road surfaces MUST be geometrically identical to visual road surfaces.
- **G9 — Triangle validity.** No degenerate triangles (area `> 1e-8 m²`). Consistent winding. Flat-surface normals `+Y`.
- **G10 — Surface assignment.** Every triangle maps to exactly one declared surface/material.
- **G11 — Determinism.** The same validated project MUST produce byte-identical GLB and manifest across repeated exports.
- **G12 — Branch ends.** Open branch ends MUST be capped and integrated into the terrain surface. No open road edge.
- **G13 — Flat v0; elevation in v1.** v0 fixtures are flat at `y = 0`. v1 terrain and road-follow mode may elevate surfaces; connected road, shoulder, and terrain boundaries MUST share the same height.
- **G14 — Path validity.** Minimum turn radius SHOULD warn (default 6 m). Main-loop self-intersection MUST be rejected. Branch/host attachment is the only permitted crossing.
- **G15 — Bounds.** Scene bounds MUST cover the drivable area plus `terrain.margin`. The outer perimeter is the scene-bounds rectangle. Walls and outer-edge fall protection are out of scope.

Implementation hint, not a requirement: a uniform terrain grid clipped and welded to the road footprint is the easiest way to satisfy G3, G6, and G7. Polygon-with-holes terrain is allowed but harder to keep hole-free.

## 11. Geometry inspector

Because inspection is the spike's primary validation surface, the editor MUST provide:

- **I1** Wireframe/edge overlay toggle.
- **I2** Boundary-edge overlay with counts. Edges with `!= 2` adjacent triangles after welding are highlighted; outer-perimeter edges are shown separately.
- **I3** T-junction highlight.
- **I4** Degenerate-triangle and duplicate/overlapping-triangle report.
- **I5** Surface legend. Hover/click a triangle to report material, area, and triangle id.
- **I6** Collision overlay to compare collision and visual surfaces.
- **I7** Validation summary: boundary edge count, non-manifold edge count, degenerate count, overlap pairs, T-junction count, surface coverage status.
- **I8** Export is blocked while any MUST-level validation fails.

## 12. Functional flows

- **F1** New/open/save a project JSON.
- **F2** Edit the main loop: add, move, delete control points.
- **F3** Add/edit/remove one attached branch: attach fraction, control points, end cap.
- **F4** Set spawn: centreline, fraction, lateral offset.
- **F5** Preview: orbit camera, surface colours, wireframe, start marker.
- **F6** Inspect: use the geometry inspector.
- **F7** Export: browser download of `track.glb` + `track.json`.
- **F8** Validate: list violations; MUST failures block export.

## 13. Validation and export gate

- The project MUST be validated against `schemas/project.schema.json` and the cross-field rules in `docs/contracts/project.md`.
- The baked model MUST be validated against G3–G11 before export.
- The export button MUST be disabled while any MUST-level validation fails.
- Validation errors MUST identify the violated rule and the affected geometry where possible.
- The exporter MUST refuse to write output for an invalid model.

## 14. Acceptance criteria

- **A1** Loop fixture exports in-browser, bakes, loads in the Lapster track viewer; the car spawns and laps.
- **A2** Branch fixtures at 30°, 45°, and 90° export with no holes, overlaps, or z-fighting. The inspector reports zero interior boundary edges and zero T-junctions.
- **A3** `asset-compiler validate` passes; `inspect` reports `Track`.
- **A4** Kernel invariant tests for G3–G7 and G9–G11 pass in Vitest.
- **A5** Repeated browser exports produce byte-identical files.
- **A6** Preview holds 60 fps on fixtures; export completes in under 2 s.
- **A7** A short report compares geometry quality and iteration time against the current builder.

## 15. Non-functional requirements

- Browser: Chromium/Chrome, WebGL2 minimum.
- TypeScript strict; Node 22 or newer; Vite; Vitest.
- The geometry kernel MUST NOT import three.js. three.js is for preview and interaction only.
- No network access during authoring or export.
- Consumer-neutral modules must not import or reference the Lapster profile.
- Export-profile code is isolated so future profiles can be added without touching the kernel or inspector.
- Repo layout: `src/kernel/`, `src/model/`, `src/export/lapster/`, `src/app/`, `fixtures/`, `schemas/`, `docs/`, `scripts/`.
- Dual MIT/Apache-2.0.

## 16. Toolchain

See `docs/toolchain.md`.

- Node 22 or newer.
- TypeScript strict, pinned.
- Vite and Vitest, pinned.
- three.js pinned, preview and interaction only.
- Evaluate `earcut` and `polygon-clipping`/`clipper-lib` for planar geometry.
- Try three's `GLTFExporter` for GLB. If determinism fails, use `@gltf-transform/core` or a small writer.
- Pin three.js to a specific release.

## 17. Risks and mitigations

- **Two editors drift.** Mitigate with explicit ownership after the spike and a promotion/kill decision.
- **Clean-room rewrite never reaches parity.** Mitigate with a narrow v0 and a timebox. Do not expand scope during the spike.
- **Junction and terrain stitching remain hard.** Mitigate with a single welded-surface requirement, an inspector, and targeted fixtures at 30/45/90.
- **Lapster profile drifts from the importer.** Mitigate with a pinned manifest schema and a conformance run against Lapster's asset compiler.
- **three.js is treated as the geometry engine.** Mitigate with a pure kernel and no three.js imports outside `src/app/`.
- **GLB export is non-deterministic.** Mitigate by verifying byte-identical exports; switch exporters if needed.
- **Multi-consumer vision expands v0.** Mitigate by deferring AC/rFactor 2 and adding no generic plugin layer.

## 18. Assumptions to verify against Lapster

- The same GLB mesh is accepted for both visual and collision.
- Spawn quaternion convention and forward axis.
- `length` is display-only or physics-relevant.
- Node/material wildcard matching is case-insensitive and `*` works as expected.
- `mountable` is irrelevant for v0 surfaces.
- The importer ignores sectors, pit boxes, and multiple spawns.
- `.sima` is produced by Lapster's compiler, not by track-ed.
- The baked track model can be expressed without Lapster-specific fields.

## 19. Deferred future sections

These are documented only to bound v0. They MUST NOT introduce design hooks, placeholder interfaces, or unused abstractions in v0.

Terrain elevation and rounded spline centrelines are now implemented as v1 gates (G1, G2). Kerbs and props remain deferred **for v0** and are required for production promotion in v1. See `docs/v1-roadmap.md`.

- **Multiple loops and shared sections**: more than one closed centreline, route legs, and section sharing.
- **Multiple branches per junction**: N-way junctions and branch chains.
- **Pit lanes and pit boxes**: pit entry/exit paths, boxes, and metadata.
- **Elevation and terrain relief**: heightfields, slopes, and cut/fill.
- **Spline-resampled centrelines**: rounded corners and non-polyline centreline sampling.
- **Kerbs, props, barriers, decorations**: authored roadside geometry and collision policy.
- **Textures and material libraries**: beyond flat base colours.
- **Direct `.sima` export**: pack writing without the Lapster compiler.
- **CLI/headless export**: a non-browser bake path.
- **Multi-layout, routes, sectors**: multiple layouts over shared geometry.
- **Random/generative authoring and collaboration.**
- **Additional consumers**: AC, rFactor 2, and others. Each becomes a separate export profile. v0 adds no generic plugin layer or exporter abstraction.
- **Interchange formats across sims**: no shared game-format layer in v0; evaluate only when a second consumer is actually implemented.

## 20. Research brief

The independent research agent brief is `docs/research-brief.md`. It is free-rein and report-only.

## 21. Implementation milestones

- **M0 — Loop and inspector.** App shell, hardcoded loop, terrain bake, inspector overlays, browser export.
- **M1 — Junction.** One branch at 90°, then 45°/30°. Start from a planar arrangement rather than independent ribbons: define the branch attachment contract and corrected fixtures, snap the branch to the exact host sample, build and union the road/shoulder footprint rings with a robust clipper, triangulate every face against one shared vertex table, cap the branch end into the terrain, and weld/validate. The inspector must show zero interior boundary edges, zero overlaps, and zero T-junctions at all three angles, plus a junction area and boundary-provenance audit.
- **M2 — Authoring.** Main-loop point editing and branch authoring, with live re-bake, edit-error handling, undo/redo, and project JSON save/open.
- **M3 — Polish.** Spawn centreline/fraction/lateral authoring with a draggable marker, validation gate, and export UX.
- **M4 — Decision.** Conformance run, comparison report, continue or discard. Production promotion is deferred to the v1 gates in `docs/v1-roadmap.md`.
- **V1-G1 — Splines.** Deterministic rounded-centreline sampling with stable arc-length parameterization.
- **V1-G2 — Terrain.** Elevation and road/terrain integration with visual/collision consistency.
- **V1-G3 — Kerbs.** Corner and junction-aware kerb geometry with export mapping.
- **V1-G4 — Props.** Consumer-neutral prop placement and export mapping.
- **V1-G5 — Promotion.** Re-conformance, performance, comparison, and production decision.

Vitest kernel tests run throughout; they are not a separate app milestone.

## 22. Promotion and kill criteria

The v0 spike has three outcomes: kill, continue, or promote to production. Passing conformance alone is not production promotion.

Continue the spike when:

- v0 conformance passes;
- exports are deterministic;
- iteration time is competitive with the current builder;
- the remaining v1 gates are still credible and scoped.

Promote track-ed to production only when all of the following are true:

- M1 proves watertight loop and 30/45/90° junctions in the inspector;
- v0 conformance passes against the Lapster importer;
- exports are deterministic;
- iteration time is materially better than the current builder;
- **G1:** spline centrelines with rounded corners, stable arc-length parameterization, and safe offsets/junctions;
- **G2:** terrain elevation and road-to-terrain integration without holes, overlaps, or z-fighting;
- **G3:** kerbs across straights, corners, and junctions with surface/collision/export mapping;
- **G4:** props with a scoped placement model, collision policy, and Lapster importer support;
- **G5:** re-conformance, performance, and comparison pass after the v1 changes.

Kill the spike when:

- junction quality is not better than the current pipeline;
- iteration is not faster;
- the inspector cannot demonstrate a hole-free surface;
- the v1 gates cannot be scoped credibly;
- the scope repeatedly escapes v0/v1 bounds.

After promotion, decide explicitly which editor owns track authoring. Do not maintain two full editors indefinitely.

## 23. Contract ownership and versioning

- track-ed owns `track-ed/project@1` and `BakedTrack` v1.
- Lapster owns `sim-track-glb-v1`; track-ed pins its copy in `schemas/lapster-track-manifest.schema.json`.
- The v0 export profile is `lapster-glb-track@1`.
- v1 terrain, kerbs, and props are expected to require `BakedTrack` v2 and a project schema version bump.
- Changes to node names, materials, or manifest fields require a `lapster-glb-track@2` profile bump and a conformance run.
- Breaking changes to the project format or baked model require a version bump.
