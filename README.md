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
- Lasso selection: move, resize, rotate (snapping to right angles), duplicate, recolor and delete. Tap an item with the lasso to select it and resize it with its handle.
- Smart Ink: lasso some handwriting and drag the side handles to rewrap it to a new width, or use
  Insert space, Straighten and Align from the selection's More menu. Words and lines are found from
  the ink alone; no recognition needed.
- Handwriting search (opt in under Settings → Handwriting): an on-device model reads each line in a
  worker after you pause, and search finds it in the notebook (highlighting the words) and in the
  library. The model is a one-time 70 MB download, then works offline.
- A Shapes tool that turns rough lines, circles, ellipses, rectangles, triangles, polygons and arrows into clean shapes.
  Anything it doesn't recognise stays as drawn.
- Hold to snap: with the pen, pause at the end of a stroke to snap it to a shape, then keep moving to adjust it.
  Lines and arrows follow the pen, and closed shapes scale.
- Text boxes with three fonts, three sizes and the pen colours; tap one to edit it.
- Sticky notes in five colours that sit above ink and collapse to a small icon.
- Photos from the toolbar, by pasting or by drag and drop. Write on them, move them, resize them.
- Audio recording linked to your ink: playback fades in the notes as they were written, and tapping ink replays that moment.
- A customisable toolbar: reorder and hide buttons; whatever doesn't fit goes into a More menu.
- Elements: save any lasso selection (ink, text, photos) to a library and drop copies into any notebook.
- A ruler you can move and turn, which pen and highlighter strokes snap to.
- A zoom window: write large in a magnified panel and the ink lands small on the page, moving along the line as you go.
- A timer and stopwatch in the toolbar, with laps, countdown presets, a "time's up" alert and a history of sessions.
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
| `S` | Shapes |
| `T` | Text |
| `N` | Sticky note |
| `R` | Ruler |
| `W` | Zoom window |
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
  model.ts    Notebook → Page → Stroke(points with pressure) + PageItem (text, image, sticky note)
  ops.ts      invertible DocOps + pure reducer (applyOp / inverseOp / replay)
  store.ts    DocumentStore: dispatch → apply → undo stack → sequenced DocEvents
  geometry.ts hit-testing (eraser), lasso, bounds
  erase.ts    partial erasing: split strokes and replace them in place
  items.ts    page item layout (text wrapping), hit-testing, sizing and factories
  audio.ts    linking ink to recordings: playback state, seeking from ink
  toolbarPrefs.ts toolbar order and hidden buttons, with repair of saved preferences
  elements.ts saved selections: normalise, name and place copies
  ruler.ts    ruler edges, snapping projection and rotation
  zoomWindow.ts zoom window target box: mapping, moving along the line, new lines
  timer.ts    stopwatch and countdown state over timestamps; sessions and summaries
  transform.ts affine matrices for resizing and rotating selections
  selection.ts lasso selection of strokes and page items: select, move, duplicate, delete
  shapes.ts   shape recognition (Shapes tool, hold to snap) → ordinary stroke points
src/storage   IndexedDB: meta | events[docId,seq] | snapshots | blobs[docId,id] | sessions | elements; Persister batches writes off the input path
src/render    perfect-freehand outlines → cached Path2D; page, template and item painting; decoded image cache
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
4. **Convert handwriting to text and spellcheck**, on the recognition that search already uses.
5. Page reordering, and an outline/thumbnail sidebar.
