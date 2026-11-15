# Research report — prior art and techniques for track-ed

Status: report only. No code changes were made for this research.
Date: 2026-11-15.

This report answers the brief in `docs/research-brief.md`. It surveys how comparable tools model roads, tracks, junctions, and terrain, then extracts recommendations for the track-ed kernel and inspector. It does not expand v0 scope.

## 1. Comparison table

| Project / tool | Link | License | Stack / data model | Junction handling | Terrain handling | Export | Strengths | Weaknesses | Relevance to track-ed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **track-ed M0** | this repo | MIT / Apache-2.0 | TypeScript; 2D centreline + welded triangle graph; `earcut` | Not yet; M0 loop only | Flat; rectangle minus road footprint, single graph | GLB + `track.json` | Neutral model, deterministic, inspectable topology | Junctions are the unsolved risk | Baseline to beat |
| **RoadArchitect** | [github.com/FritzsHero/RoadArchitect](https://github.com/FritzsHero/RoadArchitect) | MIT | Unity C#; spline road nodes + intersection objects | Dynamic intersections generated from lanes, road width, and angle of attack | Terrain objects + splatmap creator | Unity meshes; no neutral interchange | Open source, mature intersection generator, bridge support | Unity-coupled; no portable surface graph or GLB path | Strong reference for dynamic junction geometry and node-based authoring |
| **EasyRoads3D** | [easyroads3d.com](https://www.easyroads3d.com/) | Commercial / proprietary | Unity; road types, markers, connection prefabs | X/T crossings, roundabouts, custom crossings, "I Connector" transitions | Conforms Unity terrain to road network; splatmap and vegetation removal | Unity meshes / Unity terrain | Best-in-class terrain conforming and crossing prefab workflow | Proprietary, Unity-only; terrain poking/floating is resolution-dependent | Reference for junction pads and terrain integration, not for code reuse |
| **MRoadGen** | [github.com/MaartenNauta-Pathtrace/MRoadGen](https://github.com/MaartenNauta-Pathtrace/MRoadGen) | CC0-1.0 | Blender geometry nodes on high-poly terrain | Procedural intersections and multi-level crossings | Raycast placement; generated embankments bridge road and terrain | Blender scene / mesh | CC0; explicitly solves road-to-terrain stitching and embankments | Blender-specific node graph; terrain relief is out of v0 | Useful algorithm and CC0 asset to study; not directly portable to browser TS |
| **TerraPath** | [granddesigns.gumroad.com/l/terrapath](https://granddesigns.gumroad.com/l/terrapath) | Commercial / proprietary | Blender node-based road editor | Automatic crossings and splits; "no manual boolean cut" | Elevation-aware terrain merging; mesh cleanup tools | Blender scene / mesh | Strong authoring UX; acknowledges sharp-corner failure modes | Paid, Blender-only; own docs warn about distorted mesh at sharp corners and double geometry | Confirms sharp-corner robustness must be engineered, not assumed |
| **addRoad / Blender racemap generator** | [github.com/ogbog/addRoad](https://github.com/ogbog/addRoad), [github.com/robertkardos/blender-racemap-generator-addon](https://github.com/robertkardos/blender-racemap-generator-addon) | GPL-3.0 / unspecified | Blender Python; curves + intersection spheres or road segment meshes | Connects road edges through intersection placeholders, fills intersection meshes | Fills land patches inside/outside road loops and connects them | Blender mesh | Shows a concrete road/intersection/land merge pipeline | GPL or unclear licensing; flimsy, author warns it breaks easily | Concept only; do not copy GPL code |
| **ASAM OpenDRIVE + OpenCRG** | [ASAM OpenDRIVE](https://publications.pages.asam.net/standards/ASAM_OpenDRIVE/ASAM_OpenDRIVE_Specification/v1.9.0/specification/12_junctions/12_12_junction_crg_surface.html) | Open specification; not a source-code license | XML; roads, lane sections, junctions, connecting roads, CRG surfaces | Logical junction connectivity plus junction reference lines / CRG surfaces | Surface described separately via OpenCRG; not a visual mesh | OpenDRIVE / OpenCRG XML | Neutral, mature road-network model; separates topology from surface detail | Connecting roads can overlap in elevation; junction surface may be undescribed or inconsistent | Best conceptual model for "consumer-neutral core": keep topology, surface, and consumer metadata separate |
| **Eclipse SUMO `netconvert`** | [sumo.dlr.de/docs/netconvert.html](https://sumo.dlr.de/docs/netconvert.html) | EPL-2.0 OR GPL-2.0-or-later | C++; nodes, edges, lanes, junctions with explicit `shape` polygons and internal lanes | Junction shape polygons and internal lane geometry; many junction options | Road network geometry only; no visual terrain bake | SUMO net, OpenDRIVE, other network formats | Explicit junction boundary representation; mature conversion pipeline | Copyleft; traffic-simulation model, not a visual surface/terrain pipeline | Good reference for junction `shape` and internal-link topology; avoid code reuse |
| **Assetto Corsa pipeline** | [AC Tools Blender add-on](https://extensions.blender.org/add-ons/ac-tools/), [community KN5 exporter](https://github.com/moppius/blender-assetto-corsa-tools) | Proprietary game tools; community add-ons GPL/MIT depending on project | FBX scene → KsEditor → KN5; named physical materials and objects | Authored manually in DCC; AC expects named objects/materials | Terrain authored in DCC and exported | FBX, KN5, `surfaces.ini`, `ui_track.json` | Mature ecosystem and clear object/material conventions | Game-specific axes, names, materials, collision rules; no neutral interchange | Confirms Lapster-like downstream profiles are the right boundary |
| **rFactor 2 gMotor pipeline** | [gMotor 3ds Max plugins](https://docs.studio-397.com/display/DG/gMotor+3ds+Max+Plugins), [SCN](https://docs.studio-397.com/pages/viewpage.action?pageId=37945743) | Proprietary | 3ds Max + gMotorMaterial → GMT meshes + SCN scene + MAS/MFT | Authored in 3ds Max; scene instances and collision flags | Terrain authored in DCC | GMT, SCN, MAS, MFT | Deep control over collision, LOD, lighting, materials | Proprietary, DCC-plugin-bound, game-specific | Reinforces a neutral `BakedTrack` plus a downstream export profile |
| **three.js `GLTFExporter`** | [threejs.org](https://threejs.org/) | MIT | Browser JS; three.js scene graph → glTF/GLB | Not applicable | Not applicable | glTF / GLB | Convenient, battle-tested | DOM/browser coupling; harder to pin byte-identical output; includes three-specific metadata | Tried first by the spec; track-ed chose a small deterministic writer instead |
| **glTF-Transform** | [gltf-transform.dev](https://gltf-transform.dev/) | MIT | Node/browser TS; glTF document graph | Not applicable | Not applicable | glTF / GLB | Strong glTF editing and validation-oriented toolchain | Extra dependency; not a geometry engine | Viable fallback if the deterministic GLB writer grows beyond simple meshes |

## 2. What to copy / what to avoid

### Copy

- **Explicit junction footprint.** RoadArchitect, EasyRoads3D, SUMO, and OpenDRIVE all represent a junction as more than two ribbons crossing. Copy the idea of an explicit junction pad/footprint whose boundary is part of the same surface graph.
- **One authoritative boundary representation.** SUMO's junction `shape`, OpenDRIVE's reference lines, and MRoadGen's embankment boundaries all make the boundary explicit. track-ed should derive all mesh boundaries from one set of planar rings, not from independent per-region tessellation.
- **Shared vertex table and boundary-first triangulation.** The Blender racemap generator's "fill land and connect to roads" step and our M0 band approach both point the same way: build shared boundary vertices first, then triangulate each face against those vertices.
- **Constrained triangulation for the terrain.** The racemap generator uses Shewchuk's Triangle; MRoadGen projects onto terrain. For flat v0, `earcut` with holes is enough, but M1 will need constrained boundary insertion or a robust arrangement step.
- **Junction prefabs / templates as a product concept.** EasyRoads3D and RoadArchitect expose crossing types. track-ed should keep this as an internal kernel strategy (one branch, one junction footprint), not as a plugin system.
- **Terrain conforming only as deferred research.** EasyRoads3D and MRoadGen show the real-world problem. Track-ed should not half-implement heightfields in v0; flat terrain is the correct scope cut.

### Avoid

- **Layered road-over-terrain geometry.** The "double road" junction approach in the OpenDRIVE/OpenSceneGraph thesis deliberately overlaps roads and hides seams with textures; it produces face flicker and z-fighting. track-ed's single welded graph is the correct alternative.
- **Relying on logical connectivity for a watertight surface.** OpenDRIVE junctions define lane connectivity, not a guaranteed consistent surface. Antemotion documents overlapping connecting roads and missing junction surface areas. A logical network is not a mesh.
- **Independent tessellation of adjacent regions.** Independently triangulating asphalt, dirt, and terrain creates T-junctions and hairline cracks even when positions match numerically. Shared boundary vertices and edge validation are mandatory.
- **Naive raw offsetting without self-intersection cleanup.** Offset curves self-intersect when the offset exceeds the local radius of curvature. Clipper2's own guidance says self-intersecting closed inputs almost always produce unexpected offset results. Use a robust clipper/offsetter or detect and split loops.
- **Copying GPL Blender add-ons or copyleft SUMO code.** `addRoad` is GPL-3.0; Blender itself and its bundled add-ons are GPL; SUMO is EPL/GPL. Concepts are fine; code is not compatible with track-ed's MIT/Apache-2.0 distribution without a license change.
- **Using Triangle without a commercial license.** Triangle is free for research but "may not be sold or included in commercial products without a license." Do not vendor it into track-ed.
- **Letting game-specific conventions leak into the kernel.** AC's object/material naming, rF2's GMT/SCN/MAS structures, and glTF's axis conventions belong in an export profile or a documented coordinate conversion, not in `BakedTrack`.
- **Assuming glTF axis/winding is the engine convention.** glTF is right-handed, +Y up, and defines the asset front as +Z; track-ed authors with -Z forward. The v0 profile applies no conversion, which is allowed only while the consumer contract is verified. Keep this as an explicit assumption and test it with Lapster.

## 3. Three concrete recommendations for the kernel and inspector

### R1 — Build an explicit planar arrangement before triangulating M1

For M1, stop treating asphalt, dirt, and terrain as independently generated annuli around the main loop. Instead:

1. Generate the main and branch footprints as closed 2D rings in a shared planar space.
2. Union the asphalt footprint with the branch asphalt, then union the shoulder footprints. Use a robust clipper with a fixed-point/integer grid (for example `polygon-clipping`, MIT, or `clipper2-ts`, Boost-1.0) and snap coordinates to a documented grid.
3. Extract the resulting outer ring(s) and hole(s), insert all junction boundary vertices, and triangulate each face with `earcut` against the shared vertex table.
4. Weld within `1e-5 m` and run the existing edge/T-junction/overlap validator on the result before rendering or export.

This keeps the v0 "one welded surface graph" invariant and makes the junction an explicit consequence of planar boolean geometry rather than an ad hoc overlap.

### R2 — Make branch snapping and junction stitching deterministic

Define the branch attachment as a kernel operation, not an authoring accident:

1. Sample the host centreline at `attach.fraction` using the same arc-length function used for spawns.
2. Snap `branch.points[0]` to that sample and record the original point as authoring input only.
3. Choose the branch heading from the first non-degenerate branch segment after snapping; if the resulting heading is discontinuous, reject the project with a clear validation error rather than bending the branch silently.
4. Cut the host boundary rings at the branch footprint, build the junction pad from the union, cap the open branch end into the terrain, and assert all interior edges have exactly two adjacent triangles.
5. Add fixtures with the same 30°/45°/90° geometry but branch points authored *at* the host sample, so the snapping rule is tested independently of the fixture ambiguity.

This directly addresses the current fixture inconsistency: `loop-with-branch-90.json` attaches at `fraction: 0.25` of a 360 m loop, but its first point is `[20, 0]`. The kernel should make the authoritative rule explicit and test it.

### R3 — Add a junction audit mode to the inspector

The current inspector already reports boundary edges, non-manifold edges, T-junctions, degenerates, and overlaps. Extend it for M1 with:

- a **region area audit** (asphalt + dirt + grass = scene rectangle area) so a hidden overlap or gap fails numerically as well as visually;
- a **boundary provenance overlay** that colors main outer boundary, main inner boundary, branch boundary, junction stitch, and outer scene perimeter differently;
- a **junction close-up mode** that isolates the attachment and draws edge-adjacency counts, face normals, and boundary vertices with welded-id labels;
- a **deterministic audit JSON export** containing counts, area totals, tolerance, and file hashes, so the 30/45/90 acceptance runs leave reviewable artifacts;
- a **collision overlay diff** that reports whether the collision mesh is exactly the visual mesh, rather than only drawing it.

These are inspection features, not new authoring scope.

## 4. Five pitfalls with citations

### P1 — Raw offsets self-intersect at tight curves and sharp corners

Offsetting a polyline by a distance larger than the local radius of curvature creates loops. The standard fix is to detect and clip self-intersections, or use a clipper with robust offset/join handling. Track-ed's current miter offset is safe for the convex loop fixture, but M1 branch junctions and sharp authored points will hit this.

Sources: [Offset curves and self-intersection removal — Math StackExchange](https://math.stackexchange.com/questions/2208468/self-intersection-removal-in-offset-curves); [Clipper2 offset discussion](https://github.com/AngusJohnson/Clipper2/discussions/738); [u-geometry offset docs](https://docs.rs/u-geometry/latest/u_geometry/offset/index.html).

### P2 — Independent tessellation creates T-junctions and hairline cracks

When two adjacent regions have the same boundary positions but different vertex sets along that boundary, a vertex from one side lies on the interior of the other side's edge. That is a T-junction and produces cracks under animation or rounding. Shared boundary vertices and "subdivide both sides together" are the standard fixes.

Sources: [Planetary Terrain — T-junctions and stitching](https://ralith.com/blog/planetary-terrain/); [trimesh.remesh — shared midpoints preserve watertightness](https://trimesh.org/trimesh.remesh.html); [Terrain crack removal paper](https://www.scitepress.org/Papers/2019/77030/77030.pdf).

### P3 — Layered road-over-terrain surfaces cause z-fighting and hide topology

The OpenDRIVE/OpenSceneGraph thesis describes a "double road method": a second overlapping road layer is placed over the junction to hide seams, and the authors explicitly note face flickering and depth-test problems. EasyRoads3D and TerraPath also document terrain poking through roads or double geometry when conforming fails. A single welded graph avoids this class of bug.

Sources: [OpenDRIVE visualization thesis](https://gupea.ub.gu.se/server/api/core/bitstreams/9a1d8020-55ec-489e-bad2-f8b10da372a8/content); [TerraPath product notes](https://granddesigns.gumroad.com/l/terrapath); [EasyRoads3D terrain tutorial](https://www.easyroads3d.com/tutorials/terrain.php).

### P4 — Logical junction connectivity is not a watertight surface

OpenDRIVE junctions define lane connectivity through connecting roads. They do not force connecting roads to have consistent elevation or to cover the junction area. Antemotion documents overlapping connecting roads with different elevations and missing junction surfaces, and ASAM added junction CRG surfaces to address detailed junction elevation. track-ed must treat topology and surface as separate artifacts that are both validated.

Sources: [Antemotion — Solving junction inconsistency](https://www.antemotion.com/blog/pw-solving-junction-inconsistency/); [ASAM OpenDRIVE junction CRG surface](https://publications.pages.asam.net/standards/ASAM_OpenDRIVE/ASAM_OpenDRIVE_Specification/v1.9.0/specification/12_junctions/12_12_junction_crg_surface.html).

### P5 — Axis, winding, and game-format conventions leak into the neutral core

glTF is right-handed, +Y up, and defines the asset front as +Z; front faces are CCW. track-ed's coordinate contract uses +Y up and -Z forward, and the Lapster profile applies no conversion. AC expects FBX/KN5 with named physical materials; rF2 expects 3ds Max gMotor materials and GMT/SCN/MAS structures. These are consumer conventions, not track geometry. They must stay in the export profile or in a declared, tested coordinate conversion.

Sources: [glTF 2.0 coordinate system](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html); [AC Tools Blender add-on](https://extensions.blender.org/add-ons/ac-tools/); [rFactor 2 track structure](https://docs.studio-397.com/display/DG/Track+Structure).

## 5. Permissively licensed code worth studying

| Library | License | Use | Compatibility / notes |
| --- | --- | --- | --- |
| [`earcut`](https://github.com/mapbox/earcut) | ISC | Polygon triangulation with holes; already used by the kernel | Compatible; attribution required |
| [`polygon-clipping`](https://github.com/mfogel/polygon-clipping) | MIT | 2D boolean union/intersection/difference | Compatible; JS/TS; evaluate performance and edge cases on 30/45/90 fixtures |
| [`Clipper2`](https://github.com/AngusJohnson/Clipper2) | Boost-1.0 | Robust polygon clipping, offsetting, triangulation | Compatible; C++/C#/Delphi; TypeScript ports exist but verify maintenance |
| [`poly2tri`](https://github.com/jhasse/poly2tri) | BSD-3-Clause | Constrained Delaunay triangulation | Compatible; useful when holes/constraints exceed what earcut handles |
| [`CDT`](https://github.com/artem-ogre/CDT) | MPL-2.0 | Constrained Delaunay triangulation in C++ | File-level copyleft; compatible as a separate library but modifications to MPL files must remain MPL |
| [`libtess2`](https://github.com/memononen/libtess2) | SGI-B-2.0 | GLU-style tessellation, winding rules, self-intersection handling | Permissive and compatible with attribution; C/C++ |
| [`trimesh`](https://github.com/mikedh/trimesh) | MIT | Mesh validation, watertightness, remeshing | Compatible; Python, useful for offline audits, not browser runtime |
| [`manifold`](https://github.com/elalish/manifold) | Apache-2.0 | Watertight boolean and mesh robustness | Compatible; heavier; possible WASM path if 3D booleans become necessary |
| [`three-bvh-csg`](https://github.com/gkjohnson/three-bvh-csg) | MIT | 3D CSG for three.js | Compatible, but three.js-coupled and not the v0 approach; avoid for planar kernel work |
| [`glTF-Validator`](https://github.com/KhronosGroup/glTF-Validator) | Apache-2.0 | Validate exported GLB | Compatible; good candidate for an export CI check |
| [`glTF-Transform`](https://github.com/donmccurdy/glTF-Transform) | MIT | glTF editing, inspection, and validation helpers | Compatible; fallback if the custom GLB writer grows |

Licenses to avoid for copied code:

- **Triangle** — free for research, but commercial inclusion requires a license ([source](https://www.cs.cmu.edu/~quake/triangle.html)).
- **Blender add-ons / Blender itself** — GPL; do not copy code into track-ed.
- **SUMO** — EPL-2.0 OR GPL-2.0-or-later; do not copy code into an MIT/Apache-2.0 project without a deliberate license decision.

## 6. Terms and search leads

- **Planar arrangement / DCEL** — the general data structure for splitting overlapping rings and extracting faces.
- **Constrained Delaunay triangulation (CDT)** — triangulation that preserves required boundary edges.
- **Polygon offsetting** — miter, round, bevel, square joins; miter limit; self-intersection cleanup.
- **Boolean union / difference / intersection** — road footprint union and terrain-minus-road.
- **T-junction, hanging node, boundary stitching, conforming mesh** — the failure modes and fixes for cracks.
- **Weld tolerance, vertex snapping, fixed-point geometry** — practical robustness techniques for watertight meshes.
- **Boundary representation (B-rep), half-edge mesh, non-manifold edge** — validation vocabulary.
- **Watertight / manifold / orientable mesh** — inspector and export guarantees.
- **ASAM OpenDRIVE, ASAM OpenCRG, RoadXML** — neutral road-network and surface standards.
- **SUMO `netconvert`, junction `shape`, internal lanes** — network conversion and junction topology.
- **Assetto Corsa `KN5`, `KsEditor`, `surfaces.ini`, `ui_track.json`** — consumer-specific pipeline terms.
- **rFactor 2 GMT, SCN, MAS, MFT, gMotorMaterial** — consumer-specific pipeline terms.
- **GLB, glTF 2.0, glTF-Validator, `KHR_materials_*`** — export format and validation.
- **Road Architect dynamic intersections, EasyRoads3D crossings, RoadRunner junction editor** — authoring UX references.

## 7. Scope conflicts

| Recommendation / source idea | v0 status |
| --- | --- |
| Terrain conforming, embankments, heightfields (EasyRoads3D, MRoadGen, TerraPath) | Deferred. v0 is flat at `y = 0`. |
| Lane-level junction logic, traffic rules, internal lanes (OpenDRIVE, SUMO) | Out of scope. v0 has one branch attachment, not a lane network. |
| Bridges, overpasses, multi-level crossings (RoadArchitect, MRoadGen) | Deferred. Not part of v0. |
| Multiple branches, roads, loops, and shared sections | Deferred. v0 is one loop plus zero or one branch. |
| Additional game exporters (AC, rF2, etc.) | Deferred. v0 ships only `lapster-glb-track@1`; no exporter registry or plugin system. |
| Direct `.sima` writing or pack conversion | Out of scope. Lapster's asset compiler owns that. |
| Real-time physics, traffic simulation, gameplay runtime | Out of scope. |
| Using GPL/EPL code or Triangle | Not compatible with track-ed's license without a deliberate change; use concepts or permissive alternatives. |
| Using the double-road/layered junction approach | Conflicts with the single welded surface graph requirement; avoid. |

The research therefore supports the current architecture: keep `BakedTrack` consumer-neutral, keep junction geometry in the kernel, keep Lapster naming in the export profile, and use the inspector as the proof surface. The main new work for M1 is a robust planar arrangement plus an explicit junction audit, not a broader feature set.
