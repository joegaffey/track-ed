# Large-venue performance benchmark

Status: D1 decision input recorded.
Date: 2026-11-20.
Related: `docs/performance-baseline.md`, `docs/v1-roadmap.md`,
`docs/contracts/project-v5.md`.

## Purpose

D1 measures a deterministic, representative large venue before deciding whether
to optimise the TypeScript kernel (D2), move baking to a Web Worker, or port the
kernel. This run does not change bake, validate, or export behaviour.

## Benchmark fixture

`src/kernel/large-venue-bench.test.ts` builds a fixed `track-ed/project@5`
venue in code. It contains:

- a closed main loop with Catmull-Rom spline centrelines;
- two open spurs attached to the main loop at shared junctions (east and north);
- seven additional closed loops, all with fixed control points and ids;
- 21 fixed terrain points producing point-TIN relief and terrain holes around
  every road footprint;
- kerb runs on multiple sections plus tree and tyre instance runs;
- 10 sections, 2 junctions, and 70 control points in total.

No random values, timestamps, or environment-dependent ids are used. The
benchmark is skipped unless `RUN_LARGE_VENUE=1`, so the normal `npm test` suite
stays fast.

## Environment

- Linux 7.0.0-43-generic x86_64, 12 logical CPUs.
- CPU: AMD Ryzen 5 PRO 6650H with Radeon Graphics.
- Node v26.13.1, Vitest 5.1.0, TypeScript 7.0.2.
- track-ed branch `feat/editor-app-split` at `739472d`.
- Timings use Node `performance.now()`, median of three runs per metric.

## Command

From the repository root:

```bash
(cd web/track-ed-src && RUN_LARGE_VENUE=1 npx vitest run src/kernel/large-venue-bench.test.ts)
```

The run took 68.06 s wall clock in this environment.

## Measured results

Median of three runs:

| Metric | Median (ms) | Runs (ms) |
| --- | ---: | --- |
| Full `bakeProject` | 8379.5 | 8348.2, 8396.3, 8379.5 |
| `validateBakedTrack` | 1506.1 | 1535.8, 1506.1, 1460.8 |
| `exportLapsterGlbTrack` (bundle in memory) | 1710.6 | 1939.5, 1620.4, 1710.6 |
| Incremental edit (move one main-loop control point) + re-bake | 8368.3 | 8640.9, 8368.3, 8333.7 |

The incremental edit itself is a single point write; the reported figure is the
edit plus the full re-bake.

Baked counts from the measured track:

| Count | Value |
| --- | ---: |
| Sections | 10 |
| Junctions | 2 |
| Project control points | 70 |
| Ground vertices | 3,269 |
| Ground triangles | 6,532 |
| Kerb triangles | 3,832 |
| Props | 149 |
| Export bundle bytes | 4,123,655 |

`exportLapsterGlbTrack` includes its own `validateBakedTrack` pass, so it is not
directly comparable with the standalone validate row. Only the in-memory bundle
is measured; browser download handling is excluded.

## Baseline comparison

`docs/performance-baseline.md` records synthetic disjoint 8-point spline venues
baked in about 2.0 s, 9.7 s, and 31.1 s for 4, 9, and 16 sections, dominated by
polygon clipping and terrain-hole triangulation. Crossing validation was a small
fraction.

This 10-section venue bakes in 8.38 s. It is in the same order as the 9-section
baseline point and confirms the same bottleneck: the full bake and the
incremental re-bake are both compute-bound in terrain/boolean triangulation, not
in crossing checks. This fixture is not an exact apples-to-apples replacement for
the older synthetic rows because it adds two junctions, point-TIN terrain, kerbs,
and props.

## Browser metrics

Preview FPS, draw calls, and memory were not re-measured for D1. The existing
hosted e2e hook exposes project/read and edit operations but no large-project
load, FPS, draw-call, or memory instrumentation; adding those would require
production-only debug hooks. The Node bake/edit/validate/export timings are the
D1 decision input, as allowed by the task packet.

## D1/D2 recommendation

**D2 is warranted.** An 8.4 s full bake and an 8.4 s incremental re-bake exceed
an acceptable interactive authoring budget, even though discrete edits are
debounced until the pointer pauses or is released. Export (1.7 s) and validation
(1.5 s) remain the smaller costs.

Recommended escalation order, matching the plan:

1. Optimise the TypeScript kernel, primarily terrain-hole triangulation and
   polygon clipping in the section bake path.
2. If the bake still exceeds the authoring budget after that, move the bake to a
   Web Worker so pointer/release interactions remain responsive.
3. Do not port the kernel to Rust/wasm on this evidence alone; no measured case
   yet justifies the contract and maintenance cost.

Re-run this benchmark after each kernel or Worker change and append the new
dated result here.
