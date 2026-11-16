# Contracts

The v0 pipeline has three layers:

```text
track-ed/project@3  ->  BakedTrack v1  ->  lapster-glb-track@2
   venue sections          neutral model        export profile
```

- `project-v3.md` — current venue-section authoring format. Owned by track-ed.
- `project-v2.md` — legacy `project@2` shared-junction graph.
- `project.md` — legacy `project@1` authoring format.
- `baked-track.md` — consumer-neutral contract between the kernel and every export profile. Owned by track-ed.
- `lapster-glb-track.md` — v0 export profile for Lapster's `sim-track-glb-v1` importer. The manifest schema is pinned from Lapster.

Executable schemas:

- `schemas/project-v3.schema.json`
- `schemas/project-v2.schema.json`
- `schemas/project.schema.json`
- `schemas/lapster-track-manifest.schema.json`

TypeScript reference:

- `src/model/baked-track.ts`

Rules:

- The kernel and `BakedTrack` must not contain consumer-specific fields.
- `track.glb` is standard glTF 2.0; the profile owns the manifest and consumer-specific node/material naming.
- The Lapster profile is the only place where Lapster terms and `.sima` may appear.
- The profile is a pure mapping and must not alter geometry.
- Breaking changes require a version bump and, for the Lapster profile, a conformance run.
