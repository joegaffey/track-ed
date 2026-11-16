# Decision record

Status: accepted for the v0 spike. Revisit at M4.

## D1 — Standalone repository

`track-ed` is a separate repository, not a page inside Lapster.

Rationale: the core is intended to be consumer-agnostic, and the current in-engine editor is coupled to Lapster's venue graph, pack format, and renderer. A standalone repo gives the geometry pipeline a clean boundary and a smaller test surface.

Trade-off: another repository, CI, deploy, and contract to maintain. The v0 spike is timeboxed and has explicit promotion and kill criteria to avoid maintaining two full editors indefinitely.

## D2 — Lapster is the first consumer, not the definition

The kernel and `BakedTrack` model are consumer-neutral. v0 ships one export profile, `lapster-glb-track@1`.

Future consumers such as Assetto Corsa or rFactor 2 would be additional export profiles. v0 does not add a plugin system, exporter registry, or generic exporter interface.

Rationale: keeps the portable boundary real without over-abstracting before a second consumer exists.

## D3 — three.js for preview and interaction, not for geometry

three.js is the editor renderer and inspector. The geometry kernel is pure TypeScript and must not import three.js.

Rationale: three.js is excellent for browser rendering, picking, overlays, and GLB loading/export, but it is not a robust planar geometry engine. The hard work is clipping, triangulation, and watertight stitching; that belongs in a testable kernel.

Geometry libraries to evaluate: `earcut` for triangulation; `polygon-clipping` or `clipper-lib` for planar boolean/clipping. 3D CSG is not the first choice.

## D4 — One welded surface graph

The ground and road form one non-overlapping welded surface graph. Terrain fills the infield and outfield. There is no base plane under the road.

Rationale: makes holes, overlaps, and z-fighting directly inspectable and avoids hiding topology errors under a layered ground plane. It is also the right long-term shape for junction and terrain stitching.

Trade-off: terrain generation and junction stitching are harder than layered ribbons. A uniform terrain grid clipped and welded to the road footprint is the likely v0 approach.

## D5 — Browser export only

The editor exports `track.glb` + `track.json` via browser download. There is no track-ed CLI or headless export app in v0.

Rationale: this is an editor, and inspection is the point. A headless path adds a second entry point before the geometry is proven.

Kernel invariants are still unit-tested in Vitest; that is not a separate app.

## D6 — Narrow v0

v0 is one closed loop plus zero or one attached branch, flat terrain, and asphalt/dirt/grass only.

Deferred features are documented in `SPEC.md` with no design hooks.

Rationale: the junction and terrain bake is the risk. Holding scope is the best way to learn whether the approach wins.

## D7 — Single welded surface requires validation tooling

The editor must include a geometry inspector: wireframe, boundary-edge counts, T-junction highlight, overlap report, surface legend, and collision overlay.

Rationale: a visual proof of a hole-free surface is the primary acceptance signal. Without the inspector, the spike cannot answer its own question.

## D8 — Pinned toolchain

Node 22 or newer; TypeScript, Vite, Vitest, and three.js are pinned. three.js is pinned because its API churns.

`earcut` `3.2.4` (ISC) is pinned for kernel triangulation. It stays in `src/kernel/`; three.js remains preview-only.

## D9 — Deterministic GLB writer

The Lapster profile emits a standard glTF 2.0 GLB with a small deterministic writer rather than `three`'s `GLTFExporter`.

Rationale: the exporter is DOM-coupled and its output is harder to pin byte-for-byte. The profile needs only positions, normals, indices, and flat materials, so a small writer is simpler to test and keeps three.js out of the export path. The GLB container is standard; the profile owns the `surface_*` node/material convention and manifest. The writer emits one `surface_*` node and matching material per declared surface.

## D10 — M1 starts from a planar arrangement

M1 builds one planar arrangement of the main and branch footprints before triangulating. It does not add independent branch ribbons to the M0 band generator.

Rationale: the research report found that independent tessellation causes T-junction cracks, raw offsets self-intersect at sharp corners, and layered junction surfaces z-fight. The arrangement step snaps the branch to the host sample, offsets and unions the asphalt/shoulder rings with `polygon-clipping`, conforms shared boundary anchors, normalizes touching holes before triangulation, and triangulates with `poly2tri` so every boundary vertex is preserved. The branch end is capped into the terrain and the existing weld/topology validator remains the gate. The conform → normalize → conform sequence is required when a junction sits close to a main control point, where polygon-clipping can emit a hole that touches the outer ring. Clipper2 (`clipper2-ts`, BSL-1.0) is the fallback when polygon-clipping still fails to close a ring. The research also exposed a fixture inconsistency: the branch fixtures attached at fraction `0.25` of a 360 m loop but started at `[20, 0]`. The fixtures now attach at `20/360`, which resolves to the authored first point, and snapping remains a separate tested kernel rule.

## D11 — Production promotion deferred until v1

track-ed passed the v0 Lapster conformance run but is not promoted to production. The outcome is **continue the spike**.

Production promotion requires rounded spline centrelines, terrain, kerbs, and props, followed by re-conformance, performance measurement, and comparison against the current builder.

Rationale: the current Lapster builder owns production until track-ed can match the product-critical geometry the builder already provides. Conformance alone proves the export path, not production readiness. The v1 gates are scoped in `docs/v1-roadmap.md`.

## D12 — Terrain has one declared source of truth

Terrain supports two authoring modes, but never both at once:

- **`conform` (default)** — the road elevation/profile is authoritative; terrain is cut, filled, and welded to the road/shoulder boundary.
- **`follow`** — the terrain heightfield is authoritative; the road centreline samples terrain height and drapes over it. Terrain is still clipped under the road to prevent overlap and z-fighting.

Only one mode is active per project. Switching modes is an explicit, deterministic, undoable conversion; there is no live two-way coupling. Both modes produce the same consumer-neutral `BakedTrack` surface graph.

Rationale: the road must stay predictable for junctions, kerbs, collision, and grading. Road-follow is useful for rapid drafting, while terrain-conform is the production path. Implementing `conform` first (G2a) and `follow` second keeps the hard welded-boundary work independent of the mode switch.

## D13 — `project@2` shared junction graph

Junctions are first-class nodes, not sliding fractions.

- Control points have stable ids.
- A junction references a host centreline point.
- Branch roots share the junction point id and position.
- Multiple branches can reference one junction; multiple junctions are allowed.
- Moving the host junction point moves every connected branch.
- Spawn fractions remain arc-length fractions; junction identity is graph-based.

Rationale: fraction attachments drift when host points are inserted or moved and cannot represent multi-way junctions cleanly. `project@1` remains supported for legacy fixtures; the app writes `project@2` for junction graphs.

## D14 — Branch-to-branch joins merge centrelines

Two loose branch ends can be joined by dragging one onto the other. The editor concatenates the two open centrelines, reverses the target branch, drops the duplicate join point, and keeps the outer attachments as `attach`/`endAttach`.

Rationale: a branch-hosted junction would still be two roads meeting at a node. The requirement is one road section, so the join point must not remain a junction. The kernel bake path is unchanged because the result is an ordinary open centreline. Attached target ends must be detached first; allowing attached targets would make main-loop and branch targets ambiguous and would silently orphan junctions.

## D15 — `project@1` fraction attachments stay import-only

`project@1` remains import-only and is not converted automatically to `project@3`. In particular, legacy `attach: { to, fraction }` branch roots are preserved when a `project@1` file is opened, but they are not rewritten as junction members.

Rationale: a fraction attachment has no stable target point id. Converting it requires inserting a control point into the host section at the sampled position, which changes the host's authored control points, point ids, and spline shape. Silent migration would make the geometry differ from the source file and would make round-trips lossy without an explicit author decision. Import-only also keeps the `project@2` conversion path small and deterministic.

Limits: `project@1` geometry can be viewed, baked, exported, and edited with its legacy fraction slider, but it cannot use `project@3` section/junction authoring until it is re-authored or explicitly converted in a future migration tool. `project@2` projects continue to convert on load because their junction and `attach`/`endAttach` references already carry stable point ids.

## Alternatives considered

- **Build inside the Lapster repository** (`web/track-builder/`): cheaper integration and shared CI, but keeps the tool tied to Lapster and does not establish a consumer-neutral boundary. Reconsider if the multi-consumer goal fades.
- **Fix the existing Rust/wgpu bake in place**: reuses existing features, but the iteration loop and renderer coupling remain. The current junction work has stalled on topology, not on language.
- **Rust/wasm kernel with `lyon`/`geo`**: more robust planar geometry, but reintroduces Rust coupling and slows iteration. Possible later kernel swap if TypeScript geometry becomes the bottleneck.
- **Babylon.js**: comparable rendering and inspector tooling, but heavier and less central to the GLB ecosystem. Not chosen for v0.
- **Blender or Geometry Nodes**: powerful geometry, wrong product shape for a browser editor and multi-consumer export.
- **3D CSG (`three-bvh-csg`)**: rejected as the primary approach for planar road/terrain topology; heavier and less deterministic than a 2D clipping/stitching pipeline.

## Promotion and kill criteria

Promote when M1 proves watertight loop and 30/45/90° junctions in the inspector, exports are deterministic, the Lapster profile bakes and loads, and iteration is materially faster than the current builder.

Kill when junction quality is not better, iteration is not faster, the inspector cannot demonstrate a hole-free surface, or v0 scope cannot be held.

After promotion, decide explicitly which editor owns track authoring.
