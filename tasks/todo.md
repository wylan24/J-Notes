# Feature parity tasks

Plan and reasoning: [docs/FEATURE_PARITY_PLAN.md](../docs/FEATURE_PARITY_PLAN.md).
Every task: `npm test` and `npm run build` pass, new pure logic in `src/core` has tests, and old notebooks still open.
Size: S = 1–2 files, M = 3–5 files.

## Phase 1: Page model and page management

- [x] **1.1 Page size, orientation, paper colour (M)** — `Page.size`, `Page.paper`; `normalizePage` fills defaults; renderer and template painting use them.
  - Accept: a version-2 `.jnotes.json` opens unchanged; an A5 landscape yellow page renders and exports to PNG at that size.
  - Files: `core/model.ts`, `render/page.ts`, `ui/PageView.tsx`, `tests/core.test.ts`
- [x] **1.2 New notebook sheet (S)** — choose size, orientation, paper colour and template.
  - Accept: choices apply to the first page and to pages added later. Depends: 1.1
- [x] **1.3 More templates (M)** — Cornell, legal, music staff, weekly planner; image as custom template (stored as a blob).
  - Accept: each template scales to every page size; custom template survives export/import. Depends: 1.1
- [x] **1.4 `page.moved` and `page.updated` ops (S)** — invertible, logged, replayed.
  - Accept: undo/redo round-trip tests; reload after a move keeps the order.
- [x] **1.5 Page actions (M)** — insert before/after, duplicate, change template, move or copy to another notebook (copies blobs).
  - Accept: each is one undo step; copy to another notebook keeps photos. Depends: 1.4
- [x] **1.6 Thumbnail sidebar (M)** — toggleable, virtualised, tap to jump, drag to reorder, page action menu.
  - Accept: 300-page notebook scrolls smoothly; reorder by drag is undoable. Depends: 1.4, 1.5
- [x] **1.7 Bookmarks (S)** — `doc.updated` op; bookmark toggle in the toolbar; bookmarks tab in the sidebar.
  - Accept: bookmarks survive reload and export. Depends: 1.6

**Checkpoint 1:** old notebooks open; build, tests, and a manual run on iPad Safari pass. Review before Phase 3.

## Phase 3: PDF (after Phase 1)

- [x] **3.1 pdf.js worker and tiled page backgrounds (M)** — `Page.background = { kind: 'pdf', blobId, pageIndex }`, lazy-loaded.
  - Accept: a 200-page PDF opens in under 3 s; only visible pages render. Depends: 1.1
- [x] **3.2 Import PDF as notebook; insert PDF pages or images into a notebook (M)**
  - Accept: page sizes match the PDF; ink on PDF pages exports and re-imports. Depends: 3.1
- [x] **3.3 PDF text search (S)** — results listed by page, jump and highlight.
  - Accept: finds text on page 150 of a 200-page PDF. Depends: 3.1
- [x] **3.4 Export as PDF (M)** — pdf-lib; whole notebook, page range or current page; ink as vector paths; optional no background.
  - Accept: exported PDF opens in Preview and Chrome with selectable original PDF text. Depends: 3.1

**Checkpoint 3:** annotate-and-export round trip on a real lecture PDF.

## Phase 2: Library organisation

- [x] **2.1 Folders (M)** — nested folders, colour wheel and HEX, move notebooks, breadcrumbs; IndexedDB upgrade keeps data.
  - Accept: database upgrade test from the current version; deleting a folder moves its notebooks to trash.
- [x] **2.2 Sort and list view (S)** — name, created, modified; grid/list; remembered per viewer.
- [x] **2.3 Quicknote (S)** — one tap opens a new blank notebook in the editor; empty quicknotes are discarded on exit.
- [x] **2.4 Custom cover image (S)**
- [x] **2.5 Password lock (S)** — hashed password, lock screen on open; UI states it is not encryption.

## Phase 4: Navigation and reading (after Phase 1)

- [x] **4.1 Outlines (M)** — multi-level entries pointing at pages or regions; sidebar tab; add from lasso menu.
- [x] **4.2 Links (M)** — internal (page) and external (URL) links on a selection; pasted URLs become link items; Back button.
  - Accept: tapping a link with the pen in any tool follows it; Back returns to the scroll position.
- [x] **4.3 Horizontal scroll option (S)**
- [x] **4.4 Read-only mode (S)** — every tool off; taps follow links only.
- [x] **4.5 Presentation mode (M)** — second window without chrome mirrors the page and laser via `BroadcastChannel`.
- [x] **4.6 Notebook tabs (M)** — several open notebooks, each keeping its scroll position.

**Checkpoint 2–4:** library and navigation reviewed together.

## Phase 5: Ink and tool polish

- [x] **5.1 Pencil with texture (M)** — stamped grain brush; pressure controls opacity.
- [x] **5.2 Dashed and dotted styles (S)** — pen and shapes.
- [x] **5.3 Stabilisation slider (S)** — per tool, 0–100%, maps to smoothing/streamline.
- [x] **5.4 Tool presets (S)** — save and recall style + width + colour; one tap from the toolbar.
- [x] **5.5 Colour picker (M)** — wheel, HEX, eyedropper from the page, custom swatches.
- [x] **5.6 Tape tool (M)** — tape items cover content; tap toggles reveal; "remove all tape".
- [x] **5.7 Scribble to erase (S)** — detect a cross-out zigzag and erase what it covers; undoable; setting to disable.
  - Accept: test fixtures for scribbles vs. ordinary zigzag handwriting (no false positives in the fixture set).
- [x] **5.8 Selective eraser and "Delete specific items" (S)**

## Phase 6: Objects and selection

- [x] **6.1 Rectangular lasso and lasso filter (S)**
- [x] **6.2 Clipboard cut/copy/paste (M)** — custom MIME plus PNG fallback; works across notebooks.
- [x] **6.3 Lock objects; bring to front / send to back (S)** — `items.reordered` op; locked content ignores eraser and lasso.
- [x] **6.4 Snapping guides (M)** — edges and centres of nearby objects and the grid; setting to disable.
- [x] **6.5 Item rotation; photo crop and flip (M)** — `ItemBase.rotation`, `ImageItem.crop`, `flip`.
- [x] **6.6 Region screenshot (S)**
- [x] **6.7 Animated GIFs (S)** — GIF files from disk animate on screen, first frame in exports.

## Phase 7: Shapes, diagrams and rich text

- [x] **7.1 `ShapeItem` (M)** — rect, ellipse, polygon, line, arrow; fill, stroke, corner radius; recognised shapes create them.
- [x] **7.2 Connectors (M)** — attach anywhere on a shape, follow moves, straight/curved/elbow, control points.
- [x] **7.3 Quick diagramming (S)** — edge dots add a connected shape. Depends: 7.2
- [x] **7.4 Rich text in text boxes and stickies (M)** — TipTap, lazy-loaded; bold, italic, lists, indent, highlight; canvas rendering matches.

## Phase 8: New document types and app polish

- [x] **8.1 Whiteboards (M)** — single unbounded page, tiled rendering, zoom to fit; library filter by type.
- [x] **8.2 Text Documents (M)** — TipTap with headings, checklists, tables, images; keyboard shortcuts.
- [x] **8.3 Dark mode (S)** — app chrome; dark paper inverts ink colours on screen only.
- [x] **8.4 Settings screen and shortcuts sheet (S)**
- [x] **8.5 PWA (S)** — manifest, service worker, offline load test.

**Checkpoint 5–8:** all browser-only features done; full manual pass on iPad and desktop.

## Phase 9: Layers

- [x] **9.1 Layer model (M)** — `Page.layers`, `layerId` on strokes and items; normalise to one layer.
- [x] **9.2 Tools respect the active layer (M)** — pen, eraser, lasso, shapes.
- [x] **9.3 Layers panel and layer export (M)** — add, rename, reorder, hide, lock; export chosen layers to PNG/PDF.

## Phase 10: Handwriting intelligence

- [x] **10.0 Spike (S)** — compare two ONNX HWR models on 50 sample pages; record accuracy and latency on iPad Safari. Decide go/no-go.
  - Done: **go** with TrOCR-small (q8, WASM). See [docs/HWR_SPIKE.md](../docs/HWR_SPIKE.md).
- [x] **10.1 Word and line segmentation (M)** — no model.
  - Done: `core/segment.ts`. On the spike's 50 real lines: 50/50 found as one line, words right on 43/50 (the
    spike's split); stacked ten to a page, lines separate exactly once about their own ink height apart.
- [x] **10.2 Smart Ink reflow (M)** — width handles reflow, insert space, straighten, align. Depends: 10.1
  - Done: `core/smartInk.ts`; side handles on a lasso selection of handwriting rewrap it live; Insert space,
    Straighten and Align are in the selection's More menu. Each is one undo step of ordinary stroke ops.
- [x] **10.3 Recognition worker and cache; handwriting search (M)** Depends: 10.0
  - Done: opt-in setting; TrOCR-small in `hwr/recognizer.worker.ts` reads lines once writing pauses; text is
    cached per line in IndexedDB (`hwr` store, keyed by a hash of the ink); notebook search covers handwriting
    with word highlights, and library search covers every unlocked notebook. Model from Hugging Face, runtime
    from jsDelivr, both kept in the browser cache (see HWR_SPIKE.md, condition 3).
- [x] **10.4 Convert to text and spellcheck (M)** Depends: 10.3
  - Done: Convert to text… in the lasso's More menu reads the selection (cached lines need no model), shows
    the text to correct, then replaces the ink with a text box in its colour and size, or copies it.
    Spellcheck (opt in) underlines words an English Hunspell dictionary (dictionary-en + nspell, 552 KB,
    loaded on demand) doesn't know; tap with the lasso for suggestions or Add to dictionary. A correction is
    typed text at the line's size, not handwriting: writing it in the person's hand is Restyle (10.5).
- [ ] **10.5 Math Assist and Restyle spikes (S each)**
  - Restyle: **no-go**. Tidying by geometry clears every neatness bar but doubles TrOCR's search word error rate
    (4.1% → 8.3%); only standing letters upright is free. See [docs/MATH_AND_RESTYLE_SPIKES.md](../docs/MATH_AND_RESTYLE_SPIKES.md).
  - Math Assist: TrOCR ruled out (0/30 on typed maths); Pix2Text 18/30 on the font check. **Waiting on 30 maths
    lines written on the iPad** (spike page → Write → Maths) to decide.

## Phase 11: Study Sets

- [x] **11.1 Decks and cards (M)** — text, image or drawing per side; create from a lasso selection.
  - Done: a study set is a document kind (`deck`) in the library, so folders, trash, favourites, locking and
    `.jnotes.json` export work as for notebooks. Cards live in `doc.cards` and change through `cards.added`,
    `cards.removed` and `cards.updated` ops (logged, undoable). Each side holds text and/or a drawing; the card
    editor has a drawing pad and adds pictures. In a notebook, More › Add to study set… makes the lasso selection
    the front; the back is typed, drawn, or lassoed next (Lasso the back instead › Use as card back). Cards keep
    their source page, with Go to notebook page.
- [x] **11.2 Study mode with SM-2 spaced repetition (M)** — due cards, stats, deck colours.
  - Done: `core/study.ts` (SM-2 with Again/Hard/Good/Easy as qualities 1/3/4/5; reviews due from the start of
    their day; Again brings a card back in the same session). Study takes due cards, then up to 20 new ones;
    Practise all goes through every card without changing the schedule. Stats: new / learning / mastered (21+ days),
    due, a 14-day activity chart, streak and share remembered. Deck colour from presets or a custom colour.
    The library card shows how many cards are due.

## Phase 12: Hosting, Google sign-in and sync (free services only)

- [x] **12.1 Deploy (S)** — free static hosting (Cloudflare Pages or GitHub Pages) with a GitHub Actions workflow that runs tests and build before deploying. Can be pulled forward once 8.5 is done.
  - Accept: the hosted URL installs as a PWA on iPad and works offline.
  - Done: GitHub Pages at https://wylan24.github.io/J-Notes/. `.github/workflows/deploy.yml` tests and builds every
    push and pull request and deploys `main`. The app now runs from a subfolder: Vite's `base` comes from `BASE_PATH`,
    the manifest uses relative paths, and the service worker registers, precaches and serves the shell under the
    base and leaves the rest of the github.io origin alone. Installed from Safari on the iPad and opens offline.
- [ ] **12.2 Google sign-in (M)** — Google Identity Services; scopes `openid email profile drive.appdata` only; signed-out mode unchanged.
  - Accept: sign in, reload, still signed in; sign out leaves local notebooks intact; no backend involved.
  - Built: Settings › Account. Sign-in redirects to Google and back (OAuth implicit flow, `token id_token`), not a
    popup, so it works in the iPad home-screen app; `core/account.ts` checks state, nonce, audience, issuer and
    expiry. Who is signed in is kept in localStorage; the hour-long Drive token only in sessionStorage. Sign out
    revokes the token and touches nothing else. Needs an OAuth client (README › Google sign-in); unset, sign-in
    is hidden. Client created (repository variable `GOOGLE_CLIENT_ID`; `.env.local` for dev); Google accepts
    both redirect addresses, and Drive allows every request sync makes from the app's origin (checked by
    preflight). **Left to check:** sign in on the hosted app and the iPad.
- [ ] **12.3 Drive sync of notebooks (M)** — upload event batches, snapshots and blobs to the app data folder; pull and merge on open and on focus.
  - Accept: edit on two devices offline, reconnect, both converge with no lost strokes (merge logic unit-tested with fake Drive).
  - Built: `core/sync.ts` (pure) and `sync/engine.ts`. Each device uploads its own edits as immutable batches
    (`n.<doc>.log.<device>.<from>-<to>.json`), pictures once each, and now and then a snapshot with a version vector.
    Every device starts from the snapshot covering the most edits and applies the rest in one order (Lamport clock,
    then device, then seq), so the same files give the same notebook. Edits not yet uploaded survive compaction;
    an open notebook takes in changes through `Persister.rebase` without losing unsaved edits. Deleting a synced
    notebook leaves a marker so other devices delete it too. Notebooks made on another device are downloaded.
    Syncs on start, on focus, on coming online, on opening and closing a notebook, and 15 s after edits; status in
    the library header and Settings › Account. Tests: 15 with a fake Drive (two and three devices, offline edits,
    random interleavings) and 6 on IndexedDB, including this browser against a second device.
  - Limits: Drive access lasts an hour and renewing it needs a trip to Google, so sync pauses with Reconnect.
    Text documents edited on two devices at once keep the later version. Titles, folders and trash are 12.4.
    **Left to check:** two real devices.
- [ ] **12.4 Sync library, folders, elements and settings (S)** Depends: 12.3
  - Built: `core/librarySync.ts` (pure) and `sync/library.ts`. Each library value is an entry (a notebook's title,
    cover, cover image, favourite, trash, folder, lock and default template; each folder; each saved element; each
    synced setting), and the latest change to an entry wins (a clock that never goes backwards, then device). Each
    device keeps its own file of the entries it changed (`lib.<device>.json`); elements' photos go in
    `el.<id>.json`. Changes are found by comparing with what was last synced, so no screen reports them. A value
    never synced on a device takes the value from elsewhere, so a notebook just downloaded or a device signing in
    for the first time doesn't overwrite what was set elsewhere. Synced settings: presets, ink, colours, swatches,
    toolbar, eraser, lasso, snap, scroll, scribble to erase, read-only notebooks, spellcheck words, library sort.
    Per device: stylus only, theme, handwriting recognition, zoom, tabs, sidebar. Runs after notebooks each round.
  - Limits: settings changed on another device take effect when the screen using them next opens.
- [ ] **12.5 First run on a new device; sign-out options (S)** — download all, progress UI; "keep local copies" choice. Depends: 12.3
  - Built: a new device downloads every notebook on its first sync (12.3), downloads first, with progress in the
    library ("Downloading 3 of 12 notebooks from Google Drive", with a bar) and Settings; signing in on a device
    that has notebooks shows its first upload the same way. Everyday syncs show no bar. Signing out asks: Keep
    and sign out, or Remove from this device. Removing syncs first and refuses unless that works (offline,
    expired access), then removes only notebooks and elements safely in Drive: kept are ones with edits not yet
    uploaded, never synced (quick notes) or open; folders go only when no notebook is kept; preferences stay.
    It forgets what was synced at once, so nothing removed is taken as deleted and removed from Drive.

## Phase 13: Sharing and collaboration (free relay; blocked on open questions 1–2)

- [ ] **13.1 CRDT document model (M)** — ops translate to CRDT changes; existing tests still pass.
- [ ] **13.2 Share by link, view only (S)**
- [ ] **13.3 Live editing on a free relay, presence and cursors (M)**

## Not planned

API-based AI (Ask, Create mode, summaries, cloud transcription, mind maps), calendar integration, GIPHY,
Box/Dropbox/WebDAV. See "Not planned" in the plan.
