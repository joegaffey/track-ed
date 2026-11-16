# Toolchain

Status: v1-G2c1/G2c4 + project@2 shared junctions + project@3 venue sections implemented.

## Pinned versions

- Node: 22 or newer.
- `three`: `0.187.0`.
- `@types/three`: `0.187.0`.
- `earcut`: `3.2.4` (ISC) for loop-band triangulation.
- `polygon-clipping`: `0.15.7` (MIT) for junction footprint union/difference.
- `clipper2-ts`: `2.0.1-19` (BSL-1.0) as a robust fallback for polygon-clipping failures.
- `poly2tri`: `1.5.0` (BSD-3-Clause) for conforming triangulation with preserved boundary vertices.
- `vite`: `8.3.8`.
- `vitest`: `5.1.0`.
- `typescript`: `7.0.2`.

Pin exact versions. three.js APIs change between releases.

## Commands

```bash
npm install
npm run dev
npm run build
npm test
npm run test:watch
```

## Recommended geometry stack

- `earcut` for the loop-band triangulation.
- `polygon-clipping` for junction footprint union and difference.
- `clipper2-ts` as a fallback when polygon-clipping cannot close an output ring.
- `poly2tri` for conforming triangulation after boundary vertices have been split at shared anchors.

Keep these in `src/kernel/`. Do not import them in `src/model/` or `src/export/lapster/` unless the model needs validation helpers.

`poly2tri` is a CommonJS build that references the Node-style `global` object. `vite.config.ts` defines `global` as `globalThis` so the same kernel runs in the browser and in Vitest.

Do not use 3D CSG as the primary approach for the planar road/terrain surface.

## Preview and inspector

- three.js for the scene, camera, materials, wireframe, lines, and picking.
- `OrbitControls` from `three/addons` for camera control.
- Prefer `LineSegments` overlays for boundary edges, T-junctions, and wireframe.
- Use a small amount of UI framework or plain TypeScript. Do not add a heavy framework for v0.

## Export

- Build the `BakedTrack` model in the kernel.
- Map it to GLB + manifest in `src/export/lapster/`.
- Try `GLTFExporter` from `three/addons` for the GLB.
- If byte-identical export fails, switch to `@gltf-transform/core` or a small deterministic writer.
- The manifest must validate against `schemas/lapster-track-manifest.schema.json`.

## Determinism

- No timestamps, random ids, or environment-dependent values in output.
- Stable ordering for positions, indices, surfaces, spawns, and cameras.
- Verify by exporting the same project twice and comparing file hashes.

## Browser target

- Chromium/Chrome.
- WebGL2 minimum.
- No network access during authoring or export.

## Verification

```bash
npm run build
npm test
```

Then use the browser inspector and the Lapster conformance steps in `docs/contracts/lapster-glb-track.md`.
