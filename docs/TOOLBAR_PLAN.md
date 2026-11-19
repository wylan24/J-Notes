# Toolbar feature plan

This plan brings the J Notes toolbar up to the full Goodnotes-style tool set.
It was written on 2026-11-17 after comparing the app with the reference tool list.

## Status

| Tool | Status | Have | Missing |
|---|---|---|---|
| Pen | 🟡 Partial | Pen that responds to pressure, colour and width presets | Ball pen and brush pen styles; tip sharpness setting |
| Eraser | 🟡 Partial | Erases whole strokes, fixed 10px radius | Size options; erasing part of a stroke; "erase highlighter only" option |
| Highlighter | 🟡 Partial | Freehand highlighting that blends with multiply; hold-to-straighten | Straight-line mode; highlights are drawn in the order they were made, so they don't sit behind handwriting |
| Shapes | ✅ Done | Shapes tool and pen hold-to-snap recognise lines, circles, ellipses, rectangles, triangles, polygons (up to 8 sides) and arrows | Filled shapes; arrows drawn in two strokes |
| Lasso | ✅ Done | Move, duplicate, recolour, delete, resize, rotate, convert handwriting to text | |
| Elements | ✅ Done | Save a lasso selection; tap or drag onto any page of any notebook; rename, delete | Folders or search; export/import of the library |
| Text box and photos | ✅ Done | Text boxes with font, size and colour; photos by picker, paste or drop, moved and resized | Rotating photos; cropping |
| Zoom window | ✅ Done | Docked magnified panel, movable target box, moves along the line and wraps to the next | Erasing and selecting inside the panel |
| Ruler | ✅ Done | Move, two-finger/wheel/knob rotation snapping to 45°, pen and highlighter snap to either edge | Measuring lengths in the panel |
| Laser pointer | 🔴 Missing | | |
| Audio recording | ✅ Done | Record with pause, ink linked to the audio, playback fades unreached ink, tap ink to replay | Renaming recordings; per-word (rather than per-stroke) highlighting |
| Timer and stopwatch | ✅ Done | Stopwatch with laps, countdown with presets, alert and chime, history | With two tabs open, a finished countdown can be recorded twice |
| Sticky notes | ✅ Done | Five colours, collapse to an icon, resizable | |
| Toolbar customisation | ✅ Done | Reorder, show/hide, reset; buttons that don't fit go into a More menu | Syncing the layout between devices |

A page can currently hold only strokes (`Page.strokes`). Text, photos, sticky notes and elements need
a second kind of page content, which Phase 0 adds. `DocumentStore.dispatch` already takes a list of
operations, so a single undo step can contain several changes.

## Phases

### Phase 0: Foundation (blocks Phases 4–7) ✅ Done 2026-11-17
1. Add `Page.items: PageItem[]`, where an item is a text box, image or sticky note. Pages saved before this change get an empty list.
2. Add `items.added`, `items.removed` and `items.updated` operations. Each update stores the previous values so it can be undone.
3. Add a `blobs` store to IndexedDB for images and audio. Export to `.jnotes.json` with the files embedded as data URLs.
4. Add an optional timestamp `t` to each stroke point, for audio sync.
5. Generalise the lasso selection to cover both stroke IDs and item IDs.
6. Tests: undo/redo round-trips for the new operations, and loading pages saved in the old format.

What was built:
- `PageItem` is a text box, image or sticky note, with page-unit geometry `x, y, w, h`. `normalizePage` and
  `normalizeDoc` give old pages an empty `items` list. Normalising happens when snapshots load, when logged
  `page.added` events replay, and on import, so old event logs keep working.
- `items.updated` changes one item. `updateItemOp` records the old value of each patched field, and a field that was
  absent comes back absent on undo. Helpers: `removeItemsOp` and `updateItemOp` in `ops.ts`.
- IndexedDB version 2 adds a `blobs` store keyed by `[docId, id]`, holding `{ type, bytes: ArrayBuffer }`.
  Upgrading a version 1 database keeps all existing data. Deleting a notebook deletes its blobs.
  Unreferenced blobs (an image deleted and never restored) are not cleaned up yet; export skips them.
- `.jnotes.json` version 2 embeds referenced blobs as base64 data URLs. Version 1 files still import.
- `InputPoint.t` is defined and survives moving strokes and partial erasing (it is interpolated at cuts).
  Nothing sets it until Phase 7.
- Selection is now `{ pageId, strokeIds, itemIds }`, and its logic lives in `core/selection.ts`. Items are selected
  when their centre is inside the lasso. Move, duplicate and delete each cover both kinds in one undo step.
  Recolour applies to strokes only.
- Items are not drawn yet; Phase 4 adds rendering and the UI that creates them.
### Phase 1: Quick ink wins (no model changes beyond optional stroke fields) ✅ Done 2026-11-17
1. **Laser pointer:** an overlay that fades and is never saved.
2. **Pen styles:** fountain, ball and brush pens set different stroke options. A tip sharpness slider for the fountain pen.
3. **Highlighter:** draw highlights in a pass underneath pen ink, and add a straight-line toggle.
4. **Eraser:** a size picker, an "erase highlighter only" filter, and partial erasing. Partial erasing splits a stroke into pieces and records the removal and the new pieces as one undoable step.

### Phase 2: Shapes ✅ Done 2026-11-17
Extend `shapes.ts` to recognise ellipses, rectangles, triangles, polygons and arrows. Store the result
as ordinary stroke points, so the eraser, lasso and undo keep working without changes. Add a dedicated
Shapes tool alongside hold-to-straighten. Write the recogniser test-first.

What was built:
- `recognizeShape` resamples the stroke and closes loops, trimming short overdraw. It then fits both an ellipse and a
  polygon, and keeps whichever fits better. Near-circles become circles, nearly axis-aligned shapes are straightened,
  and four roughly right angles become a true rectangle. Open strokes are tested for an arrow: a straight shaft with a
  head drawn at either end.
- The pen snaps to any shape on hold (the highlighter still only straightens). After snapping, lines and arrows follow
  the pen and closed shapes scale about their centre. The Shapes tool also recognises on lift, without a hold.
- Shape strokes carry an optional `shape: true` flag so they render without streamlining, which keeps corners sharp.
  An arrow is two strokes (shaft and head) added in one undoable step.

### Phase 3: Lasso ✅ Done 2026-11-17 (convert-to-text 2026-11-19)
Add resize and rotate handles, backed by a new `strokes.transformed` operation holding the transform matrix.
Convert-to-text came with the handwriting model (feature parity task 10.4): Convert to text… in the selection's More menu.

What was built:
- `strokes.transformed` holds a matrix `[a, b, c, d, e, f]` (as in canvas `setTransform`). It maps every point and
  scales stroke width by the transform's scale factor. Undo applies the inverse matrix, so coordinates come back
  exact to floating-point precision rather than bit for bit. The matrix maths is in `core/transform.ts`.
- Four corner handles scale the selection uniformly about the opposite corner. A handle above the selection rotates
  it about its centre, shows the angle, and snaps to multiples of 90° within 5°. The rotate handle only appears when
  the selection includes strokes.
- Items in a mixed selection scale with it (text boxes scale their font too). Items have no rotation of their own yet,
  so rotating carries them around the centre without turning them. A single selected item keeps its own resize
  handle from Phase 4.
- The preview draws strokes through the matrix on the live layer and items on the base layer, so items keep their
  place under or over the ink. Clearing the selection mid-gesture (Esc, undo) cancels it without committing.
### Phase 4: Text, photos and sticky notes ✅ Done 2026-11-17
1. **Text box:** an editable HTML layer positioned over the canvas, with font, size and colour options.
2. **Photos:** add images by file picker, paste or drag-and-drop. Stored in the blob store; can be moved and resized.
3. **Sticky notes:** a text item with a coloured background, several colour choices, and an option to collapse it to an icon.

What was built:
- Items are painted on the page canvas, so they appear in thumbnails and PNG exports. Layers, bottom to top:
  template, photos and text boxes, highlighter, pen, sticky notes. You can write on photos and text, and
  sticky notes cover ink.
- Text (`T`): tap paper to add a box, or tap a box to edit it. Editing uses a textarea over the canvas with the
  same font metrics; tapping away or pressing Esc commits. An emptied box is deleted. Layout lives in
  `core/items.ts` (`wrapLines`, `textHeight`), so the stored height matches what the canvas draws.
- Sticky notes (`N`): tap to add or edit, and tap a collapsed note to expand it.
- Photos: the toolbar button, paste, or drag and drop onto a page. Photos larger than 2400px are scaled down
  before storing. They are placed at the drop point or the middle of the visible page, then selected.
  `render/items.ts` decodes images from the blob store once per session and repaints pages when they arrive.
- Tapping with the lasso selects the item under the pen. With one item selected, a corner handle resizes it:
  photos keep their aspect ratio, text boxes change width and re-wrap, sticky notes resize freely.
  The selection menu adds Edit, font, A−/A+ for text, and Collapse/Expand and colours for sticky notes.
  Recolouring also applies to selected text boxes.
- Keyboard shortcuts are ignored while typing in a text box or note.
- Not done: rotating or cropping photos, and rich text (bold, lists).
### Phase 5: Elements ✅ Done 2026-11-17
A global library in IndexedDB of saved selections (strokes and items). Save the current lasso
selection as an element, then drag one back onto a page, which adds its contents in a single step.

What was built:
- "Save as element" in the lasso menu stores the selection in a new IndexedDB `elements` store (database version 4).
  - Contents: strokes and items moved so the bounds start at (0, 0), audio timestamps dropped, and a thumbnail.
  - Photos: blobs are per notebook, so each element keeps its own copy of its photos' bytes. Placing it copies them
    into the target notebook, which means elements work across notebooks and survive deleting the source notebook.
  - Naming: an element is named after its first text, otherwise "Element n". Rename it from the panel.
- The Elements toolbar panel shows a thumbnail grid.
  - Adding: tap a tile to place a copy in the middle of the visible page, or drag it (with pointer events, so stylus
    and touch work) and drop it on any page. Dropping off the pages does nothing.
  - Placing: a copy gets fresh ids, is centred on the drop point and kept on the page, and is scaled down if bigger
    than the page (nib widths and font sizes scale with it). It is added in one undo step, then selected with the
    lasso so it can be moved or resized straight away.
  - Deleting: deleting an element leaves copies already on pages untouched.
- Logic is in `core/elements.ts` (`makeElementContent`, `placeElement`, `defaultElementName`).
- Not done: folders or search in the library, and exporting or importing the library.
### Phase 6: Precision tools ✅ Done 2026-11-17
1. **Ruler:** an overlay you can drag and rotate with two fingers. Pen strokes near its edge snap to it.
2. **Zoom window:** a magnified box docked at the bottom of the screen. Writing in the box is mapped back to page coordinates, with automatic advance along the line.

What was built:
- Ruler (`R`, or the toolbar): an overlay fixed to the screen, so pages scroll under it like paper.
  - Moving and turning it: drag it to move it. Two fingers move and turn it; the wheel or arrow keys turn it a degree
    at a time; the knob at its end points it. Double-click levels it.
  - It snaps to multiples of 45° within 1.5°. The unsnapped angle is kept, so small turns still add up past a snap.
  - Its centimetre and millimetre ticks follow the page zoom.
- Snapping: a pen or highlighter stroke that starts within 28px of either edge is drawn along that edge, keeping its
  pressure. The ink sits half a nib-width outside the edge so it touches the ruler.
  The geometry is in `core/ruler.ts`; PageView maps the edges from screen to page space when a stroke starts.
- Zoom window (`W`): a panel docked under the pages, magnifying a target box on the page (shown with a drag grip; ink
  passes through the box itself).
  - Writing: pen and highlighter strokes in the panel are mapped into the box.
  - Moving along: lifting in the shaded right quarter moves the box half its width along the line, after a short
    pause so a dot or cross doesn't jump. Past the page edge it wraps to the margin of the next line.
  - New lines: on ruled and grid paper the box moves down in whole line spacings, so it stays on the lines.
  - Buttons: back, forward, new line, and magnification (−/+).
  - Logic is in `core/zoomWindow.ts`; the panel uses the new `paintRegion` to render part of a page.
- Not done: erasing, lasso and Shapes inside the zoom window (it shows a hint for those tools), and measuring with the
  ruler. (The toolbar wrapping below about 1100px wide was fixed in Phase 9.)
### Phase 7: Audio recording ✅ Done 2026-11-17
Record with `MediaRecorder` into the blob store, and give strokes drawn during a recording timestamps
relative to it. Playback highlights strokes as the audio reaches them, and tapping a stroke jumps the audio to that moment.

What was built:
- `NotebookDoc.recordings` (absent on older notebooks) lists recordings, with `recording.added`/`recording.removed`
  ops so recording and deleting are undoable. The audio is in the blob store, and `.jnotes.json` exports and imports it.
- Recording: the microphone button opens an audio bar with Record, then Pause/Resume and Stop.
  - Format: Opus in WebM where supported, else MP4/AAC for Safari.
  - Linking: ink written while recording gets `Stroke.rec` and per-point `t` (ms into the audio, excluding paused
    time). This covers pen, highlighter, shapes (stamped with the freehand stroke's start), the ruler and the zoom window.
  - Leaving mid-recording: the browser warns, and going back to the library saves the recording first.
- Playback: play/pause, a scrubber, and a picker when there are several recordings. Once playback starts, ink from
  that recording that the audio hasn't reached is drawn faded, and fills in as it plays.
- With the audio bar open, tapping recorded ink plays from one second before it was written, rather than using the tool.
- Elements drop the link to a recording (`rec` and `t`), since it would mean nothing in another notebook.
- The sync logic is in `core/audio.ts`, the recorder in `ui/recorder.ts`.
- Not done: renaming recordings, and highlighting per word rather than per stroke.
### Phase 8: Timer ✅ Done 2026-11-17
A stopwatch and countdown in the UI only, with session history saved in IndexedDB. Independent of everything else.

What was built:
- `core/timer.ts` is pure state over wall-clock timestamps; nothing counts ticks. Elapsed time is exact in background
  tabs and across reloads. The running timer is kept in `localStorage` (`jnotes.timer`).
- The toolbar timer button shows the running time; its panel has Stopwatch (start, pause, lap, reset) and Timer
  (presets 5–60 min or custom minutes, with a progress bar).
- A countdown that reaches zero is saved as a completed session. An app-level watcher shows a "Time's up" alert and
  plays a chime whichever screen is open, and also when the app reopens after the time ran out.
  Audio is unlocked by pressing Start, so after a reload only the alert shows.
- Reset (or switching mode) saves the run as a session if it lasted at least a second. History lives in a new
  IndexedDB `sessions` store (database version 3), labelled with the notebook that was open when the run started,
  and survives deleting that notebook. The panel shows today's total and recent sessions, with Clear.
- Other open tabs follow start, pause and reset through the `storage` event. Known gap: if two tabs are open when a
  countdown ends, both may record it and chime.
### Phase 9: Toolbar customisation ✅ Done 2026-11-17
Save the tool order and any hidden tools as a preference, and add a settings sheet to reorder and show or hide tools.

What was built:
- `core/toolbarPrefs.ts` defines 14 customisable buttons: the 8 drawing tools plus ruler, zoom window, photo, audio,
  Elements and timer. Undo/redo, title, zoom, page and export buttons stay fixed.
  - Saving: the order and hidden list are kept in `localStorage` (`jnotes.toolbar`).
  - Repairing saved preferences: unknown and duplicate entries are dropped, and any button missing from the saved
    order (such as one added in a later version) goes back next to its default neighbour.
  - At least one drawing tool always stays visible.
- The Customise toolbar sheet (the sliders button) reorders by dragging a row's handle or with up/down buttons
  (keyboard friendly), shows or hides each button with a switch, and has Reset. Changes apply live.
  Hidden tools keep their keyboard shortcuts.
- Overflow: buttons that don't fit on one row move, in order, into a More (⋯) menu that shows their names.
  The More button is highlighted when the active tool is inside it. This fixes the wrapping noted in Phases 6 and 8:
  the toolbar is one row at every width tested (744–1440px). Elements and Timer panels open toward whichever side
  has room.
## Order

Phase 1 → 0 → 2 → 4 → 3 → 8 → 6 → 5 → 7 → 9. All phases are done, convert-to-text included.
