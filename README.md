# track-ed

Standalone, browser-first track geometry editor.

Live demo: https://joegaffey.com/track-ed/

Status: M4 conformance passed. v1-G1 rounded spline centrelines and v1-G2 terrain are implemented. Terrain is authored by point-based TIN, with both `conform` and `follow` road modes. Multiple junctions are authored with the `track-ed/project@2` shared-junction graph. `track-ed/project@3` venue sections are in progress: multiple closed loops, dead-ended open sections, general junction members, loose-end joins/merges, loop closing, junction detach, and open/closed section splitting are authorable without a main loop. Existing `project@2` projects are converted to `project@3` on load. track-ed remains a spike and is **not promoted to production** yet; road elevation, banking/crown, kerbs, and props remain v1 gates. See `docs/v1-roadmap.md`.

Lapster is the first consumer, not the definition of the tool. The core is consumer-agnostic. v0 ships one export profile, `lapster-glb-track@1`, which emits `track.glb` + `track.json` for Lapster's asset compiler. The `.sima` pack is produced downstream by Lapster, not by track-ed.

`track.glb` is standard glTF 2.0. The Lapster-specific parts are the `track.json` manifest, the `surface_*` node/material naming convention, surface metadata, spawn/collision rules, and the two-file bundle contract.

| Layer | Classification |
| --- | --- |
| Kernel, `BakedTrack`, geometry | Consumer-neutral |
| GLB container, mesh/accessor layout | Standard glTF 2.0 |
| `surface_*` node/material names | Lapster profile convention |
| `track.json` / `sim-track-glb-v1` | Lapster-specific |
| `.sima` generation | Lapster downstream |

## Read order

1. `SPEC.md` — functional specification and acceptance criteria.
2. `docs/decisions.md` — rationale, alternatives, promotion and kill criteria.
3. `docs/contracts/project-v3.md` — current venue-section authoring contract.
4. `docs/contracts/project-v2.md` — legacy junction-graph contract.
5. `docs/contracts/project.md` — legacy `project@1` authoring contract.
6. `docs/contracts/baked-track.md` — consumer-neutral baked model.
7. `docs/contracts/lapster-glb-track.md` — v0 export profile.
8. `docs/research-brief.md` — brief for the independent research agent.
9. `docs/research-report.md` — prior-art and technique survey for the kernel and inspector.
10. `docs/conformance-report.md` — latest Lapster conformance results.
11. `docs/performance-baseline.md` — pre-v1 FPS, bake, export, and compiler timings.
12. `docs/v1-roadmap.md` — production promotion gates beyond v0.
13. `docs/venue-model-plan.md` — venue section-graph implementation plan.
14. `schemas/` — executable JSON Schemas.
15. `src/model/baked-track.ts` — TypeScript contract for the baked model.
16. `docs/agent-prompt.md` — historical v0 implementation prompt.

## Quick start

Node 22 or newer is required.

```bash
npm install
npm run dev
npm run build
npm test
```

The app starts with a rounded spline loop. There is no fixture selector: use Open JSON, Save JSON, New loop, and Add branch. To try branch merging, open `fixtures/projects/loop-two-loose-branches.json` and drag one loose cyan end onto the other. Splines use deterministic centripetal Catmull-Rom sampling with rounded corners, and newly added branch/junction roads are spline-sampled too. Polyline fixtures remain only as kernel regression inputs. Control points can be dragged, added by double-clicking a centreline, and deleted. Branches can be added, removed, and reattached with the slider or by dragging the branch root. A loose branch end can be joined by dragging it over a main-loop control point and releasing. Dragging a joined end pulls it free. Dragging one loose branch end onto another merges them into a single road section. Spawn centreline, fraction, and lateral offset are editable, and the spawn arrow can be dragged. Terrain is authored by adding point heights; the terrain is triangulated through the points (TIN). Road mode switches between terrain-conform and road-follow. Undo/redo and project JSON save/open are available, and the inspector still reports zero interior boundary edges and T-junctions on branch geometries. Wireframe is on by default.

## Layout

```text
src/kernel/                consumer-neutral geometry kernel
src/model/                 BakedTrack contract
src/export/lapster/        lapster-glb-track@1 profile
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
- **v1** — G1 splines, G2 terrain, and the `project@2` multi-junction graph implemented; kerbs, props, re-conformance, and production decision remain. See `docs/v1-roadmap.md`.

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
