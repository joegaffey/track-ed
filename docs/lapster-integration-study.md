# Study: Making track-ed tracks driveable in Lapster prod

Status: implemented on coordinated feature branches. Date: 2026-11-19.

Input: the discussion about replacing the Lapster editor with track-ed, embedding track-ed as a second editor option, browser-side `.sima` compilation, and test-drive/export/import paths.

Implementation status:

- Phase 0: byte-based GLB track compiler extracted to `track-pack`, with a lazy `track-pack-wasm` browser build.
- Phase 1: Lapster `web/track-import/` accepts `track.json` + `track.glb`, compiles in the browser, stores the local pack, and opens Test drive.
- Phase 2: track-ed is embedded as a pinned submodule at `web/track-ed-src` and copied to `/web/track-ed/` during the Pages build.
- Phase 3: hosted track-ed shows **Test drive in Lapster**; standalone builds remain export-only.
- Phase 4: legacy editor retained as **Legacy Track Editor** while track-ed is made the primary editor entry point.

## 1. Purpose

Define the smallest credible path to:

- keep standalone track-ed as an **export-only** tool at `/track-ed/`;
- integrate track-ed into Lapster at `/lapster/` as the eventual editor replacement;
- make locally authored tracks **test-drivable** when track-ed is part of Lapster.

Standalone track-ed does not need a Test drive action. It exports `track.glb` + `track.json`.

## 2. Current state

### track-ed

- Live at `https://joegaffey.com/track-ed/`.
- Exports `track.glb` + `track.json` only, using `lapster-glb-track@4`.
- Does not write `.sima`; Lapster owns the pack format.
- Has its own preview, validation, save/open, and export path.
- Uses relative Vite assets (`base: "./"`), so its built `dist/` can run under a Lapster subpath.

### Lapster

- Live at `https://joegaffey.com/lapster/`.
- Static GitHub Pages build assembled by `web/scripts/build-pages.sh`.
- Drive loads precompiled `LSIM` packs via `?track=<url>`.
- Built-in editor Test drive already works:
  - `editor_track_pack()` is exposed from wasm (`crates/sim-render/src/lib.rs:473`).
  - It packages the built-in editor's `EditorTrack` via `pack_from_track()` (`crates/sim-render/src/track_editor.rs:2871`).
  - `pack_from_track()` archives `TrackVisual`, `TrackCollision`, and `TrackMetadata`, then calls `sim_asset::write_pack`.
  - The pack is stored in IndexedDB under `lapster.editor-track.v1`.
  - Drive opens with `?track=editor` and reads that key.
- `/track-ed/` and `/lapster/` are separate GitHub Pages subpaths but share the `joegaffey.com` origin, so IndexedDB and same-origin wasm loading are available.

## 3. Problem statement

Track-ed produces a GLB bundle. Lapster drive needs an `LSIM` pack. There is currently no production path from one to the other.

The critical missing piece is:

```text
track.glb + track.json
  -> GLB track import
  -> TrackVisual + TrackCollision + TrackMetadata
  -> sim_asset::write_pack
  -> IndexedDB / drive
```

## 4. Key finding: most of the pack path already exists

The existing editor already has the browser-side pack writer and Test drive flow. It is reusable.

What is missing is only the **GLB track importer in wasm**:

- The built-in editor builds an `EditorTrack` from Lapster's own procedural project model.
- It cannot ingest track-ed's GLB.
- `crates/asset-compiler/src/glb_track.rs` has the native GLB importer, but it is path-based and filesystem-oriented.
- `gltf 1.4.1` provides `gltf::import_slice`, so a byte-based importer is feasible.

## 5. Options

| Option | Scope | Effort | Notes |
|---|---|---:|---|
| A. Precompiled `.sima` import | Lapster drive file input for `.sima` only | 1–2 days | Developer-prepared tracks only; not an author-to-drive workflow |
| B. GLB+JSON import + browser compile | Drive or new page accepts `track.glb` + `track.json`, compiles in wasm | 2–4 days | Recommended first user-facing step; no track-ed embedding |
| C. Embed track-ed as second editor | Submodule/build track-ed into Lapster Pages, second menu option | 0.5–1 day | No Test drive by itself |
| D. C + B integrated | Track-ed inside Lapster + Test drive using the new compiler | 4–6 days total | Working test-drivable second editor |
| E. Replace built-in editor | Remove old editor route and migrate navigation | D + 1–2 days | After D is proven |

### Compiler placement choices

#### A. Add `compile_glb_track` to the existing `sim_render` wasm

- Reuses the wasm package, pack writer, IndexedDB flow, and Test drive path.
- No second wasm build/version pipeline.
- Risk: `gltf` + `image` grow the main wasm for all viewers.
- Recommended for the first spike; measure size and startup impact.

#### B. Separate lazy `track-pack-wasm`

- Keeps `sim_render` lean.
- Better foundation if track-ed becomes the permanent editor.
- Requires a second wasm build, Pages copy, and versioning path.
- Roughly 1–2 extra days versus A.

## 6. Recommended path

### Phase 0 — Wasm compiler spike (0.5–1 day)

- Refactor GLB track import to accept bytes: `track.json` + `track.glb`.
- Use `gltf::import_slice`.
- Add a wasm entry point that returns pack bytes.
- Reuse `sim_asset::write_pack`.
- Measure wasm size and compile latency.
- Decide: add to `sim_render` or extract a lazy wasm.

### Phase 1 — File-based Test drive (1–2.5 days)

- Add an import UI accepting:
  - `track.glb` + `track.json`, or
  - a zip bundle.
- Compile in browser.
- Store the pack under a new `track-ed` key or reuse `editor`.
- Open drive with the existing pack-loading path.
- Add clear errors and progress.

### Phase 2 — Embed track-ed as second editor (0.5–1 day)

- Add track-ed as a pinned git submodule in Lapster.
- Build it in the Pages workflow.
- Copy `dist` to `dist/web/track-ed/`.
- Add a second editor card.
- Keep `/web/track-editor/` unchanged.

### Phase 3 — Integrated Test drive (0.5–1 day)

- Add a host/build flag to track-ed, for example `VITE_LAPSTER_HOST=1`.
- Standalone build remains export-only.
- Hosted build enables Test drive:
  - compile the current export,
  - store the pack in IndexedDB,
  - open `/lapster/web/drive/?track=track-ed`.
- Add `track-ed` local pack support in drive.

### Phase 4 — Replace the built-in editor (1–2 days)

- Make track-ed the primary editor route.
- Keep the legacy editor for one release if needed.
- Remove the old editor route/nav after validation.
- Audit whether `crates/sim-render/src/track_editor.rs` is still needed for default/generated tracks before deleting editor-only Rust code.

Estimated effort to a working, test-drivable second editor: **4–6 engineer-days**.

Estimated effort to replace the built-in editor: **5–8 engineer-days**.

## 7. Technical design notes

### Compiler API

```text
compile_glb_track(track_json_bytes, glb_bytes, id) -> LSIM bytes
```

- Deterministic hash over the two input files, not the directory tree.
- The native CLI should use the same byte-based library for parity.
- Return warnings and errors to the UI.

### Local pack IDs

- Preferred: new `track-ed` ID and key `lapster.track-ed.v1`.
- Keeps the built-in editor and track-ed isolated during transition.
- Generalize drive's existing `loadEditorTrackPack()` into a local-pack loader.

### Deployment

- Standalone `/track-ed/`: export only.
- Integrated `/lapster/web/track-ed/`: Test drive enabled.
- A submodule pin gives Lapster a reproducible editor build.
- The Pages workflow must checkout submodules recursively.
- The Pages build must run track-ed `npm ci` + `npm run build`.
- Track-ed content-hashed assets handle cache-busting; compiler wasm still needs a versioned path.

### Same-origin and isolation

- `/track-ed/` and `/lapster/` are same-origin.
- Integrated track-ed under `/lapster/` shares IndexedDB with drive.
- Track-ed does not need SharedArrayBuffer, but it will run under Lapster's service-worker/COOP-COEP scope; same-origin assets should be fine. Verify in the Pages artifact.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `gltf`/`image` wasm build problems | Spike early; fall back to separate lazy wasm or JS importer |
| Main wasm size grows too much | Place the compiler in a lazy wasm package |
| Native/wasm pack mismatch | Shared byte-based library; parity test on fixtures |
| Source hash differs by path | Hash input bytes, not the directory tree |
| IndexedDB quota or stale packs | Delete/replace by key; show pack size |
| Two-file UX is awkward | Offer a zip bundle |
| Submodule build/CI drift | Pin the commit; document the bump process |
| Service worker or caching issues | Test the Pages artifact under `/lapster/web/track-ed/` |
| Geometry mismatch with built-in editor | Do not convert editor projects; compile track-ed GLB directly |

## 9. Open decisions

1. First import UX: two files or zip?
2. Compiler placement: existing `sim_render` wasm or lazy separate wasm?
3. Local pack: reuse `editor`/`lapster.editor-track.v1`, or add `track-ed`?
4. Do imported tracks persist across reloads, or one-shot only?
5. When should the built-in editor route be removed?
6. Do we need shareable/published tracks later, or is local Test drive + export enough?

## 10. Conclusion

The effort is much smaller than a from-scratch browser compiler because Lapster already has a wasm pack writer and Test drive pipeline. The real remaining work is the **byte-based GLB track importer**.

Recommended sequence:

1. Spike GLB import in the existing wasm and measure cost.
2. Ship file-based GLB+JSON Test drive without embedding track-ed.
3. Embed track-ed as a second editor via submodule.
4. Enable Test drive in the hosted track-ed build.
5. Replace the built-in editor once the integrated path is proven.

That gives a working test-drivable editor in roughly **4–6 days**, with a low-risk fallback at every stage.
