# Research brief — track-ed prior art and techniques

Status: independent research task. Report only; no code changes.

## Context

`track-ed` is a standalone browser editor for simple track geometry. v0 authors one closed centreline plus zero or one attached branch, bakes a single welded surface graph (asphalt, dirt shoulder, grass terrain), inspects it for holes and topology errors, and exports `track.glb` + `track.json`.

Lapster is the first consumer, but the core is consumer-agnostic. Future consumers such as Assetto Corsa or rFactor 2 would be additional export profiles. v0 only proves the neutral core and the Lapster profile.

The hard problem is not rendering. It is producing a watertight, non-overlapping planar surface where the road, shoulders, terrain, and junction pad meet.

## Goal

Survey prior art and recommend an approach for the geometry kernel and inspection tooling. Free rein on sources and categories.

## Questions

1. How do comparable editors and generators model roads, tracks, and terrain?
2. How do they integrate road geometry with terrain so there are no overlaps or holes?
3. How do they handle T/Y junctions, clipping, and watertight stitching?
4. How do they inspect or validate geometry for holes, non-manifold edges, and T-junctions?
5. How do they export to GLB/glTF or another interchange format?
6. Which libraries or algorithms are robust for 2D polygon clipping, triangulation, and boundary stitching?
7. How do comparable tools target multiple games or sims: neutral intermediate model, per-game exporters, or downstream converters?
8. What interchange formats or conversion paths exist for Assetto Corsa, rFactor 2, and similar titles?
9. Which parts of a track are genuinely portable (surface graph, centreline, spawns, cameras) and which are game-specific?
10. What are the pitfalls of a consumer-neutral core versus game-specific geometry, materials, and collision conventions?

## Required output

1. Comparison table: project or tool, link, license, stack, data model, junction handling, terrain handling, export format, strengths, weaknesses, relevance to track-ed.
2. "What to copy / what to avoid" for track-ed.
3. Three concrete recommendations for the kernel and inspector.
4. Five pitfalls with citations.
5. Any permissively licensed code worth studying for watertight junction or terrain stitching, with license-compatibility notes.
6. A short list of terms and search leads for further reading.
7. An explicit note on whether any recommendation conflicts with track-ed's v0 scope.

## Constraints

- v0 is one closed loop plus one branch, flat terrain, three.js preview, GLB + `track.json` export.
- The kernel is pure TypeScript and must not depend on three.js.
- v0 has no game runtime, physics, audio, CLI, or direct `.sima` export.
- Do not propose expanding v0. Mark later ideas as deferred.
- Report only. Do not modify the repository.

## License note

track-ed is dual MIT/Apache-2.0. Flag any code or algorithm that cannot be reused under those terms. Do not copy GPL code.
