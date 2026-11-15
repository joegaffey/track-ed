# Fixtures

Authoring fixtures for `track-ed/project@1`.

App default:

- `projects/loop-spline-terrain-junctions.json` — `project@2` rounded spline loop with point-based terrain, ready for multiple junctions.

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
