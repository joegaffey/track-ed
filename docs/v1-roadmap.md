# v1 roadmap — production promotion gates

Status: G1, G2a, G2b, G2c1, G2c4, the `project@2` multi-junction graph, the `project@3` venue section graph, G3 kerbs, G4 walls/props, the visual racing line, and G5 re-conformance are implemented and passing. track-ed is **promoted to production**. Banking/crown and a direct builder iteration-time trial are post-promotion follow-ups.
Date: 2026-11-18 (v1-G5 decision).

## Decision

track-ed passed the v0 Lapster conformance run and the v1 gates:

1. spline centrelines with rounded corners;
2. terrain elevation and road-to-terrain integration;
3. kerbs;
4. walls and props;
5. full re-conformance, performance refresh, and comparison.

The M4 outcome was **continue the spike**. The v1-G5 outcome is **promote track-ed to production**. Banking/crown was deliberately deferred until after the promotion decision and is tracked as a post-promotion follow-up.

## Gates

### G1 — Spline centrelines with rounded corners (implemented)

Implemented: optional `catmull-rom` spline specs on centrelines, deterministic centripetal sampling, sampled arc-length semantics for length/spawn/attach, spline fixtures, app preview, and regression tests. The branch/junction road is spline-sampled as well. The app now shows spline examples only; polyline fixtures remain for kernel regression. Lapster conformance passed for `loop-spline` and the spline-sampled 30°/45°/90° branch fixtures. Curvature-aware offset/junction safety is covered by the existing validation and fixtures; extend the fixture set as more curve shapes are added.

- Add deterministic spline sampling (Catmull-Rom first; evaluate arc/clothoid variants if needed).
- Keep arc-length parameterization stable for spawn fractions, branch attachments, and length.
- Offset and junction construction must remain safe on curved geometry; no self-intersections or offset loops.
- Add rounded-corner fixtures and preview/inspector support.
- Update the project contract with explicit spline parameters and sampling rules.

### G2 — Terrain

Contract decision (D12): terrain has one source of truth per project.

- **G2a — `conform` (default) — implemented.** The road is authoritative. Optional `terrain.elevation` (`amplitude`, `wavelength`, `phase`, `blend`, `gridSpacing`) drives a heightfield; terrain is cut/filled and welded to the flat road/shoulder boundary. The app exposes terrain controls and terrain fixtures; kernel tests assert zero holes/overlaps/T-junctions and flat asphalt. Lapster conformance passed for `loop-spline-terrain` and `branch-90-spline-terrain`.
- **G2b — `follow` — implemented.** The terrain heightfield is authoritative. The road, shoulder, and terrain all sample the same raw heightfield, so seams stay welded while the road drapes over the terrain. Terrain is still clipped under the road. Grade/turn-radius warnings remain a polish item.
- Only one mode is active per project. Switching modes is explicit, deterministic, undoable, and never a live two-way coupling.
- Keep visual and collision surfaces coincident.
- Extend scene bounds and validation rules beyond the flat rectangle.
- Preserve flat terrain as a special case so existing fixtures remain valid.

### G3 — Kerbs (implemented)

- Roadside mode with dashed offset rails: select a spline, drag to paint runs, select runs, and drag endpoint handles to resize. Seam-wrapping spans are supported through forward `start + length` arcs.
- Red/white kerb runs follow road edges, rounded corners, and junction approaches with equal-length jagged elements: flat approach, one raised corner, then a riser.
- Flat and corner heights are authorable globally and per span.
- A separate consumer-neutral `kerbGraph` preserves the welded ground invariants. Spans run continuously to their authored ends and may overlap at junctions; exposed ends are capped.
- Kerbs sample the same ground/terrain height source as the road and shoulder.
- `lapster-glb-track@4` emits `surface_kerb_red` and `surface_kerb_white` with solid collision on all faces.
- Verified with the Lapster asset compiler: the two kerb fixtures bake, inspect as `Track`, and validate `ok`.

### G4 — Props and walls (implemented)

- `project@5` adds fixed left/right kerb-edge splines plus free section-local roadside splines with kerb, wall, tree, tyre, and block runs.
- Walls use the shared roadside-run path with forward `start + length` spans, fixed `0.3 m` thickness, default `1.0 m` height, and default `0 m` offset so the inner face sits on the tarmac edge.
- Walls bake into a separate `wallGraph` with the `wall` surface; exposed ends are capped and junction overlaps are intentional. Kerbs on the same side are suppressed under wall spans; walls may directly replace kerbs on the fixed kerb splines.
- Prop runs carry kind, side, forward `start + length`, offset, spacing, and collision. The kernel expands them into deterministic instances along the section spline with terrain-sampled base heights. Tree collision is trunk-only.
- The app keeps two fixed kerb-edge splines hidden, shows free splines minimally with id/slider/numeric offset, paints mixed run types, and edits run spacing/height in 3D. Exported props use Lapster-derived concrete barrier, blue/white tyre-stack, and conifer-tree geometry rather than track-ed placeholders.
- `lapster-glb-track@4` emits `surface_wall`, `prop_*` visuals, and a merged `col_prop` collision mesh using the `wall` material.
- Props and walls do not alter the welded ground graph.
- Verified with the Lapster asset compiler: walls/props bake, inspect as `Track`, validate `ok`, and render in the viewer and drive viewer.

### Racing line (implemented)

- Generates one deterministic, curvature-biased visual ribbon per section.
- Clamps the ribbon inside the authored asphalt width, samples the road/terrain height source, and lifts it above the asphalt.
- Does not change the welded ground, kerb, wall, or prop graphs and is excluded from collision.
- Preview has a racing-line overlay toggle.
- `lapster-glb-track@4` emits a visual-only `racing_line` node and material; routes remain deferred, so lines do not join across junctions.

### G5 — Re-conformance, performance, and comparison (implemented)

- Reran Lapster `asset-compiler` bake/inspect/validate for all 19 fixtures at Lapster `0b78c05`; every bundle inspected as `Track` and validated `ok`.
- Loaded all 19 in the track and drive viewers; every fixture spawned with four contact points on asphalt and accelerated under throttle.
- Measured ~60 FPS preview and export compute between 1.3 ms and 191 ms across the fixture set.
- Refreshed the comparison against the current Lapster builder; track-ed matches its feature set and adds multi-section venues, free roadside splines, textures, a per-section racing line, and deterministic export.
- Recorded the production-promotion decision.

Post-promotion follow-ups:

- Banking and crown.
- A7 current-builder iteration-time trial with a defined workflow.
- Wider curve-shape fixture coverage.

## Contract impact

These gates are expected to require:

- `BakedTrack` v2 for props;
- a project schema version bump for prop authoring fields;
- a further `lapster-glb-track` profile bump if node names, materials, or manifest fields change;
- updates to the project, baked-track, and Lapster profile contracts.

Consumer-neutral boundaries remain: no Lapster names or `.sima` concepts in `src/kernel/` or `src/model/`.

## Order

1. Spline centrelines and rounded corners.
2. Terrain integration.
3. Kerbs.
4. Props.
5. Re-conformance, performance, comparison, decision.

Terrain and kerbs depend on the final centreline representation, so splines come first. Props come last because they are the least coupled to the surface graph and the most consumer-specific.

## Risks

- Terrain-to-road stitching can reintroduce holes, T-junctions, and z-fighting.
- Offset and junction geometry become harder on curved centrelines.
- Kerbs at junctions can create tiny slivers and non-manifold edges.
- Props can expand into a general scene editor; keep them scoped.
- Contract/version churn can break the Lapster profile; conformance must run at each gate.

## Remaining deferred beyond v1

- Banking and crown (post-promotion follow-up).
- Routes, route-based length, sectors, multiple layouts.
- Pit lanes and pit boxes.
- Persisted per-section locks. Design only; see `docs/venue-model-plan.md`.
- Textures and material libraries beyond flat base colours.
- Direct `.sima` export and CLI/headless export.
- Additional consumers and interchange formats across sims.
- Generative authoring, collaboration, and gameplay runtime.
