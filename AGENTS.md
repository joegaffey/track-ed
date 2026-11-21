# track-ed agent guide

This repository is a standalone track geometry editor. Read `SPEC.md` before writing code.

## Read order

1. `SPEC.md`
2. `docs/decisions.md`
3. `docs/contracts/project-v5.md`
4. `docs/contracts/project-v4.md` (legacy walls/prop runs)
5. `docs/contracts/project-v3.md` (legacy venue sections)
6. `docs/contracts/project-v2.md` (legacy junction graph)
7. `docs/contracts/project.md` (legacy `project@1`)
8. `docs/contracts/baked-track.md`
9. `docs/contracts/lapster-glb-track.md`
10. `docs/toolchain.md`
11. `schemas/project-v5.schema.json`
12. `schemas/project-v4.schema.json`
13. `schemas/project-v3.schema.json`
14. `schemas/project-v2.schema.json`
15. `schemas/project.schema.json`
16. `schemas/lapster-track-manifest.schema.json`
17. `src/model/baked-track.ts`

## Mission

Maintain track-ed as a browser editor for multiple open and closed venue sections, shared junctions, spline centrelines, point-based TIN terrain, roadside kerbs and walls, spline-following prop runs, and a generated visual racing line. It bakes one welded ground surface graph plus separate kerb and wall graphs, an optional visual-only racing line, and optional props; it inspects topology and exports `track.glb` + `track.json` for the Lapster profile.

M4 conformance has passed. v1-G1 (splines), v1-G2 (terrain/TIN), v1-G3 (kerbs), v1-G4 (walls/props), `project@2` multi-junction authoring, and `project@3`–`project@5` venue sections are implemented: multiple closed loops, dead-ended open sections, general and multi-way junctions, open-section junctions, independent section/junction authoring, an independent section list, loose-end joins/merges, junction detach, loop splitting, unified roadside splines with fixed kerb-edge splines, editable free splines, kerb/wall surface runs, and tree/tyre/block instance runs work without a main loop. All 19 fixtures pass bake/validate/export and v1-G5 Lapster conformance, and the visual racing line is generated per section and exported as a visual-only node. track-ed is promoted to production. The implicit one-leg race layout is an approved export feature for closed spawn sections. General route/lap/sector authoring, banking/crown, and dynamic sections remain deferred, with banking/crown and an A7 builder iteration-time trial as post-promotion follow-ups; do not regress the existing invariants while extending them.

## Architecture boundaries

- `src/kernel/` and `src/model/` are consumer-neutral. They must not import three.js, Lapster code, or anything from `src/export/lapster/`.
- `src/app/` may use three.js for rendering, interaction, and inspection only.
- `src/export/lapster/` is the only place where Lapster terms, `.sima`, importer node names, and `sim-track-glb-v2` may appear.
- The pipeline is `project -> kernel -> BakedTrack -> export profile`.
- The export profile is a pure mapping. It must not repair, retriangulate, or alter geometry.
- Do not add a plugin system, exporter registry, or generic exporter interface.
- Do not write `.sima` directly.

## Current scope

In scope: multiple open and closed venue sections with no main-loop privilege, dead-ended sections, shared junction nodes, general and multi-way junctions, section list, section splitting, junction detach, loop joins and loose-to-loose section merges, spline centrelines, point-based TIN terrain with `conform`/`follow` modes, asphalt/dirt/grass surface bands, fixed left/right kerb-edge splines plus editable free roadside splines, with kerb, wall, tree, tyre, and block runs, seam-wrapping spans, per-run heights/spacing/collision, separate kerb and wall graphs, a visual-only racing line graph, and one welded ground surface graph, browser preview, geometry inspector, browser download export, deterministic output. A closed spawn section also exports an implicit one-leg race layout (`race` in the `sim-track-glb-v2` manifest): baked centreline, start/finish, eight grid slots, and four sectors.

Out of scope for now: general routes/laps/sectors authoring, multiple layouts, blank-sheet authoring, pit lanes, prop asset libraries, edible/decorative prop variants, textures, direct `.sima` export, CLI or headless export app, game runtime.

Deferred features are documented in `SPEC.md` and must not introduce design hooks.

## Toolchain

- Node 22 or newer. The repository pins Node 26-compatible tooling.
- TypeScript strict.
- Vite and Vitest.
- three.js `0.187.0` for preview and interaction.
- Planar geometry uses `earcut`, `poly2tri`, `polygon-clipping`, and `clipper2-ts` in the kernel, not the app.
- GLB uses the deterministic writer in `src/export/lapster/`, not three's `GLTFExporter`.

## Verification

```bash
npm run build
npm test
```

For geometry changes, also inspect the fixtures in the browser and confirm:

- zero interior boundary edges after welding;
- zero T-junctions;
- no overlapping triangles;
- no z-fighting;
- collision overlay matches visual surfaces.

Then run the Lapster conformance steps in `docs/contracts/lapster-glb-track.md`.

## Rules

- Do not commit or push unless asked.
- Do not copy GPL or otherwise incompatible code. Record licenses for anything studied or reused.
- Keep the kernel deterministic. No timestamps, random ids, or environment-dependent values in exports.
- Keep `track-ed/project@1`, `track-ed/project@2`, `track-ed/project@3`, `track-ed/project@4`, and `track-ed/project@5` strict: reject unknown fields.
- Keep `BakedTrack` free of consumer-specific fields.
- Do not weaken the geometry invariants to make a fixture pass.

## Report format

When finishing a task, return:

```text
STATUS: COMPLETED | FAILED | BLOCKED
MILESTONE: M0 | M1 | M2 | M3 | M4 | v1
FILES: <paths>
TESTS: <commands and results>
NOTES: <1-3 sentences>
```
