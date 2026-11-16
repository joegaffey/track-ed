# v1 roadmap — production promotion gates

Status: G1, G2a, G2b, G2c1, G2c4, the `project@2` multi-junction graph, the `project@3` venue section graph, and G3 kerbs are implemented; road elevation, banking/crown, and props remain. v0 remains a spike until these gates pass.
Date: 2026-11-16.

## Decision

track-ed has passed the v0 Lapster conformance run, but it is **not promoted to production**. The current Lapster builder remains the production path until track-ed can handle:

1. spline centrelines with rounded corners;
2. terrain elevation and road-to-terrain integration;
3. kerbs;
4. props.

The M4 outcome is **continue the spike**, not replace the production editor.

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

- Kerbs mode with dashed guide rails: drag to paint spans, select spans, and drag endpoint handles to resize. Seam-wrapping spans are supported through forward `start + length` arcs.
- Red/white kerb runs follow road edges, rounded corners, and junction approaches with equal-length jagged elements: flat approach, one raised corner, then a riser.
- Flat and corner heights are authorable globally and per span.
- A separate consumer-neutral `kerbGraph` preserves the welded ground invariants. Spans are clipped against junction asphalt and other kerbs; exposed ends are capped.
- Kerbs sample the same ground/terrain height source as the road and shoulder.
- `lapster-glb-track@2` emits `surface_kerb_red` and `surface_kerb_white` with solid collision on all faces.
- Verified with the Lapster asset compiler: the two kerb fixtures bake, inspect as `Track`, and validate `ok`.

### G4 — Props

- Define a consumer-neutral placement model: type/id, position, rotation, scale, and collision policy.
- Add authoring, selection, duplication, and deletion.
- Define export node/material conventions and confirm Lapster importer support.
- Treat props as optional scene decoration; they must not alter the road surface graph.

### G5 — Re-conformance, performance, and comparison

- Rerun Lapster `asset-compiler` bake/inspect/validate for all fixtures.
- Load in track and drive viewers; confirm spawn, driving, and collision.
- Measure preview FPS and export time.
- Update the comparison report against the current Lapster builder.
- Record a production-promotion or kill decision.

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

- Routes, route-based length, sectors, multiple layouts.
- Pit lanes and pit boxes.
- Persisted per-section locks. Design only; see `docs/venue-model-plan.md`.
- Textures and material libraries beyond flat base colours.
- Direct `.sima` export and CLI/headless export.
- Additional consumers and interchange formats across sims.
- Generative authoring, collaboration, and gameplay runtime.
