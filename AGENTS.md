# track-ed agent guide

This repository is a standalone track geometry editor. Read `SPEC.md` before writing code.

## Read order

1. `SPEC.md`
2. `docs/decisions.md`
3. `docs/contracts/project-v3.md`
4. `docs/contracts/project-v2.md` (legacy junction graph)
5. `docs/contracts/project.md` (legacy `project@1`)
6. `docs/contracts/baked-track.md`
7. `docs/contracts/lapster-glb-track.md`
8. `docs/toolchain.md`
9. `schemas/project-v3.schema.json`
10. `schemas/project-v2.schema.json`
11. `schemas/project.schema.json`
12. `schemas/lapster-track-manifest.schema.json`
13. `src/model/baked-track.ts`

## Mission

Maintain track-ed as a browser editor for a closed main loop, multiple attached branches, shared junctions, spline centrelines, point-based TIN terrain, and branch-end joins/merges. It bakes one welded surface graph, inspects topology, and exports `track.glb` + `track.json` for the Lapster profile.

M4 conformance has passed. v1-G1 (splines), v1-G2 (terrain/TIN), and `project@2` multi-junction authoring are implemented. `project@3` venue sections are in progress: multiple closed loops and dead-ended open sections bake without a main loop. General junctions, routes, kerbs, props, dynamic sections, and production promotion remain deferred; do not regress the existing invariants while extending them.

## Architecture boundaries

- `src/kernel/` and `src/model/` are consumer-neutral. They must not import three.js, Lapster code, or anything from `src/export/lapster/`.
- `src/app/` may use three.js for rendering, interaction, and inspection only.
- `src/export/lapster/` is the only place where Lapster terms, `.sima`, importer node names, and `sim-track-glb-v1` may appear.
- The pipeline is `project -> kernel -> BakedTrack -> export profile`.
- The export profile is a pure mapping. It must not repair, retriangulate, or alter geometry.
- Do not add a plugin system, exporter registry, or generic exporter interface.
- Do not write `.sima` directly.

## Current scope

In scope: one closed main centreline, multiple open branches, shared junction nodes, loop joins and loose-to-loose branch merges, spline centrelines, point-based TIN terrain with `conform`/`follow` modes, asphalt/dirt/grass surface bands, one welded surface graph, browser preview, geometry inspector, browser download export, deterministic output.

Out of scope for now: multiple loops, loop splitting/dynamic sections, blank-sheet authoring, pit lanes, routes, sectors, kerbs, props, barriers, decorations, textures, direct `.sima` export, CLI or headless export app, game runtime.

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
- Keep `track-ed/project@1`, `track-ed/project@2`, and `track-ed/project@3` strict: reject unknown fields.
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
