# Toolbar feature plan

This plan brings the J Notes toolbar up to the full Goodnotes-style tool set.
It was written on 2026-11-17 after comparing the app with the reference tool list.

## Status

| Tool | Status | Have | Missing |
|---|---|---|---|
| Pen | 🟡 Partial | Pen that responds to pressure, colour and width presets | Ball pen and brush pen styles; tip sharpness setting |
| Eraser | 🟡 Partial | Erases whole strokes, fixed 10px radius | Size options; erasing part of a stroke; "erase highlighter only" option |
| Highlighter | 🟡 Partial | Freehand highlighting that blends with multiply; hold-to-straighten | Straight-line mode; highlights are drawn in the order they were made, so they don't sit behind handwriting |
| Shapes | 🟡 Partial | Straight lines via hold-to-straighten | Recognising ellipses, rectangles, triangles, polygons and arrows |
| Lasso | 🟡 Partial | Move, duplicate, recolour, delete | Resize, rotate, convert handwriting to text |
| Elements | 🔴 Missing | | |
| Text box and photos | 🔴 Missing | | |
| Zoom window | 🔴 Missing | | |
| Ruler | 🔴 Missing | | |
| Laser pointer | 🔴 Missing | | |
| Audio recording | 🔴 Missing | | |
| Timer and stopwatch | 🔴 Missing | | |
| Sticky notes | 🔴 Missing | | |
| Toolbar customisation | 🔴 Missing | | |

A page can currently hold only strokes (`Page.strokes`). Text, photos, sticky notes and elements need
a second kind of page content, which Phase 0 adds. `DocumentStore.dispatch` already takes a list of
operations, so a single undo step can contain several changes.

## Phases

### Phase 0: Foundation (blocks Phases 4–7)
1. Add `Page.items: PageItem[]`, where an item is a text box, image or sticky note. Pages saved before this change get an empty list.
2. Add `items.added`, `items.removed` and `items.updated` operations. Each update stores the previous values so it can be undone.
3. Add a `blobs` store to IndexedDB for images and audio. Export to `.jnotes.json` with the files embedded as data URLs.
4. Add an optional timestamp `t` to each stroke point, for audio sync.
5. Generalise the lasso selection to cover both stroke IDs and item IDs.
6. Tests: undo/redo round-trips for the new operations, and loading pages saved in the old format.

### Phase 1: Quick ink wins (no model changes beyond optional stroke fields) ✅ Done 2026-11-17
1. **Laser pointer:** an overlay that fades and is never saved.
2. **Pen styles:** fountain, ball and brush pens set different stroke options. A tip sharpness slider for the fountain pen.
3. **Highlighter:** draw highlights in a pass underneath pen ink, and add a straight-line toggle.
4. **Eraser:** a size picker, an "erase highlighter only" filter, and partial erasing. Partial erasing splits a stroke into pieces and records the removal and the new pieces as one undoable step.

### Phase 2: Shapes
Extend `shapes.ts` to recognise ellipses, rectangles, triangles, polygons and arrows. Store the result
as ordinary stroke points, so the eraser, lasso and undo keep working without changes. Add a dedicated
Shapes tool alongside hold-to-straighten. Write the recogniser test-first.

### Phase 3: Lasso
Add resize and rotate handles, backed by a new `strokes.transformed` operation holding the transform matrix.
Convert-to-text waits for the handwriting model (README roadmap item 4).

### Phase 4: Text, photos and sticky notes
1. **Text box:** an editable HTML layer positioned over the canvas, with font, size and colour options.
2. **Photos:** add images by file picker, paste or drag-and-drop. Stored in the blob store; can be moved and resized.
3. **Sticky notes:** a text item with a coloured background, several colour choices, and an option to collapse it to an icon.

### Phase 5: Elements
A global library in IndexedDB of saved selections (strokes and items). Save the current lasso
selection as an element, then drag one back onto a page, which adds its contents in a single step.

### Phase 6: Precision tools
1. **Ruler:** an overlay you can drag and rotate with two fingers. Pen strokes near its edge snap to it.
2. **Zoom window:** a magnified box docked at the bottom of the screen. Writing in the box is mapped back to page coordinates, with automatic advance along the line.

### Phase 7: Audio recording
Record with `MediaRecorder` into the blob store, and give strokes drawn during a recording timestamps
relative to it. Playback highlights strokes as the audio reaches them, and tapping a stroke jumps the audio to that moment.

### Phase 8: Timer
A stopwatch and countdown in the UI only, with session history saved in IndexedDB. Independent of everything else.

### Phase 9: Toolbar customisation
Save the tool order and any hidden tools as a preference, and add a settings sheet to reorder and show or hide tools.

## Order

Phase 1 → 0 → 2 → 4 → 3 → 8 → 6 → 5 → 7 → 9.
