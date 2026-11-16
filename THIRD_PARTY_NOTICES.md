# Third-party notices

track-ed bundles the following runtime dependencies. Their licenses are compatible with the project's MIT/Apache-2.0 dual license.

| Package | Version | License | Source |
| --- | --- | --- | --- |
| `clipper2-ts` | 2.0.1-19 | BSL-1.0 | https://github.com/countertype/clipper2-ts |
| `earcut` | 3.2.4 | ISC | https://github.com/mapbox/earcut |
| `poly2tri` | 1.5.0 | BSD-3-Clause | https://github.com/r3mi/poly2tri.js |
| `polygon-clipping` | 0.15.7 | MIT | https://github.com/mfogel/polygon-clipping |
| `three` | 0.187.0 | MIT | https://github.com/mrdoob/three.js |

## Lapster procedural geometry and textures

- Source: https://github.com/joegaffey/lapster
- Reference commit: `20547ab`
- License: MIT OR Apache-2.0
- Used in: `src/export/lapster/glb.ts` and `src/app/scene.ts`
- Ported: concrete barrier block dimensions and material, blue/white tyre stack dimensions and materials, conifer tree tier layout/colors, the deterministic tarmac/grass texture generators, and the distant mountain height/noise profile from `crates/sim-render/src/track_editor.rs`.

Development-only tooling (`vite`, `vitest`, `typescript`, `@types/three`) is not part of the shipped application bundle. Full license texts are available in each package under `node_modules/` after `npm install`.
