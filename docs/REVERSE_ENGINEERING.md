# How the Goodnotes web app works: evidence

**Target:** the public Goodnotes web client, `https://web.goodnotes.com/`, captured 2026‑11‑17.
Goodnotes is not installed on this Mac, so the shipped web build was the artifact analyzed.
**Method:** the `reverse-engineer-anything` (REA) skill. REA's CLI fallback
(`rea-agents@6.9.0 analyze-javascript-application`) built a static graph of the JavaScript bundle.
A custom WebAssembly section parser read the 75 MB core module. Targeted string searches covered both.
Nothing was executed; all analysis was static, on inert text and bytes.

Labels used below:
- **Observed:** read directly from the shipped bytes.
- **Inferred:** a conclusion drawn from observed facts.
- **Unknown:** not established.

## Captured artifacts (SHA‑256)

| Artifact | Size | SHA‑256 |
|---|---|---|
| `index.html` | 3.5 KB | `11d767af…6d439` |
| `WASMGoodNotesApp-DLgKTDYn.wasm` | 74.6 MB | `022f23d2…7db1b` |
| `index-CsFI-7i5.js` (React host) | 1.1 MB | `bff57c27…b00ba0` |
| `swift-wasi-thread-worker-DeXZH0Fu.js` | 2.7 MB | `3d19a2f5…948ca7` |
| `sqlite3-opfs-async-proxy-lsG_Y_EB.js` | – | `fc2a3621…ee88e9f` |
| `hws-onnx-worker-Csn7klpG.js` | 750 KB | `a49878e9…a62d5` |

The full capture has 324 files and 185 MB. The REA Evidence ID is
`ev_d7337101ca715a65e4cff6f3e6f2a9198dd720f8d38962833cc112619f253650`.
It covers 313 files, 594 modules and 6,394 graph nodes.
The WASM import and export tables are saved in [`evidence/wasm-imports-exports.json`](evidence/wasm-imports-exports.json).

---

## 1. The app is Swift compiled to WebAssembly, inside a thin React shell

**Observed**
- `index.html` preloads `/assets/WASMGoodNotesApp-DLgKTDYn.wasm` before any UI loads.
- The WASM `target_features` section lists `atomics`, `bulk-memory`, `mutable-globals` and `simd128`.
  The producers section names `clang 21.0.0 (swiftlang/llvm-project)`.
- WASM imports come from `wasi_snapshot_preview1` (35 functions), `wasi.thread-spawn`, and
  `javascript_kit` (`swjs_*`). JavaScriptKit is the SwiftWasm library that bridges Swift and JavaScript.
  There are also 77 `bjs` bridge functions, such as `make_swift_closure_WASMGoodNotesLibrary_…`.
- Swift runtime strings appear, including Swift 6.2 `isIsolatingCurrentContext` executor text.
  A `swift-demangler` bundle ships alongside.
- The host UI is React: `react-dom`, `react-router`, `@tanstack/react-query`, `zustand` and `redux` appear in the bundles.

**Inferred:** Goodnotes reuses its native Swift editor engine on the web. The engine is compiled to
`wasm32-wasip1-threads`. React supplies only the chrome around it: library screens, dialogs and menus.
Workers named `swift-wasi-thread-${tid}` back Swift's threads.

## 2. Swift drives the browser APIs directly; the engine owns rendering and input

**Observed:** the WASM imports hand-written binding modules for browser objects:
- `goodnotes_webgl2_context`: 119 functions, including `drawElementsInstanced`, `texStorage3D`, `fenceSync` and `renderbufferStorageMultisample`.
- `goodnotes_context2d` (80 functions), `goodnotes_path2d`, `goodnotes_offscreen_canvas` and `goodnotes_canvas.transferControlToOffscreen`.
- `goodnotes_pointer_event`: `pressure`, `tangentialPressure`, `tiltX`, `tiltY`, `twist`, `pointerType`, `width` and `height`.
- `goodnotes_interaction_container`: `createPageContainer`, `updateInteractionLayerPageFrame`, `updatePageFrameInfo` and related functions.
- 59 GLSL `#version 300 es` shaders sit in the data segment. Their attributes include
  `iSegmentIndices`, `iModelFrame`, `modelSegmentAABB`, `modelSegmentOBB` and `uAtlasTexture`.
  Their uniforms include `uStrokeCount`. Strings also include `pencilStampAtlasLoader`, `startStampData`, `tapeSignedDistanceAt`, `pdfTilesCache` and `TilesRenderingReport`.
- In `index-CsFI-7i5.js`, the host builds a `WasmPointerEvent`. It attaches
  `getCoalescedEvents()` and `getPredictedEvents()` samples, then passes it into Swift.
  A `configureApplePencilScribbleHack()` function is also present.

**Inferred:**
- Ink is drawn on the GPU with WebGL2, using instanced segments and per-segment bounding boxes.
- Pencil texture comes from stamped atlases. Tape uses signed-distance shapes.
- PDFs render as cached tiles.
- Each page has its own interaction layer.
- Coalesced events recover the stylus's full sample rate. Predicted events hide latency.

## 3. Storage is local-first and event-sourced: SQLite on OPFS, inside the WASM

**Observed**
- The WASM exports the SQLite C API: `sqlite3_open_v2`, `sqlite3_prepare_v2`, `sqlite3_step` and the `sqlite3_bind_*` functions.
- The JS ships the official `sqlite3-opfs-async-proxy`, which serves synchronous OPFS I/O through `SharedArrayBuffer` and `Atomics`.
  It also calls `createSyncAccessHandle` and `navigator.storage.getDirectory`.
- SQL fragments in the data segment:
  `DELETE FROM events WHERE aggregate_id IN (…`, `SELECT attachment_id, asset FROM events`,
  `FROM events WHERE event_id = ?`, `SELECT DISTINCT stream FROM indexed_events`,
  `SELECT aggregate_id, is_tombstoned, parent_id FROM tombstones`, `DELETE FROM stream_metadata`,
  `INSERT INTO gn_migrations (name) VALUES (?)` and `CREATE INDEX tombstones_parent_id ON …`.
- The host event surface includes `onEventsSaved`, `onSyncEventsSaved`, `onSyncEventsSynced`,
  `onSyncNotesAttempted` and `onDocumentConsistencyCheck`.

**Inferred:** each document is an aggregate with an append-only event stream, stored locally first
and synced later. Deletion uses tombstones, which is how "Trash" and recovery work.
The editor exports `tombstoneDocument`, `recoverDocument` and `trashPage`.

**Unknown:** the exact table DDL. It is assembled at runtime by Swift string interpolation, so no literal `CREATE TABLE events (…)` exists in the binary.

## 4. Collaboration uses a CRDT (Automerge) plus a real-time socket

**Observed**
- `automerge-swift` Rust sources are compiled into the same WASM, including `doc.rs`, `sync_state.rs` and `change_hash.rs`.
  A UniFFI binding path for `wasm32-wasip1-threads` is present.
- Socket endpoints include `wss://api.goodnotescloud.com/rtc/ws` and `/notifications/ws`.
  Paths include `/v2/gnc-rtc/connect` and `/v2/gnc-rtc/subscribe/…`.
  JS also contains the `centrifuge` client.
- The `JSRTCSocket_*` bridge exposes `subscribeToRTC`, `registerPublicationListener`, waiting rooms and `getPresenceStats`.
- REST paths include `/v3/documents`, `/v3/bootstrapDocument`, `/v3/me/library/documents` and `/v3/import/multipart/*`.

**Inferred:** shared and real-time documents merge through Automerge. Presence and change notifications travel over a
Centrifugo-style pub/sub socket. Note that Yjs also ships, but it is wired to a rich-text editor plugin
(`YjsPlugin`, `Y.Doc not initialized`), not to the ink model.

## 5. On-device ML for handwriting and gestures

**Observed:** ONNX Runtime WASM (`ort-wasm-simd-threaded.jsep.wasm`, 21 MB) runs in workers named
`hws-onnx-worker`, `onnx-scribble-to-erase-worker` and `onnx-worker`. Model names include
`HWRecognitionLSTM_latin.onnx`, `HWBulletDetectionLSTM.onnx`, `layout_clf_prod.onnx` and `scribble-v1-*.onnx`.
Editor exports include `convertStrokesToText` and `convertStrokesToLaTexMath`. Events include
`onScribbleToEraseApplied`, `onCircleToLassoCompleted`, `onLineDrawn` and `onDefinedShapeDrawn`.

**Inferred:** the following run locally in the browser:
- handwriting recognition, used for search and convert-to-text
- scribble-to-erase
- circle-to-lasso
- shape recognition

## 6. The editor API boundary

**Observed:** `GNWasmEditorBridge_*` exports 144 commands, including:
- `selectTool`, `changeStrokeWidth`, `changeStrokeColor`, `undo` and `redo`
- `goToPage`, `setDocumentScale`, `zoomToFit` and `moveViewport`
- `renderThumbnail`, `sync`, `wentOffline` and `backOnline`
- `setMaxEditorsInMemory` and `unloadDocument`

In the other direction, Swift raises 78 events into JS through `goodnotes_events`.

**Inferred:** the shell and the engine talk through a narrow command-and-event API. Off-screen documents and pages are unloaded to bound memory.

---

## What is *not* established
- Server-side behavior and the sync protocol's wire format. Nothing was observed at runtime.
- The `.goodnotes` file layout. The manifest registers `application/x-goodnotes`, but no file was inspected.
- The REA graph is incomplete by its own report. The semantic budgets were exhausted on the largest
  `startup-render-*` chunks, and its "endpoint candidates" are dominated by MathML and SVG attribute names.
  The conclusions above rely on the WASM tables and targeted string evidence rather than those candidates.

## How J Notes maps to this

| Goodnotes (observed) | J Notes (this repo), a deliberate simplification |
|---|---|
| Swift engine in WASM, React shell | Framework-free TypeScript core (`src/core`) and a React shell (`src/ui`) |
| Event-sourced SQLite on OPFS, tombstones | Event-sourced IndexedDB with snapshots and compaction (`src/storage`); trash via `trashedAt` |
| Per-page interaction layer | Per-page base canvas plus a live "wet ink" canvas (`PageView.tsx`) |
| Coalesced and predicted pointer events, pressure and tilt | Same: coalesced and predicted samples, pressure, stylus-only mode |
| WebGL2 instanced ink, stamp atlases | Canvas2D with `perfect-freehand` outlines cached as `Path2D` |
| Shape recognition (`onLineDrawn`) | Hold-to-straighten line snapping (`core/shapes.ts`) |
| Automerge and RTC sync, ONNX handwriting | Not implemented; see the roadmap in the README |
