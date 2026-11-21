# track-ed

Standalone, browser-first track geometry editor.

Live demo: https://joegaffey.com/track-ed/

Status: M4 conformance passed. v1-G1 rounded spline centrelines, v1-G2 terrain, v1-G3 kerbs, and v1-G4 walls/props are implemented, along with a visual-only racing line. Terrain is authored by point-based TIN, with both `conform` and `follow` road modes. `track-ed/project@5` venue sections support multiple closed loops, dead-ended open sections, general and multi-way junction members, a section list, independent section and junction authoring, loose-end joins/merges, loop closing, junction detach, and open/closed section splitting without a main loop. The editor has Terrain, Track, and Roadside modes; geometry validation is collapsed to its overall status by default. Preview navigation uses cursor-anchored wheel zoom, right-drag pan, and double-click-to-focus on empty geometry. Roadside features are authored in a Roadside mode. Each section has fixed left/right kerb-edge splines; free splines are shown with an id, offset slider, and numeric spinner. Choose a feature type, drag a spline rail to paint a run, and select runs in 3D to edit spacing or height. Splines can contain mixed runs of kerbs, walls, trees, tyres, or blocks; exported prop geometry follows Lapster's procedural barrier and tyre-stack conventions, with layered jagged conifers using mixed green/gold foliage, dark slim trunks, and no ink outlines. The Lapster GLB carries procedural tarmac and grass textures, UVs, and outline extras so Lapster uses the same textured toon style as the OG track editor. A curvature-biased racing line is generated per section, rendered in the preview with an overlay toggle, and exported as a visual-only `racing_line` node. A closed spawn section also exports an implicit one-leg race layout with start/finish, eight grid slots, and four sectors; open spawn sections omit it with a warning. Existing `project@2`–`project@4` projects are converted to `project@5` on load; `project@1` remains import-only. All 19 fixtures pass bake/validate/export and v1-G5 Lapster conformance, including track and drive viewer checks. track-ed is **promoted to production**; banking/crown and a live builder iteration-time trial remain post-promotion follow-ups. See `docs/v1-roadmap.md`.

Lapster is the first consumer, not the definition of the tool. The core is consumer-agnostic. v0 ships one export profile, `lapster-glb-track@5`, which emits `track.glb` + `track.json` for Lapster's asset compiler. The `.sima` pack is produced downstream by Lapster, not by track-ed.

`track.glb` is standard glTF 2.0. The Lapster-specific parts are the `track.json` manifest, the `surface_*`/`prop_*` node/material naming convention, surface metadata, spawn/collision rules, and the two-file bundle contract.

| Layer | Classification |
| --- | --- |
| Kernel, `BakedTrack`, geometry | Consumer-neutral |
| GLB container, mesh/accessor layout | Standard glTF 2.0 |
| `surface_*`/`prop_*` node/material names | Lapster profile convention |
| `track.json` / `sim-track-glb-v2` | Lapster-specific |
| `.sima` generation | Lapster downstream |

## Read order

1. `SPEC.md` — functional specification and acceptance criteria.
2. `docs/decisions.md` — rationale, alternatives, promotion and kill criteria.
3. `docs/contracts/project-v5.md` — current unified roadside-spline contract.
4. `docs/contracts/project-v4.md` — legacy wall/prop-run contract.
5. `docs/contracts/project-v3.md` — legacy venue-section contract.
6. `docs/contracts/project-v2.md` — legacy junction-graph contract.
7. `docs/contracts/project.md` — legacy `project@1` authoring contract.
8. `docs/contracts/baked-track.md` — consumer-neutral baked model.
9. `docs/contracts/lapster-glb-track.md` — current export profile.
10. `docs/research-brief.md` — brief for the independent research agent.
11. `docs/research-report.md` — prior-art and technique survey for the kernel and inspector.
12. `docs/conformance-report.md` — latest Lapster conformance results.
13. `docs/performance-baseline.md` — pre-v1 FPS, bake, export, and compiler timings.
14. `docs/v1-roadmap.md` — production promotion gates beyond v0.
15. `docs/venue-model-plan.md` — venue section-graph implementation plan.
16. `schemas/` — executable JSON Schemas.
17. `src/model/baked-track.ts` — TypeScript contract for the baked model.
18. `docs/agent-prompt.md` — historical v0 implementation prompt.

## Quick start

Node 22 or newer is required.

```bash
npm install
npm run dev
npm run build
npm test
```

When hosted by Lapster, build with `VITE_LAPSTER_HOST=1` to show the **Test drive in Lapster** action. The standalone build remains export-only. Hosted track-ed compiles the current `track.glb` + `track.json` through Lapster's browser-side track-pack wasm, stores the pack locally, and opens the drive viewer. See `docs/lapster-integration-study.md`.

The app starts with a rounded spline loop. There is no fixture selector: use Open JSON, Save JSON, New loop, Add section, and Add junction. To try venue sections, open `fixtures/projects/venue-two-loops-spur.json`; to try walls and props, open `fixtures/projects/venue-walls-props.json`; to try branch merging, open `fixtures/projects/loop-two-loose-branches.json` and drag one loose cyan end onto the other. Splines use deterministic centripetal Catmull-Rom sampling with rounded corners, and newly added section/junction roads are spline-sampled too. Polyline fixtures remain only as kernel regression inputs. Control points can be dragged, added by double-clicking a centreline, and deleted. The section list inspects every section independently of junctions and highlights the section containing the 3D-selected control point. Add section creates an independent dead-ended section near the selected point; Add junction creates a spur joined at that point. Loose ends can be joined by dragging one onto another section point, dragged apart to detach, or dragged together to merge. Dragging one loose end onto the other closes an open section into a loop. Junctions can be detached without deleting sections, and any section can be split with a road-width gap. Spawn centreline, fraction, and lateral offset are editable, and the spawn arrow can be dragged. Terrain is authored by adding point heights; the terrain is triangulated through the points (TIN). Road mode switches between terrain-conform and road-follow. Undo/redo and project JSON save/open are available, and the inspector still reports zero interior boundary edges and T-junctions on venue geometries. Wireframe is on by default.

## Layout

```text
src/kernel/                consumer-neutral geometry kernel
src/model/                 BakedTrack contract
src/export/lapster/        lapster-glb-track@5 profile
src/app/                   three.js editor and inspector
fixtures/projects/         authoring fixtures
schemas/                   JSON Schemas
docs/                      decisions, contracts, toolchain, research brief
```

## Milestones

- **M0** — app shell, hardcoded loop, terrain bake, inspector overlays, browser export.
- **M1** — branch attachment contract and corrected fixtures; planar-arrangement junction bake (snap, offset/union, shared vertices, triangulate, cap, weld/validate); zero holes, overlaps, and T-junctions at 30°/45°/90°.
- **M2** — main-loop point editing, branch authoring, undo/redo, and project save/open. (implemented)
- **M3** — spawn authoring, validation gate, and export UX. (implemented)
- **M4** — conformance run, comparison report, continue/discard decision. Conformance passed; the outcome is **continue the spike**, not production promotion.
- **v1** — G1 splines, G2 terrain, the `project@2` multi-junction graph, the venue section graph, G3 kerbs, G4 walls/props, and G5 re-conformance are implemented via unified `project@5` roadside splines. track-ed is promoted to production; banking/crown and the A7 builder iteration-time trial are post-promotion follow-ups. See `docs/v1-roadmap.md`.

## Conformance

The v0 profile must pass Lapster's importer:

```bash
cargo run -p asset-compiler -- bake-glb-track <export-dir> <out.sima>
cargo run -p asset-compiler -- inspect <out.sima>
cargo run -p asset-compiler -- validate <out.sima>
```

Then load the pack in the Lapster track viewer and drive viewer. Conformance is manual for v0; an optional script may run when `LAPSTER_DIR` is set. The latest results are in `docs/conformance-report.md`.

## License

Dual MIT/Apache-2.0. See `LICENSE`, `LICENSE-MIT`, and `LICENSE-APACHE`.
