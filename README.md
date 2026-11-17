# J Notes

J Notes is a local-first handwritten-notes web app for stylus, finger and mouse. Its architecture
follows what was learned from statically analyzing the Goodnotes web client; the evidence is in
[docs/REVERSE_ENGINEERING.md](docs/REVERSE_ENGINEERING.md). No Goodnotes code, assets or branding is used.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on your LAN for iPad testing)
npm test           # core and storage tests
npm run build      # typecheck and production build in dist/
```

## Features
- A library of notebooks: covers with live thumbnails, search, favourites, trash, restore and permanent delete.
- Paper templates: ruled, grid, dotted and blank.
- Three pen styles: fountain (pressure-sensitive, adjustable tip sharpness), ball and brush.
  Finger and mouse input get simulated pressure.
- A highlighter that always sits behind handwriting, with an optional straight-line mode.
- An eraser with three sizes, whole-stroke or partial erasing, and a "highlighter only" filter.
- A laser pointer that leaves a fading trail and is never saved.
- Lasso selection: move, duplicate, recolor and delete.
- Hold-to-straighten: pause at the end of a stroke to snap it to a line, then keep moving to adjust it.
- Undo and redo for every action, including erasing, moving and deleting pages.
- Stylus-only mode: fingers pan and pinch-zoom while only the pen draws.
  With it off, two fingers pan and zoom.
- Zoom with ⌘/Ctrl and the scroll wheel, a trackpad pinch, or the toolbar.
- Pages are virtualized, so only those near the viewport hold canvases.
- Export a page as PNG, or export and import a whole notebook as `.jnotes.json`.
- Everything is saved locally in IndexedDB as an event log, with periodic snapshots.

Shortcuts:

| Key | Action |
|---|---|
| `P` | Pen |
| `H` | Highlighter |
| `E` | Eraser |
| `L` | Lasso |
| `K` | Laser pointer |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘+` / `⌘−` / `⌘0` | Zoom in / out / reset |
| `Delete` | Delete the selection |
| `Esc` | Deselect |

## Architecture

```
src/core      pure TypeScript, no DOM, unit-tested
  model.ts    Notebook → Page → Stroke(points with pressure)
  ops.ts      invertible DocOps + pure reducer (applyOp / inverseOp / replay)
  store.ts    DocumentStore: dispatch → apply → undo stack → sequenced DocEvents
  geometry.ts hit-testing (eraser), lasso, bounds
  erase.ts    partial erasing: split strokes and replace them in place
  shapes.ts   line detection for hold-to-straighten
src/storage   IndexedDB: meta | events[docId,seq] | snapshots; Persister batches writes off the input path
src/render    perfect-freehand outlines → cached Path2D; page + template painting
src/ui        React shell: Library, Editor (toolbar, gestures, zoom), PageView (canvases + input)
```

Every edit is an invertible op. One op log drives three things:
- **Undo:** apply the inverse op.
- **Persistence:** append the op to IndexedDB.
- **Reload:** replay the log on top of the latest snapshot.

The same log is the natural place to add sync later.

## Roadmap (what Goodnotes has that this doesn't)
The toolbar plan, phase by phase, is in [docs/TOOLBAR_PLAN.md](docs/TOOLBAR_PLAN.md).

1. **Sync and collaboration.** Ship the event log to a server, or swap the reducer for a CRDT such as Automerge, as Goodnotes does.
2. **GPU ink.** Move rendering to WebGL2 or OffscreenCanvas in a worker, with tile caching for very dense pages.
3. **PDF import and annotation** with pdf.js; Goodnotes uses PDFium.
4. **Handwriting search and convert-to-text** with an on-device ONNX model in a worker.
5. Text boxes, images, shapes, page reordering, and an outline/thumbnail sidebar.
