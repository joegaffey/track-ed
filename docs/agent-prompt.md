# Historical v0 implementation prompt

Status: historical. This was the original starting prompt for the v0 spike. Use `AGENTS.md` for current work.

```text
You are implementing track-ed v0 in <repository>.

Read, in this order:
1. AGENTS.md
2. SPEC.md
3. docs/decisions.md
4. docs/contracts/project.md
5. docs/contracts/baked-track.md
6. docs/contracts/lapster-glb-track.md
7. docs/toolchain.md
8. schemas/project.schema.json
9. schemas/lapster-track-manifest.schema.json
10. src/model/baked-track.ts
11. fixtures/projects/*.json

Implement M0 only:
- a browser app shell;
- load the hardcoded loop fixture;
- bake asphalt, dirt shoulder, and grass terrain as one welded surface graph;
- render it with three.js;
- add the geometry inspector overlays and validation summary;
- add a browser download export for track.glb + track.json;
- add kernel unit tests for the M0 invariants.

Constraints:
- The kernel is pure TypeScript and must not import three.js.
- The pipeline is project -> kernel -> BakedTrack -> export profile.
- The Lapster profile is the only place where Lapster terms, .sima, and sim-track-glb-v1 may appear.
- Do not add a plugin system, CLI, or direct .sima export.
- Hold v0 scope. Do not add deferred features.
- Do not commit or push unless asked.

Verification:
- npm run build
- npm test
- inspect the loop in the browser for boundary edges, T-junctions, and overlap
- export and run the Lapster conformance steps in docs/contracts/lapster-glb-track.md

Report:
STATUS: COMPLETED | FAILED | BLOCKED
MILESTONE: M0
FILES: <paths>
TESTS: <commands and results>
NOTES: <1-3 sentences>
```
