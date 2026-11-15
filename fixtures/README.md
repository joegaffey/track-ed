# Fixtures

Authoring fixtures for `track-ed/project@1`, `@2`, and `@3`.

App default:

- `projects/loop-spline-terrain-junctions.json` — `project@2` rounded spline loop with point-based terrain, ready for multiple junctions.

Venue section fixtures:

- `projects/venue-two-loops-spur.json` — `project@3` with two disjoint closed loops and a dead-ended open spur. Spawn is on the spur; length is the sum of all sections.
- `projects/venue-loop-spur-junction.json` — `project@3` closed loop with an open spur attached at an interior loop control point.

Legacy procedural terrain fixtures (kernel conformance only; not exposed in the app):

- `projects/loop-spline-terrain.json` — elevated terrain around a flat road (`conform` mode).
- `projects/loop-with-branch-90-spline-terrain.json` — elevated terrain with a spline branch junction.
- `projects/loop-spline-terrain-follow.json` — road draped over the terrain (`follow` mode).
- `projects/loop-with-branch-90-spline-terrain-follow.json` — follow mode with a branch junction.

Kernel and conformance fixtures (not shown in the app):

- `projects/loop-with-branch-{90,45,30}-spline.json` — rounded spline loop plus a spline branch with a curved junction road.
- `projects/loop.json` — closed polyline loop, no junction.
- `projects/loop-with-branch-{90,45,30}.json` — closed polyline loop plus an attached branch.

These are authoring inputs, not baked exports. The app starts from the point-terrain spline loop; branch and terrain fixtures are used by kernel tests and conformance runs. Polyline fixtures remain for kernel regression coverage. The baker snaps the branch's first point to the exact host sample.

The branch fixtures now attach at `20/360` of the 360 m main loop, which resolves exactly to the authored first point `[20, 0]`. The branch headings are 90°, 45°, and 30° from the main tangent at that attachment. Snapping remains a separate tested kernel rule for projects whose first branch point is only a hint.

Baked `track.glb` and `track.json` outputs belong in a build or export directory, not here.
