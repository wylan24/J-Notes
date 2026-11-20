# Feature parity plan

This plan compares J Notes with the current Goodnotes app and lays out the builds needed to match it feature for feature.
It was written on 2026-11-17, after the toolbar plan ([TOOLBAR_PLAN.md](TOOLBAR_PLAN.md)) was finished.
The task checklist is in [tasks/todo.md](../tasks/todo.md).

## Sources

Goodnotes no longer has a version number ("Goodnotes 6" users were moved onto the current app). The research used:
- [Goodnotes for AI assistants fact sheet](https://www.goodnotes.com/for-ai-assistants) (verified September 2026)
- [What's new: April–June 2026](https://www.goodnotes.com/blog/whats-new-in-goodnotes-april-june-2026)
- [What's new: July–September 2026](https://www.goodnotes.com/blog/whats-new-in-goodnotes-july-september-2026)
- [Goodnotes features page](https://www.goodnotes.com/features)
- [Frequently requested features (support)](https://support.goodnotes.com/hc/en-us/articles/7616167357967)
- [Goodnotes update: Whiteboards and Text Documents (AlternativeTo, Oct 2025)](https://alternativeto.net/news/2025/10/goodnotes-update-brings-new-plans-ai-features-whiteboards-and-text-documents)
- [Goodnotes 6 launch post](https://www.goodnotes.com/blog/introducing-goodnotes-6) (spellcheck, Math Assist, Smart Ink)

Goodnotes discontinued Word Complete in March 2025, so it is not in this plan.

## Scope

**In scope:** everything a single person sees in the Goodnotes notebook, whiteboard, text document and library screens,
plus sync, sharing, collaboration, study and AI features.

**Out of scope:** business products and store features that are not part of the note-taking app:
Teams/Enterprise admin and MDM, Goodnotes Education class tools, the Marketplace and Stickers shop, the HP on-device
Meeting Assistant, the Claude connector, iOS "Liquid Glass" styling, and pricing tiers.

**Constraints (decided 2026-11-18):**
- **No AI that calls an API.** Ask Goodnotes, Create mode, quick actions, AI mind maps, summaries and cloud
  transcription are not planned. Features that run entirely on the device (handwriting recognition, spellcheck) stay in.
- **No paid services.** Everything must run on free tiers or in the user's own browser and Google account.
- **Hosting and Google sign-in come later.** The app stays local-first and fully usable signed out; signing in with
  Google adds sync and sharing on top.

The rule from the README still applies: build the behaviour, never copy Goodnotes code, assets, templates or branding.

## Gap analysis

Legend: ✅ have · 🟡 partial · 🔴 missing.
"Needs" marks features that cannot be built with what the app has today: **HWR** = on-device handwriting recognition
model, **Sign-in** = Google sign-in and hosting, **Relay** = a free-tier realtime relay, **Not planned** = ruled out by
the constraints above.

### Notebooks and pages

| Goodnotes feature | J Notes | Gap |
|---|---|---|
| Paper templates | 🟡 blank, ruled, grid, dotted | Cornell, legal, music staff, planner layouts; custom templates from an image or PDF page |
| Page size and orientation (A4, Letter, A5, custom; portrait/landscape) | 🔴 | One fixed page size |
| Paper colour (white, yellow, dark) | 🔴 | |
| Covers | 🟡 built-in covers | Custom cover image |
| Add page before/after, from template, from image/PDF | 🟡 add at end | Insert anywhere, choose template per page |
| Duplicate, reorder, move or copy pages to another notebook | 🔴 (README roadmap item 5) | Needs `page.moved` and `page.updated` ops |
| Page thumbnail sidebar | 🔴 | |
| Bookmarks | 🔴 | |
| Outlines, multi-level | 🔴 | |
| Internal links (to a page) and external links (URLs); pasted URLs become links | 🔴 | |
| Back to previous page after following a link | 🔴 (Goodnotes lacks it too) | Cheap win |
| Vertical and horizontal scrolling | 🟡 vertical only | |
| Read-only mode | 🔴 | |
| Presentation mode with laser pointer | 🟡 laser pointer only | Second-screen view via the Presentation API or a popup window |
| Password lock for notebooks | 🔴 | |
| Multiple notebooks open as tabs | 🔴 | |

### Library

| Goodnotes feature | J Notes | Gap |
|---|---|---|
| Notebooks, search, favourites, trash | ✅ | |
| Folders, nested, with custom colours (wheel, HEX/RGB) | 🔴 | |
| Sort and view options (name, date, grid/list) | 🔴 | |
| Quicknotes (instant blank note) | 🔴 | |
| Whiteboards (infinite canvas) | 🔴 | Our pages are fixed-size |
| Text Documents (typed doc with headings, lists, checklists, tables) | 🔴 | |
| Search across handwriting, typed text, PDFs and folder names | 🟡 notebook titles only | Typed text and PDF text are easy; handwriting **needs HWR** |

### Ink tools

| Goodnotes feature | J Notes | Gap |
|---|---|---|
| Fountain, ball and brush pens; pressure | ✅ | |
| Pencil with texture | 🔴 | Stamped texture brush |
| Dashed and dotted line styles | 🔴 | |
| Stroke stabilisation slider (0–100%) | 🟡 fixed smoothing | Expose as a setting |
| Favourite pen/highlighter presets, one tap away | 🟡 colour and width presets | Saved tool presets with style, width and colour |
| Custom colours, colour wheel, eyedropper | 🟡 fixed palette | |
| Highlighter behind ink, straight mode | ✅ | |
| Eraser: sizes, partial, highlighter only | ✅ | |
| Selective eraser (erase only one content type) | 🟡 highlighter only | Extend to pen, shapes, text, images, stickies |
| Delete specific items (clear all of one type from a notebook) | 🔴 | |
| Cross out (scribble) to erase | 🔴 | Gesture detector; no model needed |
| Tape (hide content, tap to reveal) | 🔴 | |
| Shapes: recognition, hold to snap | ✅ | |
| Filled shapes, rounded corners, rotate shapes freely | 🟡 rotate via lasso | Fill colour, corner radius |
| Quick diagramming: connectors that attach to shapes, curved/elbow styles, add connected shape | 🔴 | Shapes need to become objects, not just strokes |
| Ruler | ✅ | |
| Laser pointer | ✅ | |
| Zoom window | ✅ | Erasing and lasso inside it |

### Selection, objects and layout

| Goodnotes feature | J Notes | Gap |
|---|---|---|
| Freehand lasso: move, resize, rotate, recolour, duplicate, delete | ✅ | |
| Rectangular lasso | ✅ | |
| Lasso filter (handwriting / images / text) | ✅ | |
| Cut, copy, paste across pages and notebooks | ✅ | |
| Take a screenshot of a region | ✅ | |
| Lock objects (cannot be erased or moved) | ✅ | |
| Arrange (bring to front, send to back) | ✅ | |
| Snapping guides to nearby objects and grid (can be turned off) | ✅ | |
| Layers panel: add, hide, export chosen layers | 🔴 | Early access in Goodnotes (Pro, iPad and Mac) |
| Photos: crop, rotate, flip; PNG transparency kept | ✅ | |
| Insert GIFs | ✅ | Plain GIF files only; a GIPHY browser is **not planned** (third-party API) |
| Text boxes: font, size, colour | ✅ | |
| Rich text in text boxes and stickies: bold, bullets, numbered lists, indent, highlight | 🔴 | |
| Sticky notes, collapsible | ✅ | Free rotation |
| Elements library | ✅ | Folders, search |

### Handwriting intelligence (needs HWR)

| Goodnotes feature | J Notes | Gap |
|---|---|---|
| Handwriting search | 🔴 | |
| Convert handwriting to text | 🔴 | |
| Spellcheck in handwriting | 🔴 | |
| Smart Ink: reflow paragraphs by dragging width handles, insert space, straighten lines, align | 🔴 | Word segmentation is enough for reflow; recognition is not required |
| Restyle (tidy handwriting into a cleaner style) | 🔴 | Hardest feature in this plan; research spike |
| Math Assist (check handwritten maths) | 🔴 | Needs HWR plus a maths engine |

### PDF and export

| Goodnotes feature | J Notes | Gap |
|---|---|---|
| Import PDF, annotate, highlight | 🔴 (README roadmap item 3) | pdf.js |
| PDF text search and selectable text highlighting | 🔴 | |
| Export notebook or pages as PDF (flattened, with or without page background) | 🔴 | |
| Export page as image | ✅ PNG | |
| Export / import native file | ✅ `.jnotes.json` | |
| Import images as pages | 🔴 | |
| Auto Backup to cloud storage | 🔴 | **Sign-in**: back up to the user's Google Drive. Box, Dropbox and WebDAV not planned |

### Audio, study and AI

| Goodnotes feature | J Notes | Gap |
|---|---|---|
| Audio recording synced to ink, replay options | ✅ | Replay modes: follow ink, keep everything shown |
| Rename recordings | 🔴 | |
| Study Sets: flashcards with spaced repetition, from your notes | 🔴 | Local; text, image or drawing per card side |
| Transcription and summaries | 🔴 | **Not planned** as a cloud service. Optional later: on-device Whisper (free, but a 40–150 MB model download) |
| Ask Goodnotes, Create mode, quick actions, AI mind maps, meeting notes to plan | 🔴 | **Not planned** (needs a paid language model API) |
| Calendar integration for meeting notes and planners | 🔴 | **Not planned** for now (calendar scopes need Google's app verification) |

### Accounts, sync, sharing and collaboration

| Goodnotes feature | J Notes | Gap |
|---|---|---|
| Hosted web app | 🔴 | **Sign-in** phase: free static hosting |
| Accounts | 🔴 | **Sign-in**: Google sign-in |
| Cloud sync across devices, offline editing | 🟡 offline, local only | **Sign-in**: the event log syncs through the user's Google Drive |
| Share a link (view or edit) | 🔴 | **Relay** for live edits; view-only copies can go through Drive |
| Real-time collaboration with live cursors | 🔴 | **Relay** + CRDT |

### App

| Goodnotes feature | J Notes | Gap |
|---|---|---|
| Dark mode | 🔴 | App chrome and dark paper |
| Settings screen (snapping, stabilisation, scroll direction, stylus-only, language) | 🟡 scattered toggles | |
| Keyboard shortcuts reference | 🟡 README only | In-app sheet |
| Installable app that works offline (PWA) | 🔴 | Service worker + manifest |
| Floating toolbar | 🔴 | Our toolbar is docked |

**Summary:** of roughly 95 features, J Notes has about 30, partly has about 15, and lacks about 50.
About 10 of the missing ones are not planned under the constraints (API-based AI, calendar, third-party storage).
Of the rest, about 30 can be built in the browser with nothing new; the others need the on-device handwriting model,
Google sign-in, or a free realtime relay.

## Architecture decisions

1. **Page geometry becomes data.** `Page` gains `size: { w, h }`, `paper: 'white' | 'yellow' | 'dark'`, an optional
   `background` (`{ kind: 'pdf', blobId, pageIndex }` or `{ kind: 'image', blobId }`) and `layers`. Old pages normalise to
   the current size, white paper and one layer, the same way `normalizePage` added `items`.
2. **New ops, same log.** `page.moved` (index change), `page.updated` (patch with old values, like `items.updated`),
   `doc.updated` (bookmarks, outline, links), `items.reordered`. Every op stays invertible so undo and persistence keep
   working unchanged.
3. **Shapes become items.** Quick diagramming needs shapes that know their geometry, fill and connection points.
   Add a `ShapeItem` (rect, ellipse, polygon, line, arrow) and a `ConnectorItem` that refers to two shape ids. Shapes
   recognised from ink become `ShapeItem`s; existing shape strokes stay strokes.
4. **Whiteboards reuse pages.** A whiteboard is a notebook with one page whose size is unbounded; rendering already
   virtualises, so it needs tiling of that single page rather than a new engine.
5. **Text Documents use a proven editor.** Use TipTap (ProseMirror) rather than building rich text by hand. Its Yjs
   binding also gives collaboration later. Text boxes and stickies get the same editor in a reduced mode.
6. **PDF in, PDF out.** pdf.js renders backgrounds into cached tiles in a worker; pdf-lib writes exports. Ink is
   written into the PDF as vector paths, not images.
7. **Handwriting recognition runs on-device in a worker** (ONNX Runtime Web), matching what Goodnotes ships
   (`hws-onnx-worker` in [REVERSE_ENGINEERING.md](REVERSE_ENGINEERING.md)). Results are cached per stroke group in
   IndexedDB so search does not re-run the model.
8. **Free hosting, Google sign-in, sync through the user's own Drive.**
   - Hosting: the app is static files, so it can be served free from Cloudflare Pages or GitHub Pages (HTTPS, which the
     service worker needs).
   - Sign-in: Google Identity Services in the browser. No backend is needed to sign in.
   - Sync: each notebook's event log and blobs go to the user's Google Drive app data folder (`drive.appdata` scope,
     hidden from the user's Drive and counted against their own free 15 GB). Avoiding full-Drive scopes keeps the app
     out of Google's restricted-scope security assessment, which costs money. There is no server to pay for or run.
   - Signed out, the app works exactly as it does today.
9. **Collaboration last, on a free relay.** Live editing needs something to pass changes between people. The CRDT
   (Yjs or Automerge) is the document model; the relay is chosen when the phase starts from free options
   (a free-tier Supabase Realtime channel, a Cloudflare Worker, or y-webrtc peer-to-peer). Saved state still lives
   in each person's Drive.

## Phases

Each phase leaves the app working and is shippable on its own. Phases 1–11 need no account and no server.
Detailed tasks with acceptance criteria are in [tasks/todo.md](../tasks/todo.md).

### Phase 1: Page model and page management
Foundation for PDF, whiteboards, layers and outlines.
- Page size, orientation and paper colour; a "new notebook" sheet to choose them.
- More templates: Cornell, music staff, legal, weekly planner; any image as a custom template.
- `page.moved` / `page.updated`; insert page before or after, duplicate, change template, move or copy to another notebook.
- Page thumbnail sidebar with drag to reorder.
- Bookmarks, and a bookmarks tab in the sidebar.

### Phase 2: Library organisation
- Folders (nested) with colour picker; move notebooks between folders; breadcrumb navigation.
- Sort (name, created, modified) and grid/list view.
- Quicknote button: new blank notebook straight into the editor.
- Custom cover image.
- Password lock (a lock screen backed by a hashed password; encrypting stored data is a later option and is called out
  as such in the UI so nobody mistakes it for encryption).

### Phase 3: PDF
- Import a PDF as a notebook (one page per PDF page, page size from the PDF).
- Insert PDF pages or images into an existing notebook.
- Search PDF text, with results listed by page.
- Export a notebook, a page range or the current page as PDF, with ink as vectors.
- Import images as pages.

### Phase 4: Navigation and reading
- Outlines (multi-level), from the sidebar or the lasso menu.
- Internal links (to a page) and external links on any selection; pasted URLs become links; a Back button after following one.
- Horizontal scrolling option.
- Read-only mode.
- Presentation mode: a second window shows the page without chrome and follows the presenter's page and laser.
- Tabs for several open notebooks.

### Phase 5: Ink and tool polish
- Pencil with grain texture; dashed and dotted styles for pen and shapes.
- Stabilisation slider per tool.
- Saved tool presets (favourites).
- Colour wheel, HEX input, eyedropper, custom swatches.
- Tape tool: draw tape over content, tap to reveal, "remove all tape".
- Scribble (cross out) to erase.
- Selective eraser for every content type; "Delete specific items" for a whole notebook.

### Phase 6: Objects and selection
- Rectangular lasso and lasso filter.
- Cut, copy and paste through the system clipboard, across pages and notebooks.
- Lock objects; bring to front and send to back.
- Snapping guides to objects and the page grid, with a setting to turn them off.
- Photos: crop, rotate, flip. Free rotation for photos, text boxes and stickies (items gain `rotation`).
- Region screenshot to an image item or the clipboard.
- Plain GIF files animate on the page.

### Phase 7: Shapes, diagrams and rich text
- `ShapeItem` with fill, stroke, corner radius; recognised shapes become shape items.
- Connectors that attach anywhere on a shape, follow it when it moves, straight/curved/elbow.
- Quick diagramming: dots on a selected shape's edges add a connected copy.
- Rich text editor (TipTap) in text boxes and sticky notes: bold, italic, lists, indent, highlight.

### Phase 8: New document types and app polish
- Whiteboards: one unbounded page, tiled rendering, zoom to fit.
- Text Documents: TipTap with headings, lists, checklists, tables, images, and keyboard shortcuts.
- Dark mode for the app and dark paper.
- Settings screen gathering every preference.
- In-app keyboard shortcuts sheet.
- PWA: manifest, service worker, install prompt, works offline. (This is also the first step of hosting.)

### Phase 9: Layers
- `Page.layers` with an active layer; pen, lasso and eraser act on the active layer only.
- Layers panel: add, rename, reorder, hide, lock.
- Export only chosen layers (PNG and PDF).

### Phase 10: Handwriting intelligence (needs HWR)
Start with a one-week spike to pick a model and measure accuracy and speed on an iPad in Safari.
- Word and line segmentation (no model): group strokes into words and lines.
- Smart Ink reflow using segmentation: width handles reflow words, insert space, straighten lines, align.
- Recognition worker and per-group cache; handwriting search in the notebook and the library.
- Convert to text (replace ink with a text box, or copy the text).
- Spellcheck: underline misspelt words, tap to replace with the suggestion written in a matching size.
- Convert-to-text in the lasso menu (closes the last open item from TOOLBAR_PLAN Phase 3).
- Math Assist and Restyle: separate spikes after recognition ships.

### Phase 11: Study Sets
- Flashcard decks with text, image or drawing on each side; create cards from a lasso selection.
- Study mode with spaced repetition (SM-2), stats per deck, custom deck colours.

### Phase 12: Hosting, Google sign-in and sync (free)
- Deploy the PWA from Phase 8 to free static hosting with a deploy-on-push workflow.
- Google sign-in with Google Identity Services; signed-out use is unchanged.
- Sync each notebook's event log, snapshots and blobs to the Drive app data folder; merge events from several
  devices by sequence and device id.
- Sync the library, folders, elements, toolbar and settings.
- Download everything from Drive on a new device; sign out removes local copies only if the user chooses to.

### Phase 13: Sharing and collaboration (free relay)
- Move the document model to a CRDT behind the existing op interface.
- Share a notebook by link, view-only first, then edit.
- Live editing through a free-tier relay, with presence and live cursors.

### Not planned
API-based AI (Ask, Create mode, quick actions, mind maps, summaries, cloud transcription), calendar integration,
GIPHY, and Box/Dropbox/WebDAV storage. On-device transcription with Whisper is possible later for free, and can be
reconsidered once Phase 10 has proved that models run well in the browser.

## Order and dependencies

```
1 Page model ─┬─ 3 PDF
              ├─ 4 Navigation
              ├─ 8 Whiteboards, Text Docs, PWA ─── 12 Hosting + Google sign-in + Drive sync ─── 13 Sharing + collaboration
              └─ 9 Layers
2 Library
5 Ink polish
6 Objects ─── 7 Shapes & rich text
10 HWR ─── 11 Study Sets (cards from ink)
```

Suggested order: **1 → 3 → 2 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13.**
PDF comes right after the page model because it is the most-used Goodnotes feature we lack. Phases 2, 5 and 6 are
independent of each other and can be built in parallel. Phase 10's spike can start at any time.
Hosting can be pulled forward: Phase 8's PWA task plus task 12.1 (deploy) take about a day and need nothing else,
which makes testing on an iPad easier. Sign-in and sync should wait until the data model settles after Phase 9, so
synced data does not need repeated migrations.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Changing `Page` breaks old notebooks | High | Normalise on load like `normalizePage`; round-trip tests with version 1 and 2 files |
| PDF rendering is slow on large files | High | Render in a worker into cached tiles at the current zoom; only for visible pages |
| On-device HWR is too slow or too inaccurate in Safari | High | Spike first; if no model is good enough, ship segmentation-based Smart Ink (10.1–10.2) and drop recognition |
| Moving to a CRDT rewrites the op reducer | High | Keep ops as the public interface; translate ops to CRDT changes so UI code does not change |
| Google changes free limits or requires app verification | Medium | Use only `openid`, `email`, `profile` and `drive.appdata`; keep the app fully usable signed out; export stays available |
| Drive API rate limits during heavy writing | Medium | Batch events locally and upload every few seconds and on page hide, as the Persister already batches IndexedDB writes |
| Free relay tiers pause or cap usage | Medium | Collaboration degrades to Drive sync; relay is behind one small interface so it can be swapped |
| Bundle size grows (pdf.js, TipTap, ONNX) | Medium | Lazy-load each with dynamic `import()` when first needed |
| Restyle and Math Assist may be out of reach | Medium | Treat as research spikes, not commitments |
| A password lock without encryption gives false security | Medium | Say so in the UI; encryption at rest as a follow-up |

## Open questions

Resolved 2026-11-18: host later with Google sign-in, no API-based AI, no paid services.

1. **Collaboration engine:** Yjs (pairs with TipTap) or Automerge (closer to what Goodnotes uses)? Needed by Phase 13.
2. **Relay for live editing:** Supabase free tier, a Cloudflare Worker, or peer-to-peer? Needed by Phase 13.
3. **Is matching Restyle and Math Assist a goal**, or is "convert to text" enough handwriting intelligence?
4. ~~**Hosting provider and domain:** Cloudflare Pages or GitHub Pages, and on a free subdomain or your own domain?~~
   Decided: GitHub Pages on the free subdomain, https://wylan24.github.io/J-Notes/.
