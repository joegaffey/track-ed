# Decision record

Status: accepted through v1-G5. track-ed is promoted to production; see D20.

## D1 — Standalone repository

`track-ed` is a separate repository, not a page inside Lapster.

Rationale: the core is intended to be consumer-agnostic, and the current in-engine editor is coupled to Lapster's venue graph, pack format, and renderer. A standalone repo gives the geometry pipeline a clean boundary and a smaller test surface.

Trade-off: another repository, CI, deploy, and contract to maintain. The v0 spike is timeboxed and has explicit promotion and kill criteria to avoid maintaining two full editors indefinitely.

## D2 — Lapster is the first consumer, not the definition

The kernel and `BakedTrack` model are consumer-neutral. track-ed ships one export profile, currently `lapster-glb-track@5` (`@1` was the v0 profile).

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

Rationale: the exporter is DOM-coupled and its output is harder to pin byte-for-byte. The profile needs only positions, normals, indices, and flat materials, so a small writer is simpler to test and keeps three.js out of the export path. The GLB container is standard; the profile owns the `surface_*`/`racing_line` node/material convention and manifest. The writer emits one `surface_*` node and matching material per declared surface, plus an optional visual-only `racing_line` node.

## D10 — M1 starts from a planar arrangement

M1 builds one planar arrangement of the main and branch footprints before triangulating. It does not add independent branch ribbons to the M0 band generator.

Rationale: the research report found that independent tessellation causes T-junction cracks, raw offsets self-intersect at sharp corners, and layered junction surfaces z-fight. The arrangement step snaps the branch to the host sample, offsets and unions the asphalt/shoulder rings with `polygon-clipping`, conforms shared boundary anchors, normalizes touching holes before triangulation, and triangulates with `poly2tri` so every boundary vertex is preserved. The branch end is capped into the terrain and the existing weld/topology validator remains the gate. The conform → normalize → conform sequence is required when a junction sits close to a main control point, where polygon-clipping can emit a hole that touches the outer ring. Clipper2 (`clipper2-ts`, BSL-1.0) is the fallback when polygon-clipping still fails to close a ring. The research also exposed a fixture inconsistency: the branch fixtures attached at fraction `0.25` of a 360 m loop but started at `[20, 0]`. The fixtures now attach at `20/360`, which resolves to the authored first point, and snapping remains a separate tested kernel rule.

## D11 — Production promotion deferred until v1

track-ed passed the v0 Lapster conformance run but is not promoted to production. The outcome is **continue the spike**.

Production promotion requires rounded spline centrelines, terrain, kerbs, and props, followed by re-conformance, performance measurement, and comparison against the current builder.

Rationale: the current Lapster builder owns production until track-ed can match the product-critical geometry the builder already provides. Conformance alone proves the export path, not production readiness. The v1 gates are scoped in `docs/v1-roadmap.md`.

Superseded by D20 after the v1-G5 re-conformance passed.

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

Limits: `project@1` geometry can be viewed, baked, exported, and edited by dragging the legacy branch root along its host, but it cannot use `project@3` section/junction authoring until it is re-authored or explicitly converted in a future migration tool. `project@2` projects continue to convert on load because their junction and `attach`/`endAttach` references already carry stable point ids.

## D16 — Authorable kerbs are a separate solid graph

Kerbs are authored as section-local forward arcs (`side`, `start`, `length`) and baked into a separate `kerbGraph` rather than merged into the welded ground surface graph.

- Spans run continuously to their authored ends. Any exposed span end is capped.
- Kerb geometry uses a fixed 0.8 m width and alternating red/white elements. Each contiguous kerb run is divided into equal-length elements, nominally 2 m.
- Every element starts flat at `flatHeight` and rises to one raised corner at `cornerHeight`, producing the jagged profile. The next element drops back to flat at a riser. Riser faces point forward along the direction of travel so they are the exterior faces under front-face culling.
- `flatHeight` and `cornerHeight` are authorable globally and per span. Defaults are 0.06 m and 0.155 m; the effective corner height MUST exceed the effective flat height.
- Kerb surfaces are consumer-neutral `kerb_red` and `kerb_white` surfaces. The Lapster profile emits `surface_kerb_red` and `surface_kerb_white` nodes.
- The v1 collision policy is **all kerb faces solid**. The profile omits `mountable`, so Lapster includes tops, sides, and end caps in collision.
- Section split/merge operations remap, split, and side-flip kerb spans.
- A span crossing a closed-section seam is represented directly by `start + length > 1`; there is no wrap flag. The bake samples `[start, 1]` then `[0, end]` as one continuous run.
- Kerb authoring uses the unified Roadside mode with dashed offset rails, drag-to-paint, and endpoint handles. Start/end sliders are removed; dimensions remain numeric UI fields.

Rationale: the ground graph's G3–G11 invariants assume an upward-facing, non-overlapping welded surface. Raised kerbs have vertical faces and intentionally occupy space above the shoulder. Keeping them in a separate graph preserves the existing ground invariants while allowing a distinct validation contract (K1–K3).

Trade-off: kerbs are not welded into the ground mesh, so visual seams between kerb bases and shoulders rely on shared height sampling rather than shared vertices. Junction overlaps are intentional and may place kerbs over live tarmac; this avoids gaps and joiners.

## D17 — Roadside runs are the shared bake abstraction

Kerbs are normalized into consumer-neutral **roadside runs** before baking. A run carries the ordered legs, side, offset reference, junction policy, collision policy, and a surface profile. `kind: "kerb"` and `kind: "wall"` both use `mechanism: "surface"`; instanced props remain outside the run model.

- Existing section-local kerb arrays are converted into one-leg kerb runs by `roadsideRunsFromProject`.
- Runs are not clipped against junction asphalt. Each section keeps its own continuous kerb run; overlapping geometry at shared junctions is intentional.
- Exposed run ends remain capped.
- Section kerbs run continuously to their authored ends and are allowed to overlap at shared junctions. No clipping, setback, or joiner is applied at junctions.
- The shared run model now drives kerb, wall, and instance baking. `project@5` exposes it as first-class roadside splines with ordered runs.

Rationale: walls need the same path, offset, junction, collision, and authoring semantics as kerbs. Keeping kerbs as a special bake path would force a second implementation later.

## D18 — `project@5` unifies roadside splines

Kerbs, walls, trees, tyres, and blocks are all runs on section-local roadside splines. Every section has fixed left/right tarmac-edge splines; free splines have editable offsets. Runs within one spline do not overlap.

- Walls reuse the roadside-run path, offset, terrain sampling, and export plumbing as a separate `wallGraph`.
- Wall spans use the same forward `start + length` semantics as kerbs, including closed-section seam wrapping.
- Wall height defaults to `1.0 m`; wall thickness is fixed at `0.3 m`. On a fixed kerb-edge spline the wall starts exactly at the tarmac edge.
- Walls run continuously and may overlap at junctions. They are not clipped or joined.
- On a fixed kerb spline, a wall run MAY overlap a kerb run; the wall replaces the kerb for that arc. Wall-over-kerb suppression also applies across splines on the same section side.
- Instance runs carry `kind`, forward `start + length`, outward offset, spacing, and collision policy. The kernel expands them into deterministic instances with lateral/longitudinal/yaw jitter, tree size variation, terrain height, and tangent-facing quaternions. Blocks stay equal-sized and evenly spaced with a gap.
- The Lapster profile maps wall geometry to `surface_wall` and props to `prop_*` visuals plus a merged `col_prop` collision mesh using the `wall` material.
- Prop visual geometry follows Lapster's procedural prop conventions: concrete barrier blocks, alternating blue/white tyre stacks, and tiered conifer trees.
- `project@5` is the current authoring schema. `project@1`–`project@4` remain import inputs and upgrade on load. Splines may be empty or contain mixed run types.

Rationale: walls, kerbs, and prop runs all follow section splines and share the roadside-path problem. First-class splines let one offset edit move every run and match Lapster's prop-line model without becoming a general scene-graph authoring tool.

Trade-off: walls are a fixed rectangular profile in this slice, and props use built-in low-poly meshes rather than an asset library. Both are deliberately narrow until the Lapster conformance loop and performance comparison justify more.

## D19 — track-ed regenerates Lapster's texture style

The Lapster profile now generates deterministic procedural tarmac and grass textures in track-ed rather than embedding 1x1 colour swatches.

- Asphalt and dirt share the tarmac noise algorithm but bake their own tint and gain into separate textures.
- Grass uses the OG editor's grass noise; Lapster routes it through its grass texture channel by material name.
- Surface and prop primitives carry repeat-wrapped planar XZ `TEXCOORD_0` UVs.
- Kerb, wall, concrete, and tyre materials set `extras.outline = true`; Lapster's GLB track importer reads that extra and builds ink outlines. Tree trunk and every foliage tone set `extras.outline = false` so the layered conifers keep their softer silhouette.
- Lapster adds a distant mountain backdrop around imported tracks and generates screen-door dither fringes at asphalt/dirt and dirt/grass boundaries. Tracks that already contain an OG `dither` material or `mountains` mesh keep their authored versions.
- Toon shading needs no export flag: Lapster's track shader applies its toon ramp to every mesh.

Rationale: the renderer already supported textures, toon shading, and outlines, but imported tracks only had flat colour swatches and no UVs. Regenerating the style in track-ed keeps the exporter self-contained and avoids coupling Lapster's asset compiler to the OG track editor's private Rust texture generators.

Trade-off: the walls/props bundle grows from 1.7 MB to 2.4 MB because the two 256x256 procedural noise textures plus the tinted dirt variant are stored as uncompressed PNG data.

## D20 — Promote after v1-G5; banking/crown deferred

track-ed is promoted to production after the v1-G5 re-conformance run.

- All 19 fixtures bake, validate, export, and compile through Lapster `0b78c05`; every bundle inspects as `Track` and validates `ok`.
- All 19 load in the track and drive viewers, spawn with four contact points, and accelerate under throttle.
- Preview holds ~60 FPS, including the 25,617-triangle walls/props runtime scene, and export compute stays between 1.3 ms and 191 ms across the fixture set.
- track-ed matches the current builder's feature set and adds multi-section venue graphs, free roadside splines, procedural textures/outlines, and deterministic export.

Banking/crown was deliberately deferred until after this decision. Rationale: it is not required by the promoted Lapster workflow, and delaying the decision on an unscoped feature would keep the spike open without reducing production risk. Banking/crown and a direct current-builder iteration-time trial are now post-promotion follow-ups.

## D21 — Racing line is a separate visual-only graph

The racing line is generated in the kernel as an optional `racingLine: LineGraph` and exported as `racing_line` under `lapster-glb-track@4` and later profiles (`@5`).

- One ribbon is generated per section. Offsets are curvature-biased toward the inside, clamped to the authored asphalt width, smoothed, and lifted `0.02 m` above the road.
- In `follow` mode the ribbon samples the same terrain source as the road; in `conform` mode it sits on the flat road.
- The racing line is not part of the welded ground graph, the kerb/wall graphs, collision, or manifest `surfaces`.
- The preview has a racing-line overlay toggle; export includes the line whenever it is present.
- Routes remain deferred, so lines are per-section and do not join across junctions.

Rationale: the OG editor's racing line is visual-only and curvature-driven. Restoring it without opening route authoring keeps the familiar guide while preserving the welded-surface invariants.

Trade-off: per-section lines can stop or overlap at junctions until routes are authored.

## D22 — Layered conifers with soft silhouettes

Tree prop geometry now lives in the consumer-neutral `src/kernel/conifer.ts` module and is shared by the track-ed preview and the Lapster GLB profile.

- Each tree is built from layered jagged skirts and a narrow upper cone rather than smooth stacked cones.
- Tall, broad, and young variants keep deterministic per-tree jitter; trunks are taller, darker, and slimmer.
- Foliage is assigned deterministically from a deep/mid/light green palette with a rare golden variant.
- `tree_trunk` and all `tree_foliage*` materials set `extras.outline = false`, while kerbs, walls, concrete, and tyres keep their ink outlines.

Rationale: the previous preview used smooth cones and the exported trees read as sparse cone stacks. Sharing the layered geometry keeps the editor and Lapster consistent and gives the conifers the fuller, darker, mixed-colour silhouette of the reference art without changing collision, placement, or prop-run semantics.

Trade-off: trees are denser, so the walls/props fixture grows from about 19k to 34k source visual triangles; tree collision remains trunk-only.

## D23 — Implicit one-leg race layout is an approved export feature

Closed spawn sections now export an optional implicit race layout in the
`sim-track-glb-v2` manifest.

- The kernel bakes the spawn centreline at roughly 2 m spacing, rotates the
  route so index 0 is nearest the spawn fraction, samples asphalt height, and
  emits `layout`, `start_finish`, eight staggered grid slots, and four equal
  sectors.
- `layout_id` and `start_finish.section_id` are the spawn centreline id;
  `start_finish.fraction` is the authored spawn fraction.
- Grid slots are derived race setup, clamped inside the road half-width and
  sampled on asphalt. They are not authored track geometry.
- An open spawn section omits `race` and records a warning; export still
  succeeds.
- No `track-ed/project@5` field, layout UI, or general route model is added.
  General routes/laps/sectors authoring and multiple layouts remain out of
  scope.
- The visual racing line remains a separate visual-only graph, independent of
  the race route.

Rationale: AI, lap timing, and online identity need a shared track-side course,
but the full route/layout editor is still deferred. Deriving a one-leg layout
from the existing spawn proves the contract without opening general authoring.

Trade-off: multi-section layouts, route legs, authored start/finish and grid
markings, and per-layout cameras remain follow-ups.

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

After promotion, decide explicitly which editor owns track authoring. The v1-G5 promotion decision is recorded in D20; track-ed is the promoted track-authoring path, with banking/crown and the A7 builder iteration-time trial as follow-ups.
