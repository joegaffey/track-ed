# Performance baseline — pre-v1

Status: baseline captured before spline/terrain/kerb/prop work.
Date: 2026-11-15.

## Environment

- track-ed M3 working tree, Node 26.13.1, Vite 8.3.8, Vitest 5.1.0.
- Browser: Playwright Chromium, headless. FPS is requestAnimationFrame-capped and may differ from a GPU-accelerated desktop session.
- Lapster: local checkout at commit `20547ab` (set `$LAPSTER_DIR` or use your clone path).

## Track-ed kernel timings

Median of 40 iterations, measured in Node with `performance.now()`:

| Fixture | Bake | Validate | Export bundle | Vertices | Triangles |
| --- | ---: | ---: | ---: | ---: | ---: |
| loop | 0.19 ms | 2.09 ms | 1.95 ms | 28 | 50 |
| branch-90 | 2.00 ms | 3.62 ms | 3.27 ms | 36 | 66 |
| branch-45 | 1.74 ms | 3.17 ms | 3.71 ms | 36 | 66 |
| branch-30 | 1.21 ms | 3.02 ms | 3.11 ms | 36 | 66 |

`Export bundle` covers `BakedTrack` -> GLB + manifest in memory, not browser download.

## Browser measurements

| Fixture | Preview FPS | Export click -> work complete |
| --- | ---: | ---: |
| loop | 60.3 | 2.8 ms |
| branch-90 | 60.3 | 3.7 ms |
| branch-45 | 60.3 | 3.7 ms |
| branch-30 | 60.3 | 4.5 ms |

A6 is satisfied in this environment: preview holds ~60 fps on all four fixtures and export generation is far below 2 s.

## Lapster compiler timings

Median of 10 runs using the built debug binary:

| Fixture | `bake-glb-track` |
| --- | ---: |
| loop | 3.07 ms |
| branch-90 | 3.58 ms |

`inspect` and `validate` each complete below the shell timer resolution (<10 ms).

## v1-G1 spline update

After spline sampling and the overlap-detection sweep optimization:

| Fixture | Bake | Validate | Export bundle | Browser FPS | Browser export |
| --- | ---: | ---: | ---: | ---: | ---: |
| loop-spline | 1.5 ms | 27.9 ms | 28.5 ms | 60.4 | 17.0 ms |
| branch-90-spline | 141.6 ms | 32.2 ms | 33.2 ms | 60.5 | 14.7 ms |

Spline branch bake is dominated by polygon clipping and conforming triangulation; validation is now a small fraction after replacing the all-pairs overlap check with an X-sweep. Static preview still holds ~60 fps, and browser export remains far below 2 s.

## v1-G2a terrain update

Browser measurement for `branch-90-spline-terrain` (1,432 triangles):

| Preview FPS | Browser export |
| ---: | ---: |
| 60.4 | 35.2 ms |

Terrain conversion and welded embankments remain comfortably within the v0 A6 budget.

## v1 venue sections update (Slice 4)

Measured on Node 26 with `performance.now()`, median of 3–5 runs:

| Case | Measurement |
| --- | ---: |
| `venue-two-loops-spur` bake | 181 ms |
| `venue-two-loops-spur` export bundle | 41 ms |
| `venue-loop-spur-junction` bake | 52 ms |
| `venue-loop-spur-junction` export bundle | 14 ms |
| split closed loop (`venue-two-loops-spur`, `loop-a` at point 1) | 728 ms |
| split open section (`venue-loop-spur-junction`, `spur` at point 1) | 112 ms |

Pairwise section-crossing validation is not the bottleneck. Instrumenting the bake's pair loop on a synthetic venue of disjoint 8-point spline loops gave:

| Sections | Sampled segments | Crossing check |
| ---: | ---: | ---: |
| 4 | 384 | 2–12 ms |
| 9 | 864 | 12–13 ms |
| 16 | 1536 | 39–41 ms |

The full bake for those synthetic venues was 2.0 s, 9.7 s, and 31.1 s respectively, dominated by polygon clipping and triangulating a terrain region with many holes. Crossing validation therefore stays as the simple pairwise check; the later optimization target is terrain/boolean triangulation for very large venues, not crossing detection.

The closed-loop split gap search remains the slowest authoring operation because each candidate gap is baked and validated. It is under 1 s on the current fixtures, so no further optimization is required for Slice 4.

## Edit scheduling

Continuous point and terrain edits now update only the centreline, control-point, and terrain-point overlays per animation frame, while full bakes are deferred until the pointer pauses or is released. Discrete slider edits use a 150 ms trailing delay with a 300 ms maximum wait. Export is disabled while a bake is pending, and every drag flushes synchronously on release before join/merge validation and the undo decision.

A continuous 3-second drag on `venue-two-loops-spur` held 60 fps with no full bakes until release; the final bake still validated, enabled export, and produced one undo entry.

## Comparison against the current Lapster builder

The current Lapster builder (Rust + wgpu) already provides:

- Catmull-Rom sampling with 120 samples and iterative curvature relaxation;
- one continuous ribbon with shared boundary vertices;
- a full terrain grid with a hole under the track;
- curvature-driven kerbs with risers;
- editable prop lines for barriers, tyres, and trees;
- visual and collision export for test drive.

track-ed currently provides the welded road surface graph, point-based TIN terrain, and a multi-junction graph, but not the remaining builder features listed above. This is why production promotion is deferred to the v1 gates.

Current builder iteration time was not measured in this run. A fair A7 comparison needs a defined workflow, for example: open the builder, move one control point, rebuild, export, and load the result. Until that is measured, use the feature comparison and the track-ed numbers above as the baseline.

## Baseline conclusion

- track-ed's current bake/validate/export path is comfortably within A6.
- The gap to production is feature completeness, not raw bake performance.
- Re-run this baseline after each v1 gate so regressions are visible.
