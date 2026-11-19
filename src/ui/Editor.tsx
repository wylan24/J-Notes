import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FILL_COLORS, NoFillSwatch } from './ShapeStyle';
import { SHORTCUTS_KEY, TOOLS } from '../core/shortcuts';
import { SettingsDialog, ShortcutsSheet } from './Settings';
import type { EditorSettings, InkToolName } from './settingsStore';
import { docKind, pageIndexAt, pageOffsets, pageSize, type DashStyle, type EraseMode, type ScrollDirection, type InkTool, type LinkItem, type LinkTarget, type NotebookMeta, type OutlineEntry, type PenStyle, type Template, type ToolKind } from '../core/model';
import { newId } from '../core/ids';
import { DocumentStore } from '../core/store';
import { deleteSelectionOps, selectionBounds } from '../core/selection';
import { appendPage, getBlobs, getMeta, listElements, loadDocument, putBlob, saveElement, updateMeta } from '../storage/db';
import { bookmarkedIndices, changeTemplateOp, clonePage, duplicatePageOp, insertPageOp, insertPagesOps, isBookmarked, pageBlobIds, toggleBookmarkOp } from '../core/pages';
import { pagesFromFiles } from '../io/importPages';
import { afterEditorClose, settleQuicknote, settleQuicknoteById } from '../storage/quicknotes';
import { isUnlocked, markUnlocked } from '../core/lock';
import { LockScreen } from './Lock';
import { movePageOp, removeItemsOp, updateItemOp } from '../core/ops';
import { LINK_PAD, LINK_TEXT_SIZE, linkLabel, newLink, pushBack, type BackEntry } from '../core/links';
import { LinkDialog } from './LinkDialog';
import { usePresenter } from './usePresenter';
import { TabsBar } from './TabsBar';
import { closeTab, isTabOpen, savedPosition, savePosition, takePageJump } from './tabsStore';
import { AddCardDialog, type CardDraft } from './AddCardDialog';
import { ChangeTemplateDialog, NotebookPickerDialog, PageMenuItems, type PageActionHandlers } from './PageActions';
import { PageSidebar, type SidebarTab } from './PageSidebar';
import { DEFAULT_STABILISE, normaliseStabilise } from '../core/stabilise';
import { addPreset, applyPreset, makePreset, normalizePresets, removePreset, type ToolPreset } from '../core/presets';
import { ToolPresets } from './ToolPresets';
import { ColorPicker } from './ColorPicker';
import { LASSO_KINDS, LASSO_LABELS, normalizeLassoSettings, toggleLassoKind, type LassoSettings, type LassoShape } from '../core/lasso';
import { CONTENT_LABELS, INK_KINDS, normalizeEraseKinds, toggleEraseKind, deleteContentOps, type InkKind } from '../core/contentKinds';
import { DeleteItemsMenu } from './DeleteItemsMenu';
import { addSwatch, normalizeSwatches } from '../core/color';
import { countTape, removeAllTapeOps, TAPE_COLORS, toggleRevealed } from '../core/tape';
import { OutlinePanel } from './OutlinePanel';
import { addOutlineEntry } from '../core/outline';
import { SearchPanel, type SearchHit } from './SearchPanel';
import { useHandwritingIndex } from '../hwr/indexer';
import { useSpellChecker } from '../hwr/spellcheck';
import { PdfExportDialog } from './PdfExportDialog';
import { LayerExportDialog, LayersPanel, layerNotice } from './LayersPanel';
import { findLayer, layerNames, pageLayers, visibleContent, withLayers, workingContent } from '../core/layers';
import type { CustomTemplate } from './TemplateGrid';
import { Persister, type SaveStatus } from '../storage/persister';
import { downloadBlob, exportPagePng, renderBoardThumbnail, renderContentThumbnail, renderRegionPng, renderThumbnail } from '../render/page';
import { contentBounds, cropToContent, fitView } from '../core/whiteboard';
import { screenshotImage, type Rect } from '../core/screenshot';
import { imageResolver, measurer, primeImage } from '../render/items';
import { isImageFile, prepareImage } from '../io/images';
import { FONTS, newImage, type FontKey, type TextStyle } from '../core/items';
import type { Page, PageItem } from '../core/model';
import { referencedBlobIds, toFile } from '../io/notebookFile';
import { PageView, type GestureState, type Selection, type ToolState } from './PageView';
import { Icon } from './icons';
import { TimerButton } from './Timer';
import { ElementsButton } from './Elements';
import { ITEM_INFO, OverflowMenu, ToolbarSettings } from './ToolbarSettings';
import { normalizePrefs, visibleItems, type ToolbarItem, type ToolbarPrefs } from '../core/toolbarPrefs';
import { AudioBar, type AudioApi } from './AudioBar';
import { recordingSupported, stopRecording, useRecorderState } from './recorder';
import type { Recording } from '../core/model';
import { defaultElementName, elementBlobIds, makeElementContent, placeElement, type SavedElement } from '../core/elements';
import { RulerOverlay } from './Ruler';
import { countLocked, unlockAllOps } from '../core/arrange';
import { pastedFromEvent, readPasted, writeClip, writeClipToEvent, type Pasted } from './clipboard';
import type { Clip, ClipBlob } from '../core/clipboard';
import { ZoomWindow } from './ZoomWindow';
import { rulerEdges, type Ruler } from '../core/ruler';
import { defaultTarget, type ZoomTarget } from '../core/zoomWindow';

const PAGE_GAP = 28;
/** Width of one toolbar icon button with its gap, and of the fixed buttons around the customisable ones. */
const TOOLBAR_ITEM_W = 38;
const TOOLBAR_FIXED_W = 3 * TOOLBAR_ITEM_W + 2 * 13;
const MIN_ZOOM = 0.4;
/** Whiteboards zoom out further, to see a whole diagram. */
const BOARD_MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

const PEN_COLORS = ['#1c1c1e', '#2557c7', '#d1342f', '#1d8a4a', '#8a4fd8'];
const STICKY_COLORS = ['#ffe680', '#ffc2d6', '#b8e6c1', '#b9dcff', '#ffd3a6'];
const TEXT_SIZES = [{ size: 14, label: 'S' }, { size: 18, label: 'M' }, { size: 28, label: 'L' }];
const FONT_LABELS: Record<FontKey, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono' };
const DEFAULT_TEXT: TextStyle = { font: 'sans', size: 18, color: PEN_COLORS[0] };
const HIGHLIGHT_COLORS = ['#ffd84d', '#9ff09a', '#ffb0d0', '#9fd4ff'];
/** Tools whose options are a colour and a width. */
type ColorTool = InkTool | 'shapes';
const WIDTHS: Record<ColorTool, number[]> = { pen: [1.8, 3, 5], highlighter: [12, 18, 26], shapes: [1.8, 3, 5] };
const PEN_STYLES: { style: PenStyle; label: string }[] = [
  { style: 'fountain', label: 'Fountain pen' },
  { style: 'ball', label: 'Ball pen' },
  { style: 'brush', label: 'Brush pen' },
  { style: 'pencil', label: 'Pencil' },
];
const DASH_STYLES: { dash: DashStyle; label: string }[] = [
  { dash: 'solid', label: 'Solid line' },
  { dash: 'dashed', label: 'Dashed line' },
  { dash: 'dotted', label: 'Dotted line' },
];
const ERASER_SIZES = [6, 12, 22];

interface InkSettings {
  pen: { color: string; width: number; style: PenStyle; sharpness: number; dash: DashStyle; stabilise: number };
  highlighter: { color: string; width: number; straight: boolean; stabilise: number };
  /** `fill` colours new closed shapes; null for none. */
  shapes: { color: string; width: number; dash: DashStyle; stabilise: number; fill: string | null };
}
interface EraserSettings {
  size: number;
  mode: EraseMode;
  /** Which ink the eraser erases. */
  kinds: InkKind[];
}

const DEFAULT_INK: InkSettings = {
  pen: { color: PEN_COLORS[0], width: WIDTHS.pen[1], style: 'fountain', sharpness: 0.5, dash: 'solid', stabilise: DEFAULT_STABILISE },
  highlighter: { color: HIGHLIGHT_COLORS[0], width: WIDTHS.highlighter[1], straight: false, stabilise: DEFAULT_STABILISE },
  shapes: { color: PEN_COLORS[0], width: WIDTHS.shapes[1], dash: 'solid', stabilise: DEFAULT_STABILISE, fill: null },
};
const DEFAULT_ERASER: EraserSettings = { size: ERASER_SIZES[1], mode: 'stroke', kinds: [...INK_KINDS] };

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode etc. */
  }
}

/** How many editors have each notebook open (StrictMode briefly mounts two). */
const openEditors = new Map<string, number>();

export function Editor({ id, onExit }: { id: string; onExit: () => void }) {
  const [state, setState] = useState<{ store: DocumentStore; meta: NotebookMeta; snapshotSeq: number } | { error: string } | null>(null);
  const [unlocked, setUnlocked] = useState(() => isUnlocked(id));

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadDocument(id), getMeta(id)])
      .then(([{ doc, seq, snapshotSeq }, meta]) => {
        if (cancelled) return;
        if (!meta) throw new Error('Notebook not found');
        setState({ store: new DocumentStore(doc, seq), meta, snapshotSeq });
      })
      .catch((e: Error) => !cancelled && setState({ error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!state) return <div className="center-msg">Opening…</div>;
  if ('error' in state)
    return (
      <div className="center-msg">
        <p>{state.error}</p>
        <button className="btn" onClick={onExit}>
          Back to library
        </button>
      </div>
    );
  if (state.meta.lock && !unlocked)
    return (
      <LockScreen
        meta={state.meta}
        onExit={onExit}
        onUnlock={() => {
          markUnlocked(id);
          setUnlocked(true);
        }}
      />
    );
  // Text documents have their own editor, loaded when one is first opened.
  if (docKind(state.meta) === 'text')
    return (
      <Suspense fallback={<div className="center-msg">Opening…</div>}>
        <TextDocument key={id} {...state} onExit={onExit} />
      </Suspense>
    );
  // So do study sets.
  if (docKind(state.meta) === 'deck')
    return (
      <Suspense fallback={<div className="center-msg">Opening…</div>}>
        <StudySet key={id} {...state} onExit={onExit} />
      </Suspense>
    );
  return <EditorInner key={id} {...state} onExit={onExit} />;
}

const TextDocument = lazy(() => import('./TextDocument'));
const StudySet = lazy(() => import('./StudySet'));

function EditorInner({
  store,
  meta: initialMeta,
  snapshotSeq,
  onExit,
}: {
  store: DocumentStore;
  meta: NotebookMeta;
  snapshotSeq: number;
  onExit: () => void;
}) {
  const doc = useSyncExternalStore(store.subscribe, store.getDoc);
  useSyncExternalStore(store.subscribe, store.getVersion); // re-render for undo/redo state
  const [meta, setMeta] = useState(initialMeta);
  // A whiteboard is one large page: no page tools, a wider zoom range, and Fit to frame its content.
  const board = docKind(initialMeta) === 'whiteboard';
  const minZoom = board ? BOARD_MIN_ZOOM : MIN_ZOOM;
  const [zoom, setZoom] = useState(() => readPref('jnotes.zoom', 1));
  // Read-only: remembered per notebook in this browser.
  const [readOnly, setReadOnlyState] = useState(() => readPref<string[]>('jnotes.readOnly', []).includes(initialMeta.id));
  const setReadOnly = (on: boolean) => {
    setReadOnlyState(on);
    const ids = new Set(readPref<string[]>('jnotes.readOnly', []));
    if (on) ids.add(initialMeta.id);
    else ids.delete(initialMeta.id);
    writePref('jnotes.readOnly', [...ids]);
  };
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  // Pages stacked top to bottom, or side by side; remembered in this browser.
  const [scrollDir, setScrollDir] = useState<ScrollDirection>(() => (readPref<string>('jnotes.scroll', 'vertical') === 'horizontal' ? 'horizontal' : 'vertical'));
  const [toolKind, setToolKind] = useState<ToolKind>('pen');
  // Merge stored prefs over defaults so settings added later get sane values.
  const [ink, setInk] = useState<InkSettings>(() => {
    const saved = readPref<Partial<InkSettings>>('jnotes.ink', {});
    return {
      pen: { ...DEFAULT_INK.pen, ...saved.pen },
      highlighter: { ...DEFAULT_INK.highlighter, ...saved.highlighter },
      shapes: { ...DEFAULT_INK.shapes, ...saved.shapes },
    };
  });
  const [eraser, setEraser] = useState<EraserSettings>(() => {
    // Saved settings may predate the kinds filter (they had "highlighter only").
    const saved = readPref<Partial<EraserSettings> & { highlighterOnly?: boolean }>('jnotes.eraser', {});
    const { highlighterOnly, ...rest } = saved;
    return { ...DEFAULT_ERASER, ...rest, kinds: normalizeEraseKinds(saved.kinds, highlighterOnly) };
  });
  const setPen = (patch: Partial<InkSettings['pen']>) => setInk((v) => ({ ...v, pen: { ...v.pen, ...patch } }));
  const setHighlighter = (patch: Partial<InkSettings['highlighter']>) => setInk((v) => ({ ...v, highlighter: { ...v.highlighter, ...patch } }));
  const setInkTool = (t: ColorTool, patch: { color?: string; width?: number }) => setInk((v) => ({ ...v, [t]: { ...v[t], ...patch } }));
  const setDash = (t: 'pen' | 'shapes', dash: DashStyle) => setInk((v) => ({ ...v, [t]: { ...v[t], dash } }));
  const setStabilise = (t: ColorTool, stabilise: number) => setInk((v) => ({ ...v, [t]: { ...v[t], stabilise } }));
  const [penOnly, setPenOnly] = useState(() => readPref('jnotes.penOnly', false));
  const [textStyle, setTextStyle] = useState<TextStyle>(() => ({ ...DEFAULT_TEXT, ...readPref<Partial<TextStyle>>('jnotes.text', {}) }));
  const [stickyColor, setStickyColor] = useState(() => readPref('jnotes.stickyColor', STICKY_COLORS[0]));
  const [tapeColor, setTapeColor] = useState(() => readPref('jnotes.tapeColor', TAPE_COLORS[0]));
  const [scribbleErase, setScribbleErase] = useState(() => readPref('jnotes.scribbleErase', true));
  const [lasso, setLasso] = useState<LassoSettings>(() => normalizeLassoSettings(readPref<unknown>('jnotes.lasso', null)));
  useEffect(() => writePref('jnotes.lasso', lasso), [lasso]);
  const [snap, setSnap] = useState(() => readPref('jnotes.snap', true));
  useEffect(() => writePref('jnotes.snap', snap), [snap]);
  useEffect(() => writePref('jnotes.scribbleErase', scribbleErase), [scribbleErase]);
  useEffect(() => writePref('jnotes.tapeColor', tapeColor), [tapeColor]);
  // Tape strips lifted to show what is under them: a viewing state for this visit, not saved.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const toggleTape = useCallback((id: string) => setRevealed((r) => toggleRevealed(r, id)), []);
  const photoInput = useRef<HTMLInputElement>(null);
  const [toolbarPrefs, setToolbarPrefs] = useState<ToolbarPrefs>(() => normalizePrefs(readPref<unknown>('jnotes.toolbar', null)));
  const [customising, setCustomising] = useState(false);
  // Buttons that don't fit on one toolbar row go into a "More" menu.
  const toolbarRef = useRef<HTMLElement>(null);
  const leftGroupRef = useRef<HTMLDivElement>(null);
  const rightGroupRef = useRef<HTMLDivElement>(null);
  const [itemRoom, setItemRoom] = useState(Infinity);
  useLayoutEffect(() => {
    const tb = toolbarRef.current;
    if (!tb) return;
    const measure = () => {
      const l = leftGroupRef.current?.offsetWidth ?? 0;
      const r = rightGroupRef.current?.offsetWidth ?? 0;
      const cs = getComputedStyle(tb);
      const inner = tb.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      // Group gaps, then undo, redo, two dividers and the Customise button.
      setItemRoom(inner - l - r - 2 * 8 - TOOLBAR_FIXED_W);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(tb);
    return () => ro.disconnect();
  }, []);
  // Precision tools. The ruler is placed in the canvas area's coordinates and stays put while pages scroll.
  const areaRef = useRef<HTMLDivElement>(null);
  const [ruler, setRuler] = useState<Ruler | null>(null);
  const rulerRef = useRef(ruler);
  rulerRef.current = ruler;
  const [zoomTarget, setZoomTarget] = useState<ZoomTarget | null>(null);
  // Audio: the bar's open state, where playback is (for fading ink), and a handle to seek it from ink.
  const [audioOpen, setAudioOpen] = useState(false);
  const [playback, setPlayback] = useState<{ rec: string; t: number } | null>(null);
  const audioApi = useRef<AudioApi | null>(null);
  const recState = useRecorderState();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [currentPage, setCurrentPage] = useState(0);
  // Recognised handwriting, read in the background while recognition is on (Settings).
  const handwriting = useHandwritingIndex(initialMeta.id, store, currentPage);
  const spell = useSpellChecker();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<GestureState>({ touches: new Map(), active: false });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => writePref('jnotes.ink', ink), [ink]);
  // Tool presets: saved looks for the ink tools, remembered in this browser.
  const [presets, setPresets] = useState<ToolPreset[]>(() => normalizePresets(readPref<unknown>('jnotes.presets', [])));
  useEffect(() => writePref('jnotes.presets', presets), [presets]);
  // Custom colours: one set for pens and shapes, one for the highlighter (its colours are pale).
  const [swatches, setSwatches] = useState(() => {
    const saved = readPref<{ ink?: unknown; highlighter?: unknown }>('jnotes.swatches', {});
    return { ink: normalizeSwatches(saved.ink), highlighter: normalizeSwatches(saved.highlighter) };
  });
  useEffect(() => writePref('jnotes.swatches', swatches), [swatches]);
  const swatchGroup = (t: ColorTool) => (t === 'highlighter' ? 'highlighter' : 'ink');
  const [picker, setPicker] = useState<{ tool: ColorTool; anchor: DOMRect } | null>(null);
  /** Eyedropper: the ink tool whose colour the next tap on a page sets. */
  const [sampling, setSampling] = useState<ColorTool | null>(null);

  const applyToolPreset = (p: ToolPreset) => {
    setInk((v) => ({ ...v, [p.tool]: applyPreset(v[p.tool], p) }));
    setToolKind(p.tool);
  };
  useEffect(() => writePref('jnotes.eraser', eraser), [eraser]);
  useEffect(() => writePref('jnotes.penOnly', penOnly), [penOnly]);
  useEffect(() => writePref('jnotes.text', textStyle), [textStyle]);
  useEffect(() => writePref('jnotes.toolbar', toolbarPrefs), [toolbarPrefs]);
  useEffect(() => writePref('jnotes.stickyColor', stickyColor), [stickyColor]);
  // A board's zoom (often far out) isn't carried over to notebooks.
  useEffect(() => void (!board && writePref('jnotes.zoom', zoom)), [zoom, board]);
  useEffect(() => writePref('jnotes.scroll', scrollDir), [scrollDir]);

  // --- Persistence ------------------------------------------------------------
  // Created inside the effect (not useMemo) so StrictMode's mount→unmount→mount
  // cycle gets a fresh, subscribed persister each time.
  useEffect(() => {
    let lastThumb = 0;
    const docId = store.doc.id;
    const thumbFor = board ? renderBoardThumbnail : renderThumbnail;
    // A locked notebook keeps no page thumbnail: it would show its content in the library.
    const locked = !!initialMeta.lock;
    openEditors.set(docId, (openEditors.get(docId) ?? 0) + 1);
    const persister = new Persister(store, snapshotSeq, () => {
      // Refresh the library thumbnail at most every few seconds.
      if (locked || Date.now() - lastThumb < 3000 || !store.doc.pages[0]) return;
      lastThumb = Date.now();
      void updateMeta(store.doc.id, { thumbnail: thumbFor(store.doc.pages[0], store.doc.id) });
    });
    const off = persister.onStatus(setStatus);
    const flush = () => void persister.flush();
    const onVis = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
      openEditors.set(docId, (openEditors.get(docId) ?? 1) - 1);
      const thumbnail = store.doc.pages[0] && !locked ? thumbFor(store.doc.pages[0], docId) : undefined;
      afterEditorClose(
        (async () => {
          if (thumbnail) await updateMeta(docId, { thumbnail });
          await persister.dispose();
          // StrictMode remounts at once; settle the quick note only if the notebook really closed:
          // not shown here any more, and its tab closed too (switching tabs keeps it).
          await new Promise((r) => setTimeout(r, 0));
          if (!openEditors.get(docId) && !isTabOpen(docId)) await settleQuicknote(docId, store.doc);
        })(),
      );
    };
  }, [store, snapshotSeq]);

  // Coming back to a notebook (another tab, or the library) returns to where it was left.
  useLayoutEffect(() => {
    const p = savedPosition(initialMeta.id);
    const el = scrollerRef.current;
    if (p && el) {
      el.scrollTop = p.scrollTop;
      el.scrollLeft = p.scrollLeft;
    } else if (board) fitToContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Zoom with a fixed anchor point ----------------------------------------------
  const pendingAnchor = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);
  const setZoomAt = useCallback((next: number, clientX?: number, clientY?: number) => {
    const el = scrollerRef.current;
    const z = Math.min(MAX_ZOOM, Math.max(minZoom, next));
    if (!el || z === zoomRef.current) return;
    const r = el.getBoundingClientRect();
    const px = (clientX ?? r.left + r.width / 2) - r.left;
    const py = (clientY ?? r.top + r.height / 2) - r.top;
    pendingAnchor.current = { cx: (el.scrollLeft + px) / zoomRef.current, cy: (el.scrollTop + py) / zoomRef.current, px, py };
    zoomRef.current = z;
    setZoom(z);
  }, [minZoom]);

  /** Whiteboard: zoom and scroll so everything drawn is in view (the middle of the board when empty). */
  const pendingCentre = useRef<{ x: number; y: number } | null>(null);
  const [fitCount, setFitCount] = useState(0);
  const fitToContent = useCallback(() => {
    const el = scrollerRef.current;
    const page = store.doc.pages[0];
    if (!el || !page) return;
    const v = fitView(contentBounds(page), pageSize(page), { w: el.clientWidth, h: el.clientHeight }, { min: minZoom, max: MAX_ZOOM });
    pendingCentre.current = { x: v.cx, y: v.cy };
    zoomRef.current = v.zoom;
    setZoom(v.zoom);
    setFitCount((n) => n + 1);
  }, [store, minZoom]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const c = pendingCentre.current;
    if (c && el) {
      // Centre a page point (Fit): find where the page sits in the scrolled content.
      pendingCentre.current = null;
      const pageEl = el.querySelector('.page');
      if (pageEl) {
        const pr = pageEl.getBoundingClientRect(), sr = el.getBoundingClientRect();
        el.scrollLeft = pr.left - sr.left + el.scrollLeft + c.x * zoom - el.clientWidth / 2;
        el.scrollTop = pr.top - sr.top + el.scrollTop + c.y * zoom - el.clientHeight / 2;
      }
      return;
    }
    const a = pendingAnchor.current;
    if (!a || !el) return;
    pendingAnchor.current = null;
    el.scrollLeft = a.cx * zoom - a.px;
    el.scrollTop = a.cy * zoom - a.py;
  }, [zoom, fitCount]);


  // Ctrl/⌘ + wheel (and trackpad pinch, which browsers report as ctrl+wheel) zooms.
  useEffect(() => {
    const el = scrollerRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoomAt(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    const prevent = (e: Event) => e.preventDefault(); // Safari page-zoom gestures
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', prevent);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', prevent);
    };
  }, [setZoomAt]);

  // --- Touch pan / pinch (capture phase, runs before page handlers) ----------------
  const pinch = useRef<{ dist: number; zoom: number; c: { x: number; y: number } } | null>(null);
  const centroid = () => {
    const pts = [...gesture.current.touches.values()];
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  };
  const spread = () => {
    const [a, b] = [...gesture.current.touches.values()];
    return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const resetPinch = () => {
    pinch.current = gesture.current.touches.size ? { dist: spread(), zoom: zoomRef.current, c: centroid() } : null;
  };
  const isUiTarget = (t: EventTarget) => t instanceof Element && !!t.closest('[data-no-gesture]');

  const onTouchDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' || isUiTarget(e.target)) return;
    const g = gesture.current;
    g.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // One finger pans when it can't draw: in Stylus only mode, and in read-only mode.
    if (penOnly || readOnly || g.touches.size >= 2) {
      g.active = true;
      resetPinch();
    }
  };
  const onTouchMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (e.pointerType !== 'touch' || !g.touches.has(e.pointerId)) return;
    g.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = scrollerRef.current;
    const p = pinch.current;
    if (!g.active || !el || !p) return;
    const c = centroid();
    el.scrollLeft -= c.x - p.c.x;
    el.scrollTop -= c.y - p.c.y;
    p.c = c;
    if (g.touches.size >= 2 && p.dist > 0) setZoomAt((p.zoom * spread()) / p.dist, c.x, c.y);
  };
  const onTouchUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (e.pointerType !== 'touch' || !g.touches.delete(e.pointerId)) return;
    if (!g.touches.size) g.active = false;
    resetPinch();
  };

  // --- Commands ---------------------------------------------------------------
  const inkTool: ColorTool | null = toolKind === 'pen' || toolKind === 'highlighter' || toolKind === 'shapes' ? toolKind : null;
  const tool: ToolState = {
    kind: toolKind,
    color: inkTool ? ink[inkTool].color : '#000',
    width: inkTool ? ink[inkTool].width : 1,
    penStyle: ink.pen.style,
    sharpness: ink.pen.sharpness,
    dash: inkTool === 'pen' || inkTool === 'shapes' ? ink[inkTool].dash : 'solid',
    stabilise: inkTool ? normaliseStabilise(ink[inkTool].stabilise) : DEFAULT_STABILISE,
    straight: ink.highlighter.straight,
    eraserPx: eraser.size,
    eraseMode: eraser.mode,
    eraseKinds: eraser.kinds,
    lassoShape: lasso.shape,
    lassoKinds: lasso.kinds,
    snap,
    text: textStyle,
    stickyColor,
    tapeColor,
    scribbleErase,
    shapeFill: ink.shapes.fill,
  };

  // --- Ruler and zoom window --------------------------------------------------------------
  const toggleRuler = () => {
    if (rulerRef.current) return setRuler(null);
    const area = areaRef.current;
    const w = area?.clientWidth ?? 800;
    const h = area?.clientHeight ?? 600;
    setRuler({ cx: w / 2, cy: h / 2, angle: 0, length: Math.min(w * 0.9, 1100), width: 64 });
  };
  /** The ruler's edges in client coordinates, for PageView to snap strokes to. */
  const rulerEdgesClient = useCallback(() => {
    const r = rulerRef.current;
    const area = areaRef.current?.getBoundingClientRect();
    return r && area ? rulerEdges({ ...r, cx: r.cx + area.left, cy: r.cy + area.top }) : null;
  }, []);

  const toggleZoomWindow = () => {
    if (zoomTarget) return setZoomTarget(null);
    const page = store.doc.pages[currentPage];
    if (page) setZoomTarget(defaultTarget(page.id, page.template, undefined, pageSize(page)));
  };
  const zoomPage = zoomTarget ? doc.pages.find((p) => p.id === zoomTarget.pageId) : undefined;
  // The page under the zoom window was deleted.
  useEffect(() => {
    if (zoomTarget && !zoomPage) setZoomTarget(null);
  }, [zoomTarget, zoomPage]);
  // Keep the target box in view as it moves down the page.
  useEffect(() => {
    const el = scrollerRef.current?.querySelector('.zoom-target');
    const view = scrollerRef.current?.getBoundingClientRect();
    if (!el || !view) return;
    const r = el.getBoundingClientRect();
    if (r.top < view.top || r.bottom > view.bottom || r.left < view.left || r.right > view.right) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [zoomTarget]);

  // --- Photos: file picker, paste and drag-and-drop ------------------------------------
  /**
   * Page and page point to place things at: the drop point, or the middle of the visible part of the
   * current page. With `requirePage`, a drop point off the pages gives null instead.
   */
  const photoTarget = (clientX?: number, clientY?: number, requirePage = false): { pageId: string; x: number; y: number } | null => {
    const scroller = scrollerRef.current;
    if (!scroller) return null;
    let el = clientX !== undefined && clientY !== undefined ? document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-page-id]') : null;
    if (!el && requirePage && clientX !== undefined) return null;
    const page = store.doc.pages[currentPage];
    if (!el && page) el = scroller.querySelector<HTMLElement>(`[data-page-id="${page.id}"]`);
    if (!el?.dataset.pageId) return null;
    const r = el.getBoundingClientRect();
    if (clientX === undefined || clientY === undefined || !el.contains(document.elementFromPoint(clientX, clientY))) {
      const v = scroller.getBoundingClientRect();
      clientX = (Math.max(r.left, v.left) + Math.min(r.right, v.right)) / 2;
      clientY = (Math.max(r.top, v.top) + Math.min(r.bottom, v.bottom)) / 2;
    }
    return { pageId: el.dataset.pageId, x: (clientX - r.left) / zoomRef.current, y: (clientY - r.top) / zoomRef.current };
  };

  const insertPhotos = async (files: File[], clientX?: number, clientY?: number) => {
    const images = files.filter(isImageFile);
    const target = photoTarget(clientX, clientY);
    if (!images.length || !target || layerBlocked(target.pageId)) return;
    const size = pageSize(store.doc.pages.find((p) => p.id === target.pageId) ?? {});
    const items: PageItem[] = [];
    for (const [i, file] of images.entries()) {
      try {
        const prepared = await prepareImage(file);
        const blobId = newId();
        await putBlob({ docId: store.doc.id, id: blobId, type: prepared.type, bytes: prepared.bytes });
        primeImage(store.doc.id, blobId, prepared.img);
        // Several photos at once are fanned out so they don't stack exactly.
        items.push(newImage(blobId, prepared.width, prepared.height, { x: target.x + i * 24, y: target.y + i * 24 }, size));
      } catch (e) {
        alert(`Could not add ${file.name || 'the image'}: ${(e as Error).message}`);
      }
    }
    if (!items.length) return;
    store.dispatch([{ type: 'items.added', pageId: target.pageId, items }]);
    setToolKind('lasso');
    setSelection({ pageId: target.pageId, strokeIds: [], itemIds: items.map((it) => it.id) });
  };
  // --- Audio recording -----------------------------------------------------------------------
  const recordings = doc.recordings ?? [];
  /** Stop the recorder and add the recording to this notebook (one undoable step). */
  const finishRecording = async (): Promise<string | null> => {
    const result = await stopRecording();
    if (!result || result.durationMs < 500) return null;
    const blobId = newId();
    await putBlob({ docId: store.doc.id, id: blobId, type: result.mimeType, bytes: await result.blob.arrayBuffer() });
    const rec: Recording = {
      id: result.id,
      blobId,
      name: `Recording ${(store.doc.recordings?.length ?? 0) + 1}`,
      createdAt: Date.now(),
      durationMs: result.durationMs,
      mimeType: result.mimeType,
    };
    store.dispatch([{ type: 'recording.added', recording: rec }]);
    return rec.id;
  };
  const deleteRecording = (rec: Recording) => {
    const index = (store.doc.recordings ?? []).findIndex((r) => r.id === rec.id);
    if (index >= 0) store.dispatch([{ type: 'recording.removed', recording: rec, index }]);
  };
  // Leaving mid-recording would lose it: ask the browser to warn, and save it when going back to the library.
  useEffect(() => {
    if (recState === 'idle') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [recState]);
  const exit = async () => {
    if (recState !== 'idle') await finishRecording();
    // A quick note's tab closes when you leave it, so an empty one is discarded as before.
    if (meta.quicknote) closeTab(meta.id, meta.id);
    onExit();
  };

  /** Tabs: switch to another open notebook, or close one (the shown one closes to its neighbour). */
  const switchTab = (id: string) => (location.hash = `#/n/${id}`);
  const tabClosed = (id: string, next: string | null) => {
    if (id !== meta.id) {
      afterEditorClose(settleQuicknoteById(id));
      return;
    }
    if (next) switchTab(next);
    else onExit();
  };
  const seekInk = useCallback((rec: string, t: number) => audioApi.current?.seek(rec, t), []);

  // --- Elements ---------------------------------------------------------------------------
  const [elementsVersion, setElementsVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  /** Tell the person why nothing was added when page `pageId`'s active layer is hidden or locked. */
  const layerBlocked = (pageId: string): boolean => {
    const page = store.doc.pages.find((p) => p.id === pageId);
    const layer = page && findLayer(page, store.activeLayer(pageId));
    if (!layer || (!layer.hidden && !layer.locked)) return false;
    setNotice(layerNotice(layer.name, layer.hidden ? 'hidden' : 'locked'));
    return true;
  };

  const saveAsElement = async (sel: Selection) => {
    const page = store.doc.pages.find((p) => p.id === sel.pageId);
    const content = page && makeElementContent(page, sel);
    if (!content) return;
    try {
      const blobs = (await getBlobs(store.doc.id, elementBlobIds(content))).map(({ id, type, bytes }) => ({ id, type, bytes }));
      const count = (await listElements()).length;
      const el: SavedElement = {
        ...content,
        id: newId(),
        name: defaultElementName(content, count),
        createdAt: Date.now(),
        thumbnail: renderContentThumbnail(content, imageResolver(store.doc.id)),
        blobs,
      };
      await saveElement(el);
      setElementsVersion((v) => v + 1);
      setNotice(`Saved “${el.name}” to Elements`);
    } catch (e) {
      alert(`Could not save the element: ${(e as Error).message}`);
    }
  };

  // --- Study sets ------------------------------------------------------------------------------
  // A card being made from the lasso; `picking` while its back is being lassoed on the page.
  const [cardDraft, setCardDraft] = useState<{ draft: CardDraft; picking: boolean } | null>(null);
  const addToStudySet = (sel: Selection) => {
    const page = store.doc.pages.find((p) => p.id === sel.pageId);
    const drawing = page ? makeElementContent(page, sel) : null;
    if (!drawing) return;
    if (cardDraft?.picking) setCardDraft({ draft: { ...cardDraft.draft, back: { text: '', drawing } }, picking: false });
    else setCardDraft({ draft: { front: { text: '', drawing }, back: { text: '' }, source: { docId: store.doc.id, pageId: sel.pageId } }, picking: false });
    setSelection(null);
  };

  const placeElementAt = async (el: SavedElement, clientX?: number, clientY?: number): Promise<boolean> => {
    const target = photoTarget(clientX, clientY, clientX !== undefined);
    if (!target || layerBlocked(target.pageId)) return false;
    // Photos are stored per notebook, so copy the element's into this one first.
    for (const b of el.blobs) await putBlob({ docId: store.doc.id, ...b });
    const placed = placeElement(el, target.pageId, target, pageSize(store.doc.pages.find((p) => p.id === target.pageId) ?? {}));
    if (!placed.ops.length) return false;
    store.dispatch(placed.ops);
    setToolKind('lasso');
    setSelection(placed.selection);
    return true;
  };

  const insertPhotosRef = useRef(insertPhotos);
  insertPhotosRef.current = insertPhotos;

  /** A pasted web address becomes a link, centred where the photo would go. */
  const pasteLink = (url: string) => {
    const target = photoTarget();
    if (!target || layerBlocked(target.pageId)) return;
    const label = linkLabel(url);
    const w = measurer('sans', LINK_TEXT_SIZE)(label) + 2 * LINK_PAD + 2;
    const h = LINK_TEXT_SIZE * 1.4 + 2 * LINK_PAD;
    const size = pageSize(store.doc.pages.find((p) => p.id === target.pageId) ?? {});
    const x = Math.max(0, Math.min(target.x - w / 2, size.w - w));
    const y = Math.max(0, Math.min(target.y - h / 2, size.h - h));
    const link = newLink({ x, y, w, h }, { kind: 'url', url }, label);
    store.dispatch([{ type: 'items.added', pageId: target.pageId, items: [link] }]);
    setToolKind('lasso');
    setSelection({ pageId: target.pageId, strokeIds: [], itemIds: [link.id] });
  };
  const pasteLinkRef = useRef(pasteLink);
  pasteLinkRef.current = pasteLink;

  // --- Cut, copy and paste ------------------------------------------------------------
  // Copy events must fill the clipboard synchronously, so the selected photos' bytes are fetched
  // as soon as something is selected.
  const clipBlobs = useRef(new Map<string, ClipBlob>());
  useEffect(() => {
    const page = selection && store.doc.pages.find((p) => p.id === selection.pageId);
    const content = page && makeElementContent(page, selection);
    const missing = content ? elementBlobIds(content).filter((id) => !clipBlobs.current.has(id)) : [];
    if (!missing.length) return;
    void getBlobs(store.doc.id, missing).then((blobs) => {
      for (const { id, type, bytes } of blobs) clipBlobs.current.set(id, { id, type, bytes });
    });
  }, [selection, store]);

  /** The selection as a clip, fetching any photo bytes not yet fetched. */
  const clipOf = async (sel: Selection): Promise<Clip | null> => {
    const page = store.doc.pages.find((p) => p.id === sel.pageId);
    const content = page && makeElementContent(page, sel);
    if (!content) return null;
    const ids = elementBlobIds(content).filter((id) => !clipBlobs.current.has(id));
    if (ids.length) for (const { id, type, bytes } of await getBlobs(store.doc.id, ids)) clipBlobs.current.set(id, { id, type, bytes });
    return { content, blobs: elementBlobIds(content).flatMap((id) => clipBlobs.current.get(id) ?? []) };
  };
  /** The same, now or never: null if a photo's bytes haven't been fetched yet. */
  const clipOfSync = (sel: Selection): Clip | null => {
    const page = store.doc.pages.find((p) => p.id === sel.pageId);
    const content = page && makeElementContent(page, sel);
    if (!content) return null;
    const ids = elementBlobIds(content);
    return ids.every((id) => clipBlobs.current.has(id)) ? { content, blobs: ids.map((id) => clipBlobs.current.get(id)!) } : null;
  };

  const removeSelection = (sel: Selection) => {
    const page = store.doc.pages.find((p) => p.id === sel.pageId);
    if (page) store.dispatch(deleteSelectionOps(page, sel));
    setSelection(null);
  };

  /** Copy (or cut) from the selection menu. */
  const copySelection = async (sel: Selection, cut: boolean) => {
    const clip = await clipOf(sel);
    if (!clip) return;
    if (!(await writeClip(clip, imageResolver(store.doc.id)))) {
      setNotice('Could not reach the clipboard; Paste in this tab still works');
    } else {
      setNotice(cut ? 'Cut' : 'Copied');
    }
    if (cut) removeSelection(sel);
  };

  /** A region screenshot: a new photo on the same page, the clipboard, or a PNG download. */
  const takeScreenshot = async (pageId: string, rect: Rect, action: 'insert' | 'copy' | 'save') => {
    const page = store.doc.pages.find((p) => p.id === pageId);
    if (!page) return;
    const png = renderRegionPng(page, store.doc.id, rect);
    try {
      if (action === 'copy') {
        // The promise goes straight into the ClipboardItem so Safari still counts the tap as the gesture.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png.then((b) => b ?? Promise.reject(new Error('no image'))) })]);
        setNotice('Screenshot copied');
        return;
      }
      const blob = await png;
      if (!blob) throw new Error('could not draw the region');
      if (action === 'save') {
        downloadBlob(blob, `${meta.title || 'Notebook'} screenshot.png`);
        return;
      }
      if (layerBlocked(pageId)) return;
      const blobId = newId();
      await putBlob({ docId: store.doc.id, id: blobId, type: 'image/png', bytes: await blob.arrayBuffer() });
      const item = screenshotImage(blobId, rect, pageSize(page));
      store.dispatch([{ type: 'items.added', pageId, items: [item] }]);
      setSelection({ pageId, strokeIds: [], itemIds: [item.id] });
    } catch (e) {
      alert(`Could not take the screenshot: ${(e as Error).message}`);
    }
  };

  /** Paste a clip centred in view, as a new selection. Its photos are copied into this notebook first. */
  const pasteClip = async (clip: Clip) => {
    const target = photoTarget();
    if (!target || layerBlocked(target.pageId)) return;
    try {
      for (const b of clip.blobs) await putBlob({ docId: store.doc.id, ...b });
    } catch (e) {
      alert(`Could not paste the photos: ${(e as Error).message}`);
      return;
    }
    const placed = placeElement(clip.content, target.pageId, target, pageSize(store.doc.pages.find((p) => p.id === target.pageId) ?? {}));
    if (!placed.ops.length) return;
    store.dispatch(placed.ops);
    setToolKind('lasso');
    setSelection(placed.selection);
  };

  const applyPasted = (p: Pasted) => {
    if (p.kind === 'clip') void pasteClip(p.clip);
    else if (p.kind === 'images') void insertPhotosRef.current(p.files);
    else pasteLinkRef.current(p.url);
  };
  const pasteFromButton = async () => {
    const p = await readPasted();
    if (p) applyPasted(p);
    else setNotice('Nothing to paste');
  };

  const clipRef = useRef({ selection, clipOfSync, copySelection, removeSelection, applyPasted });
  clipRef.current = { selection, clipOfSync, copySelection, removeSelection, applyPasted };

  useEffect(() => {
    const editing = (t: EventTarget | null) => t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || (t instanceof HTMLElement && t.isContentEditable);
    const onCopyOrCut = (e: ClipboardEvent) => {
      const { selection: sel, clipOfSync, copySelection, removeSelection } = clipRef.current;
      const cut = e.type === 'cut';
      if (!sel || editing(e.target) || (cut && readOnlyRef.current)) return;
      // Ignore a copy of ordinary page text the person has highlighted.
      if (!document.getSelection()?.isCollapsed && document.getSelection()?.toString()) return;
      const clip = clipOfSync(sel);
      if (clip && writeClipToEvent(e, clip, imageResolver(store.doc.id))) {
        if (cut) removeSelection(sel);
        return;
      }
      e.preventDefault();
      void copySelection(sel, cut);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (readOnlyRef.current || editing(e.target)) return;
      const p = pastedFromEvent(e);
      if (!p) return;
      e.preventDefault();
      clipRef.current.applyPasted(p);
    };
    window.addEventListener('copy', onCopyOrCut);
    window.addEventListener('cut', onCopyOrCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopyOrCut);
      window.removeEventListener('cut', onCopyOrCut);
      window.removeEventListener('paste', onPaste);
    };
  }, [store]);

  // --- Page actions -------------------------------------------------------------------
  // Dialogs name their page by id, so a reorder while one is open can't retarget it.
  const [pageDialog, setPageDialog] = useState<null | { kind: 'template' | 'move' | 'copy'; pageId: string }>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => readPref('jnotes.sidebar', false));
  useEffect(() => writePref('jnotes.sidebar', sidebarOpen), [sidebarOpen]);

  /** Where a page is inside the scrolled content, measured from the page itself, so it holds for either layout. */
  const pageBox = (index: number): { left: number; top: number; width: number; height: number } | null => {
    const el = scrollerRef.current;
    const id = store.doc.pages[index]?.id;
    const node = id ? el?.querySelector<HTMLElement>(`[data-page-id="${id}"]`) : null;
    if (!el || !node) return null;
    const r = node.getBoundingClientRect();
    const v = el.getBoundingClientRect();
    return { left: r.left - v.left + el.scrollLeft, top: r.top - v.top + el.scrollTop, width: r.width, height: r.height };
  };

  // Switching layout keeps the page you were on in view.
  const keepPage = useRef<number | null>(null);
  // --- Settings and the shortcuts sheet ---------------------------------------------------
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const settingsValues: EditorSettings = {
    penOnly,
    scribbleErase,
    snap,
    scroll: scrollDir,
    straightHighlighter: ink.highlighter.straight,
    stabilise: { pen: normaliseStabilise(ink.pen.stabilise), highlighter: normaliseStabilise(ink.highlighter.stabilise), shapes: normaliseStabilise(ink.shapes.stabilise) },
  };
  const changeSettings = (p: Partial<EditorSettings>) => {
    if (p.penOnly !== undefined) setPenOnly(p.penOnly);
    if (p.scribbleErase !== undefined) setScribbleErase(p.scribbleErase);
    if (p.snap !== undefined) setSnap(p.snap);
    if (p.scroll !== undefined && p.scroll !== scrollDir) toggleScrollDir();
    if (p.straightHighlighter !== undefined) setHighlighter({ straight: p.straightHighlighter });
    for (const [t, v] of Object.entries(p.stabilise ?? {})) setStabilise(t as InkToolName, v);
  };

  const toggleScrollDir = () => {
    keepPage.current = currentPage;
    setScrollDir((d) => (d === 'vertical' ? 'horizontal' : 'vertical'));
  };
  useEffect(() => {
    if (keepPage.current === null) return;
    scrollToPage(keepPage.current, 'auto');
    keepPage.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollDir]);

  /** Bring a page into view: its top edge (stacked), or centred if it fits (side by side). */
  const scrollToPage = (index: number, behavior: ScrollBehavior = 'smooth') =>
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      const box = pageBox(index);
      if (!el || !box) return;
      if (scrollDir === 'vertical') el.scrollTo({ top: Math.max(0, box.top - 16), behavior });
      else el.scrollTo({ left: Math.max(0, box.width < el.clientWidth ? box.left - (el.clientWidth - box.width) / 2 : box.left - 16), behavior });
    });

  // Opened to show a particular page (a flashcard's source).
  useEffect(() => {
    const pageId = takePageJump(initialMeta.id);
    const index = pageId ? store.doc.pages.findIndex((p) => p.id === pageId) : -1;
    if (index >= 0) scrollToPage(index, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Dispatch a page.added op (one undo step) and scroll to the new page. */
  const addPageOp = (op: ReturnType<typeof insertPageOp>) => {
    if (op?.type !== 'page.added') return;
    store.dispatch([op]);
    scrollToPage(op.index);
  };

  // A new page copies the template, size, paper and custom template image of the page it is next to.
  const addPage = () => addPageOp(insertPageOp(store.doc, currentPage, 'after'));

  const applyTemplate = async (pageId: string, choice: Template | CustomTemplate) => {
    setPageDialog(null);
    const page = store.doc.pages.find((p) => p.id === pageId);
    if (!page) return;
    if (typeof choice === 'string') {
      const op = changeTemplateOp(page, choice);
      if (op) store.dispatch([op]);
      return;
    }
    await putBlob({ docId: store.doc.id, ...choice.blob });
    primeImage(store.doc.id, choice.blob.id, choice.img);
    const op = changeTemplateOp(store.doc.pages.find((p) => p.id === pageId) ?? page, { kind: 'image', blobId: choice.blob.id });
    if (op) store.dispatch([op]);
  };

  /**
   * Copy a page, with its photos and template image, to the end of another notebook.
   * A move then removes it here, as one undo step; undo doesn't take it back out of the other notebook.
   */
  const sendPage = async (pageId: string, target: NotebookMeta, mode: 'move' | 'copy') => {
    const page = store.doc.pages.find((p) => p.id === pageId);
    if (!page) return;
    const blobs = await getBlobs(store.doc.id, pageBlobIds(page));
    await appendPage(target.id, clonePage(page, { keepRecordings: false }), blobs.map(({ id, type, bytes }) => ({ id, type, bytes })));
    const index = store.doc.pages.findIndex((p) => p.id === pageId);
    if (mode === 'move' && index >= 0 && store.doc.pages.length > 1) store.dispatch([{ type: 'page.removed', page: store.doc.pages[index], index }]);
    setPageDialog(null);
    setNotice(`${mode === 'move' ? 'Moved' : 'Copied'} page to “${target.title}”`);
  };

  const deletePageAt = (index: number) => {
    const page = store.doc.pages[index];
    if (!page || store.doc.pages.length <= 1) return;
    if ((page.strokes.length || page.items.length) && !confirm(`Delete page ${index + 1}? You can undo this.`)) return;
    store.dispatch([{ type: 'page.removed', page, index }]);
  };
  const deletePage = () => deletePageAt(currentPage);

  // Insert PDF pages or images after a page. The input is shared; the target page is remembered by id.
  const pagesInput = useRef<HTMLInputElement>(null);
  const insertAfter = useRef<string | null>(null);
  const insertFiles = async (files: File[]) => {
    const { pages, blobs, skipped } = await pagesFromFiles(files);
    if (skipped.length) alert(`Could not insert: ${skipped.join(', ')}`);
    if (!pages.length) return;
    for (const b of blobs) await putBlob({ docId: store.doc.id, ...b });
    const after = store.doc.pages.findIndex((p) => p.id === insertAfter.current);
    const index = after < 0 ? store.doc.pages.length : after + 1;
    store.dispatch(insertPagesOps(store.doc, index, pages)); // one undo step for all of them
    scrollToPage(index);
    setNotice(`Added ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`);
  };

  /** The actions for page `index`, shared by the toolbar's page menu and the sidebar. */
  const pageActions = (index: number): PageActionHandlers => {
    const pageId = store.doc.pages[index]?.id ?? '';
    return {
      insert: (where) => addPageOp(insertPageOp(store.doc, index, where)),
      duplicate: () => addPageOp(duplicatePageOp(store.doc, index)),
      insertFiles: () => {
        insertAfter.current = pageId;
        pagesInput.current?.click();
      },
      // A PDF page keeps its PDF; it has no template to change.
      changeTemplate: store.doc.pages[index]?.background?.kind === 'pdf' ? undefined : () => setPageDialog({ kind: 'template', pageId }),
      move: store.doc.pages.length > 1 ? () => setPageDialog({ kind: 'move', pageId }) : undefined,
      copy: () => setPageDialog({ kind: 'copy', pageId }),
      remove: store.doc.pages.length > 1 ? () => deletePageAt(index) : undefined,
    };
  };

  const toggleBookmark = (pageId: string) => {
    const op = toggleBookmarkOp(store.doc, pageId);
    if (op) store.dispatch([op]);
  };
  const currentBookmarked = !!doc.pages[currentPage] && isBookmarked(doc, doc.pages[currentPage].id);

  // --- Layers ----------------------------------------------------------------------------------
  const [layersOpen, setLayersOpen] = useState(false);
  const [layerExportOpen, setLayerExportOpen] = useState(false);
  const layersPage = doc.pages[board ? 0 : currentPage];
  /** The current page as tools see it: the unlocked content of its active layer. */
  const workingPage = layersPage && workingContent(layersPage, store.activeLayer(layersPage.id));
  const chooseLayer = (pageId: string, layerId: string) => {
    // A selection belongs to the layer it was made on.
    if (selection?.pageId === pageId) setSelection(null);
    store.setActiveLayer(pageId, layerId);
  };
  const exportLayers = async (page: Page, ids: ReadonlySet<string>, format: 'png' | 'pdf') => {
    let only = withLayers(page, (l) => ids.has(l.id));
    if (board) only = cropToContent(only);
    const name = board ? meta.title : `${meta.title} p${currentPage + 1}`;
    if (format === 'png') {
      await exportPagePng(only, doc.id, `${name}.png`);
    } else {
      const { exportPdf } = await import('../io/pdfExport');
      const bytes = await exportPdf({ ...store.doc, pages: [only] }, store.doc.id, meta.title, { pages: [0], background: true });
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${name}.pdf`);
    }
    setLayerExportOpen(false);
  };

  // --- PDF text search -------------------------------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHit, setSearchHit] = useState<SearchHit | null>(null);
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchHit(null);
  };
  /** Scroll so the match sits a third of the way down the view, and highlight it. */
  const showSearchHit = (hit: SearchHit) => {
    setSearchHit(hit);
    const index = store.doc.pages.findIndex((p) => p.id === hit.pageId);
    const el = scrollerRef.current;
    if (index < 0 || !el) return;
    const box = pageBox(index);
    if (!box) return;
    const y = hit.rects.length ? Math.min(...hit.rects.map((r) => r.y)) : 0;
    const x = hit.rects.length ? Math.min(...hit.rects.map((r) => r.x)) : 0;
    const top = box.top + y * zoom - el.clientHeight / 3;
    // Side by side, also bring the page across; stacked, keep the sideways position unless the match is out of view.
    const left = scrollDir === 'horizontal' || box.left + x * zoom > el.scrollLeft + el.clientWidth - 40 ? box.left + x * zoom - el.clientWidth / 3 : el.scrollLeft;
    el.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'auto' });
  };

  // Turning read-only on puts down whatever was in hand.
  useEffect(() => {
    if (!readOnly) return;
    setSelection(null);
    setZoomTarget(null);
    setRuler(null);
  }, [readOnly]);

  // --- Outline -----------------------------------------------------------------------------
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('pages');
  const [outlineRenaming, setOutlineRenaming] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>();

  /** Add an entry and show it in the Outline tab, ready to be named. */
  const addToOutline = (target: Pick<OutlineEntry, 'pageId' | 'rect'>, title: string) => {
    const added = addOutlineEntry(store.doc, target, title);
    if (!added) return;
    store.dispatch([added.op]);
    setSidebarOpen(true);
    setSidebarTab('outline');
    setOutlineRenaming(added.id);
  };

  const addSelectionToOutline = (sel: Selection) => {
    const index = store.doc.pages.findIndex((p) => p.id === sel.pageId);
    const page = store.doc.pages[index];
    const b = page && selectionBounds(page, sel);
    if (!page || !b) return;
    // Name it after selected typed text, if there is any.
    const text = page.items.find((it): it is Extract<typeof it, { kind: 'text' }> => it.kind === 'text' && sel.itemIds.includes(it.id) && !!it.text.trim());
    const title = text ? text.text.trim().split('\n')[0].slice(0, 60) : `Page ${index + 1}`;
    setSelection(null);
    addToOutline({ pageId: page.id, rect: { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY } }, title);
  };

  /** Go to an entry: its page, or its region, which is briefly highlighted. */
  const jumpToEntry = (entry: OutlineEntry) => {
    const index = store.doc.pages.findIndex((p) => p.id === entry.pageId);
    if (index < 0) return;
    if (!entry.rect) return scrollToPage(index);
    showSearchHit({ pageId: entry.pageId, rects: [entry.rect] });
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setSearchHit((h) => (h?.pageId === entry.pageId ? null : h)), 1600);
  };

  // --- Presenting --------------------------------------------------------------------------
  const presenter = usePresenter(store, meta.title, doc.pages[currentPage]?.id);
  const startPresenting = () => {
    presenter.start();
    if (!readOnly) setToolKind('laser'); // the laser is what you'll want in front of an audience
  };

  // --- Links ---------------------------------------------------------------------------------
  const [linkDialog, setLinkDialog] = useState<{ sel: Selection; link: LinkItem | null } | null>(null);
  /** Where page links were followed from, for Back. */
  const [back, setBack] = useState<BackEntry[]>([]);

  const followLink = (target: LinkTarget) => {
    if (target.kind === 'url') {
      window.open(target.url, '_blank', 'noopener,noreferrer');
      return;
    }
    const index = store.doc.pages.findIndex((p) => p.id === target.pageId);
    const el = scrollerRef.current;
    if (index < 0 || !el) {
      setNotice('That page is no longer in this notebook');
      return;
    }
    setBack((b) => pushBack(b, { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, pageIndex: currentPage }));
    scrollToPage(index, 'auto');
  };

  /** Return to exactly where the last page link was followed from. */
  const goBack = () => {
    const last = back[back.length - 1];
    if (!last) return;
    setBack(back.slice(0, -1));
    scrollerRef.current?.scrollTo({ top: last.scrollTop, left: last.scrollLeft, behavior: 'auto' });
  };

  const saveLink = (target: LinkTarget | null) => {
    const d = linkDialog;
    setLinkDialog(null);
    if (!d) return;
    const page = store.doc.pages.find((p) => p.id === d.sel.pageId);
    if (!page) return;
    if (d.link) {
      const op = target ? updateItemOp(page, d.link.id, { target }) : removeItemsOp(page, [d.link.id]);
      if (op) store.dispatch([op]);
      return;
    }
    const b = target && selectionBounds(page, d.sel);
    if (!target || !b) return;
    const link = newLink({ x: b.minX - 2, y: b.minY - 2, w: b.maxX - b.minX + 4, h: b.maxY - b.minY + 4 }, target);
    store.dispatch([{ type: 'items.added', pageId: page.id, items: [link] }]);
    setSelection(null);
  };

  const movePage = (pageId: string, to: number) => {
    const op = movePageOp(store.doc, pageId, to);
    if (op) store.dispatch([op]);
  };

  const rename = (title: string) => {
    const t = title.trim() || 'Untitled';
    if (t === meta.title) return;
    // Naming a quick note means keeping it, even before anything is written in it.
    setMeta((m) => ({ ...m, title: t, quicknote: undefined }));
    void updateMeta(meta.id, { title: t, quicknote: undefined });
  };

  const [pdfExportOpen, setPdfExportOpen] = useState(false);
  const exportAsPdf = async (pages: number[], background: boolean, layers: ReadonlySet<string> | null) => {
    const { exportPdf } = await import('../io/pdfExport');
    // Chosen layers are matched by name, since each page has its own.
    const source = layers ? { ...store.doc, pages: store.doc.pages.map((p) => withLayers(p, (l) => layers.has(l.name))) } : store.doc;
    const bytes = await exportPdf(source, store.doc.id, meta.title, { pages, background });
    const suffix = pages.length === 1 ? ` p${pages[0] + 1}` : '';
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${meta.title}${suffix}.pdf`);
    setPdfExportOpen(false);
  };

  const exportBoardPdf = async () => {
    const page = store.doc.pages[0];
    if (!page) return;
    const { exportPdf } = await import('../io/pdfExport');
    const bytes = await exportPdf({ ...store.doc, pages: [cropToContent(visibleContent(page))] }, store.doc.id, meta.title, { pages: [0], background: true });
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${meta.title}.pdf`);
  };

  const exportJson = async () => {
    const blobs = await getBlobs(doc.id, referencedBlobIds(doc));
    const blob = new Blob([JSON.stringify(toFile(meta, doc, blobs))], { type: 'application/json' });
    downloadBlob(blob, `${meta.title}.jnotes.json`);
  };

  // --- Toolbar ------------------------------------------------------------------
  const visible = visibleItems(toolbarPrefs).filter((i) => i !== 'audio' || recordingSupported());
  const allFit = visible.length * TOOLBAR_ITEM_W <= itemRoom;
  // Leave room for the More button itself, and keep at least one item on the bar.
  const shownCount = allFit ? visible.length : Math.max(1, Math.floor((itemRoom - TOOLBAR_ITEM_W) / TOOLBAR_ITEM_W));
  const shownItems = visible.slice(0, shownCount);
  const overflowItems = visible.slice(shownCount);

  /** One customisable toolbar button, in the user's chosen order. */
  const renderToolbarItem = (item: ToolbarItem) => {
    const tool = TOOLS.find((t) => t.kind === item);
    if (tool) {
      const k = tool.kind;
      return (
        <button
          key={k}
          className={`icon-btn ${toolKind === k ? 'active' : ''}`}
          aria-pressed={toolKind === k}
          aria-label={tool.label}
          title={`${tool.label} (${tool.key})`}
          onClick={() => {
            setToolKind(k);
            setSelection(null);
          }}
        >
          <Icon name={k} />
        </button>
      );
    }
    switch (item) {
      case 'ruler':
        return (
          <button key={item} className={`icon-btn ${ruler ? 'active' : ''}`} aria-pressed={!!ruler} aria-label="Ruler" title="Ruler (R)" onClick={toggleRuler}>
            <Icon name="ruler" />
          </button>
        );
      case 'zoomWindow':
        return (
          <button key={item} className={`icon-btn ${zoomTarget ? 'active' : ''}`} aria-pressed={!!zoomTarget} aria-label="Zoom window" title="Zoom window (W)" onClick={toggleZoomWindow}>
            <Icon name="zoomWindow" />
          </button>
        );
      case 'photo':
        return (
          <button key={item} className="icon-btn" aria-label="Insert photo" title="Insert photo (or paste, or drop)" onClick={() => photoInput.current?.click()}>
            <Icon name="image" />
          </button>
        );
      case 'audio':
        return recordingSupported() ? (
          <button
            key={item}
            className={`icon-btn audio-btn ${audioOpen ? 'active' : ''} ${recState !== 'idle' ? 'is-recording' : ''}`}
            aria-pressed={audioOpen}
            aria-label={recState !== 'idle' ? 'Audio (recording)' : 'Audio recordings'}
            title={ITEM_INFO.audio.label}
            onClick={() => setAudioOpen(!audioOpen || recState !== 'idle')}
          >
            <Icon name="mic" />
          </button>
        ) : null;
      case 'elements':
        return <ElementsButton key={item} version={elementsVersion} onPlace={placeElementAt} />;
      case 'timer':
        return <TimerButton key={item} notebookId={meta.id} notebookTitle={meta.title} />;
      default:
        return null;
    }
  };

  // --- Keyboard ---------------------------------------------------------------
  const toggleRulerRef = useRef(toggleRuler);
  toggleRulerRef.current = toggleRuler;
  const toggleZoomRef = useRef(toggleZoomWindow);
  toggleZoomRef.current = toggleZoomWindow;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing (including in the formatted-text editor) keeps its keys, and its own undo.
      if ((e.target instanceof HTMLInputElement && e.target.type !== 'range') || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      // Read-only: only viewing shortcuts (zoom, search) work.
      if (readOnlyRef.current && !(mod && ['=', '+', '-', '0', 'f'].includes(e.key.toLowerCase()))) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setSelection(null);
        e.shiftKey ? store.redo() : store.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setZoomAt(zoomRef.current * 1.2);
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setLayersOpen(false);
        setSearchOpen(true);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        setZoomAt(zoomRef.current / 1.2);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        setZoomAt(1);
      } else if (!mod && selection && (e.key === 'Delete' || e.key === 'Backspace')) {
        const page = store.doc.pages.find((p) => p.id === selection.pageId);
        if (page) store.dispatch(deleteSelectionOps(page, selection));
        setSelection(null);
      } else if (e.key === 'Escape') {
        setSelection(null);
      } else if (!mod && e.key === SHORTCUTS_KEY) {
        setShortcutsOpen(true);
      } else if (!mod && e.key.toLowerCase() === 'r') {
        toggleRulerRef.current();
      } else if (!mod && e.key.toLowerCase() === 'w') {
        toggleZoomRef.current();
      } else if (!mod) {
        const k = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase())?.kind;
        if (k) {
          setToolKind(k);
          setSelection(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, selection, setZoomAt]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    savePosition(meta.id, { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft });
    const { starts } = pageOffsets(doc.pages, zoom, PAGE_GAP, scrollDir);
    setCurrentPage(pageIndexAt(starts, scrollDir === 'vertical' ? el.scrollTop + el.clientHeight / 2 : el.scrollLeft + el.clientWidth / 2));
  };

  return (
    <div className="editor">
      <TabsBar active={meta.id} activeTitle={meta.title} onSwitch={switchTab} onClosed={tabClosed} />
      <header className="toolbar" data-no-gesture ref={toolbarRef}>
        <div className="tb-group" ref={leftGroupRef}>
          <button className="icon-btn" onClick={() => void exit()} aria-label="Back to library" title="Library">
            <Icon name="back" />
          </button>
          <input className="title-input" readOnly={readOnly} defaultValue={meta.title} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Notebook title" />
          <span className={`save-status ${status}`} title="Saved locally on this device">
            {status === 'saved' ? 'Saved' : status === 'error' ? 'Save failed' : 'Saving…'}
          </span>
        </div>

        <div className="tb-group tools" role="toolbar" aria-label="Tools">
          {readOnly ? (
            <span className="read-only-chip">Read only · tap links to follow them</span>
          ) : (
            <>
              <button className="icon-btn" disabled={!store.canUndo} onClick={() => store.undo()} aria-label="Undo" title="Undo (⌘Z)">
                <Icon name="undo" />
              </button>
              <button className="icon-btn" disabled={!store.canRedo} onClick={() => store.redo()} aria-label="Redo" title="Redo (⇧⌘Z)">
                <Icon name="redo" />
              </button>
              <span className="divider" />
              {shownItems.map(renderToolbarItem)}
              {overflowItems.length > 0 && <OverflowMenu items={overflowItems} render={renderToolbarItem} active={overflowItems.some((i) => i === toolKind)} />}
              <span className="divider" />
              <button className="icon-btn" aria-label="Customise toolbar" title="Customise toolbar" onClick={() => setCustomising(true)}>
                <Icon name="sliders" />
              </button>
            </>
          )}
          <input
            ref={pagesInput}
            type="file"
            accept=".pdf,application/pdf,image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length) void insertFiles(files).catch((err: Error) => alert(`Could not insert: ${err.message}`));
            }}
          />
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void insertPhotos([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>

        <div className="tb-group" ref={rightGroupRef}>
          <button
            className={`chip ${penOnly ? 'active' : ''}`}
            aria-label="Stylus only"
            aria-pressed={penOnly}
            onClick={() => setPenOnly(!penOnly)}
            title="Stylus only: when on, fingers scroll and only a stylus draws"
          >
            <Icon name="stylus" /> <span className="chip-label">Stylus only</span>
          </button>
          <button className="icon-btn" onClick={() => setZoomAt(zoom / 1.2)} aria-label="Zoom out">
            <Icon name="minus" />
          </button>
          <button className="zoom-label" onClick={() => setZoomAt(1)} title="Reset zoom">
            {Math.round(zoom * 100)}%
          </button>
          <button className="icon-btn" onClick={() => setZoomAt(zoom * 1.2)} aria-label="Zoom in">
            <Icon name="plus" />
          </button>
          {board ? (
            <button className="btn sm ghost" onClick={fitToContent} title="Zoom to fit everything on the board">
              Fit
            </button>
          ) : (
          <button
            className="icon-btn"
            onClick={toggleScrollDir}
            aria-label={scrollDir === 'vertical' ? 'Scroll pages sideways' : 'Scroll pages up and down'}
            title={scrollDir === 'vertical' ? 'Pages scroll up and down (switch to sideways)' : 'Pages scroll sideways (switch to up and down)'}
          >
            <Icon name={scrollDir === 'vertical' ? 'scrollVertical' : 'scrollHorizontal'} />
          </button>
          )}
          <span className="divider" />
          {!board && (
          <button
            className={`icon-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={() => setSidebarOpen((o: boolean) => !o)}
            aria-pressed={sidebarOpen}
            aria-label="Page thumbnails"
            title="Page thumbnails"
          >
            <Icon name="sidebar" />
          </button>
          )}
          <button
            className={`icon-btn ${layersOpen ? 'active' : ''}`}
            onClick={() => {
              if (!layersOpen) closeSearch();
              setLayersOpen(!layersOpen);
            }}
            aria-pressed={layersOpen}
            aria-label="Layers"
            title={layersPage && pageLayers(layersPage).length > 1 ? `Layers (drawing on “${findLayer(layersPage, store.activeLayer(layersPage.id))?.name}”)` : 'Layers'}
          >
            <Icon name="layers" />
          </button>
          <button
            className={`icon-btn ${searchOpen ? 'active' : ''}`}
            onClick={() => {
              if (!searchOpen) setLayersOpen(false);
              if (searchOpen) closeSearch();
              else setSearchOpen(true);
            }}
            aria-pressed={searchOpen}
            aria-label={handwriting ? 'Search handwriting and PDF text' : 'Search PDF text'}
            title="Search (⌘F)"
          >
            <Icon name="search" />
          </button>
          {!board && (
          <button
            className={`icon-btn ${currentBookmarked ? 'active' : ''}`}
            onClick={() => doc.pages[currentPage] && toggleBookmark(doc.pages[currentPage].id)}
            aria-pressed={currentBookmarked}
            aria-label={currentBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            title={currentBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          >
            <Icon name="bookmark" />
          </button>
          )}
          {presenter.presenting ? (
            <button className="presenting-chip" onClick={presenter.stop} title="Stop presenting and close the presentation window">
              Presenting · Stop
            </button>
          ) : (
            <button className="icon-btn" onClick={startPresenting} aria-label="Present" title="Present in a second window (drag it to a projector or another screen)">
              <Icon name="present" />
            </button>
          )}
          <button
            className={`icon-btn ${readOnly ? 'active' : ''}`}
            onClick={() => setReadOnly(!readOnly)}
            aria-pressed={readOnly}
            aria-label="Read only"
            title={readOnly ? 'Read only: on (tap to edit again)' : 'Read only: tools off, taps follow links'}
          >
            <Icon name="readOnly" />
          </button>
          {!readOnly && !board && (
            <>
              <button className="icon-btn" onClick={addPage} aria-label="Add page after current" title="Add page">
                <Icon name="addPage" />
              </button>
              <button className="icon-btn" onClick={deletePage} disabled={doc.pages.length <= 1} aria-label="Delete current page" title="Delete page">
                <Icon name="trash" />
              </button>
              <details className="menu">
                <summary className="icon-btn" aria-label="Page actions" title="Page actions">
                  <Icon name="pages" />
                </summary>
                {/* Close the menu once an action is chosen. */}
                <div className="menu-pop" onClick={(e) => (e.target as HTMLElement).closest('button') && e.currentTarget.closest('details')?.removeAttribute('open')}>
                  <PageMenuItems actions={{ ...pageActions(currentPage), remove: undefined }} />
                </div>
              </details>
            </>
          )}
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title={`Settings (shortcuts: ${SHORTCUTS_KEY})`}>
            <Icon name="settings" />
          </button>
          <details className="menu">
            <summary className="icon-btn" aria-label="Export">
              <Icon name="share" />
            </summary>
            <div className="menu-pop" onClick={(e) => (e.target as HTMLElement).closest('button') && e.currentTarget.closest('details')?.removeAttribute('open')}>
              {board ? (
                <>
                  {/* A board exports what is drawn on it, not the whole (mostly empty) page. */}
                  <button onClick={() => doc.pages[0] && void exportPagePng(cropToContent(visibleContent(doc.pages[0])), doc.id, `${meta.title}.png`)}>Export as PNG</button>
                  <button onClick={() => void exportBoardPdf()}>Export as PDF</button>
                </>
              ) : (
                <>
                  <button onClick={() => doc.pages[currentPage] && void exportPagePng(doc.pages[currentPage], doc.id, `${meta.title} p${currentPage + 1}.png`)}>Export page as PNG</button>
                  <button onClick={() => setPdfExportOpen(true)}>Export as PDF…</button>
                </>
              )}
              <button onClick={() => void exportJson().catch((e: Error) => alert(`Export failed: ${e.message}`))}>Export notebook (.jnotes.json)</button>
            </div>
          </details>
        </div>
      </header>

      {!readOnly && (inkTool || toolKind === 'eraser' || toolKind === 'text' || toolKind === 'sticky' || toolKind === 'tape' || toolKind === 'lasso') && (
        <div className="tool-options" data-no-gesture role="toolbar" aria-label="Tool options">
          {inkTool === 'pen' && (
            <>
              {PEN_STYLES.map(({ style, label }) => (
                <button
                  key={style}
                  className={`icon-btn sm ${ink.pen.style === style ? 'active' : ''}`}
                  aria-pressed={ink.pen.style === style}
                  aria-label={label}
                  title={label}
                  onClick={() => setPen({ style })}
                >
                  <Icon name={`pen-${style}`} />
                </button>
              ))}
              {ink.pen.style === 'fountain' && (
                <label className="range" title="Tip sharpness">
                  <span>Tip</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={ink.pen.sharpness}
                    aria-label="Tip sharpness"
                    onChange={(e) => setPen({ sharpness: Number(e.target.value) })}
                  />
                </label>
              )}
            </>
          )}
          {(inkTool === 'shapes' || (inkTool === 'pen' && ink.pen.style !== 'pencil')) && (
            <>
              <span className="divider" />
              {DASH_STYLES.map(({ dash, label }) => (
                <button
                  key={dash}
                  className={`icon-btn sm ${ink[inkTool].dash === dash ? 'active' : ''}`}
                  aria-pressed={ink[inkTool].dash === dash}
                  aria-label={label}
                  title={label}
                  onClick={() => setDash(inkTool, dash)}
                >
                  <Icon name={`line-${dash}`} />
                </button>
              ))}
            </>
          )}
          {inkTool === 'shapes' && (
            <>
              <span className="divider" />
              <span className="tool-hint" title="Fill for new shapes">Fill</span>
              <button
                className={`swatch-btn ${!ink.shapes.fill ? 'active' : ''}`}
                aria-label="No fill"
                title="No fill"
                onClick={() => setInk((v) => ({ ...v, shapes: { ...v.shapes, fill: null } }))}
              >
                <NoFillSwatch />
              </button>
              {FILL_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch-btn ${ink.shapes.fill === c ? 'active' : ''}`}
                  aria-label={`Fill ${c}`}
                  onClick={() => setInk((v) => ({ ...v, shapes: { ...v.shapes, fill: c } }))}
                >
                  <span className="swatch" style={{ background: c }} />
                </button>
              ))}
            </>
          )}
          {inkTool && (
            <>
              {inkTool === 'pen' && <span className="divider" />}
              {[...(inkTool === 'highlighter' ? HIGHLIGHT_COLORS : PEN_COLORS), ...swatches[swatchGroup(inkTool)].filter((c) => !(inkTool === 'highlighter' ? HIGHLIGHT_COLORS : PEN_COLORS).includes(c))].map((c) => (
                <button
                  key={c}
                  className={`swatch-btn ${ink[inkTool].color === c ? 'active' : ''}`}
                  aria-label={`Color ${c}`}
                  onClick={() => setInkTool(inkTool, { color: c })}
                >
                  <span className="swatch" style={{ background: c }} />
                </button>
              ))}
              <button
                className="swatch-btn color-more"
                aria-label="More colours"
                aria-expanded={picker?.tool === inkTool}
                title="More colours: wheel, HEX, pick from the page"
                onClick={(e) => setPicker(picker ? null : { tool: inkTool, anchor: e.currentTarget.getBoundingClientRect() })}
              >
                <span className="swatch color-more-ring">
                  <span style={{ background: ink[inkTool].color }} />
                </span>
              </button>
              <span className="divider" />
              {WIDTHS[inkTool].map((w, i) => (
                <button
                  key={w}
                  className={`width-btn ${ink[inkTool].width === w ? 'active' : ''}`}
                  aria-label={`Width ${i + 1}`}
                  onClick={() => setInkTool(inkTool, { width: w })}
                >
                  <span className="width-dot" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
                </button>
              ))}
              <span className="divider" />
              <label className="range" title="Stabilisation: steadies the line against a shaky hand (more lags the pen a little)">
                <span>Steady</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(normaliseStabilise(ink[inkTool].stabilise) * 100)}
                  aria-label="Stabilisation"
                  aria-valuetext={`${Math.round(normaliseStabilise(ink[inkTool].stabilise) * 100)}%`}
                  onChange={(e) => setStabilise(inkTool, Number(e.target.value) / 100)}
                />
                <span className="range-value">{Math.round(normaliseStabilise(ink[inkTool].stabilise) * 100)}%</span>
              </label>
              <span className="divider" />
              <ToolPresets
                presets={presets}
                tool={inkTool}
                settings={ink[inkTool]}
                onApply={applyToolPreset}
                onSave={() => setPresets((list) => addPreset(list, makePreset(inkTool, ink[inkTool])))}
                onRemove={(id) => setPresets((list) => removePreset(list, id))}
              />
            </>
          )}
          {inkTool === 'pen' && (
            <>
              <span className="divider" />
              <button
                className={`chip ${scribbleErase ? 'active' : ''}`}
                aria-pressed={scribbleErase}
                title="Scribble to erase: scribble back and forth over ink with the pen to rub it out"
                onClick={() => setScribbleErase(!scribbleErase)}
              >
                <Icon name="eraser" />
                <span className="chip-label">Scribble erase</span>
              </button>
            </>
          )}
          {inkTool === 'highlighter' && (
            <>
              <span className="divider" />
              <button
                className={`chip ${ink.highlighter.straight ? 'active' : ''}`}
                aria-pressed={ink.highlighter.straight}
                onClick={() => setHighlighter({ straight: !ink.highlighter.straight })}
                title="Draw straight highlight lines"
              >
                <Icon name="straight" /> Straight
              </button>
            </>
          )}
          {toolKind === 'text' && (
            <>
              <div className="segmented" role="radiogroup" aria-label="Font">
                {(Object.keys(FONTS) as FontKey[]).map((f) => (
                  <button
                    key={f}
                    role="radio"
                    aria-checked={textStyle.font === f}
                    className={`font-pick ${textStyle.font === f ? 'active' : ''}`}
                    style={{ fontFamily: FONTS[f] }}
                    onClick={() => setTextStyle({ ...textStyle, font: f })}
                  >
                    {FONT_LABELS[f]}
                  </button>
                ))}
              </div>
              <div className="segmented" role="radiogroup" aria-label="Text size">
                {TEXT_SIZES.map(({ size, label }) => (
                  <button key={size} role="radio" aria-checked={textStyle.size === size} className={textStyle.size === size ? 'active' : ''} onClick={() => setTextStyle({ ...textStyle, size })}>
                    {label}
                  </button>
                ))}
              </div>
              {PEN_COLORS.map((c) => (
                <button key={c} className={`swatch-btn ${textStyle.color === c ? 'active' : ''}`} aria-label={`Text colour ${c}`} onClick={() => setTextStyle({ ...textStyle, color: c })}>
                  <span className="swatch" style={{ background: c }} />
                </button>
              ))}
            </>
          )}
          {toolKind === 'sticky' &&
            STICKY_COLORS.map((c) => (
              <button key={c} className={`swatch-btn ${stickyColor === c ? 'active' : ''}`} aria-label={`Note colour ${c}`} onClick={() => setStickyColor(c)}>
                <span className="swatch" style={{ background: c }} />
              </button>
            ))}
          {toolKind === 'lasso' && (
            <>
              <button className="chip" onClick={() => void pasteFromButton()} title="Paste (⌘V): ink, text and photos copied here or in another notebook, or a photo or web address">
                Paste
              </button>
              <span className="divider" />
              <div className="segmented" role="radiogroup" aria-label="Lasso shape">
                {(['freehand', 'rect', 'screenshot'] as LassoShape[]).map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={lasso.shape === m}
                    className={lasso.shape === m ? 'active' : ''}
                    title={m === 'screenshot' ? 'Drag a rectangle to capture it as a picture' : undefined}
                    onClick={() => setLasso({ ...lasso, shape: m })}
                  >
                    {m === 'freehand' ? 'Freehand' : m === 'rect' ? 'Rectangle' : 'Screenshot'}
                  </button>
                ))}
              </div>
              <span className="divider" />
              {(() => {
                const pg = doc.pages[currentPage];
                const n = pg ? countLocked(pg) : 0;
                return n ? (
                  <>
                    <button className="chip" title="Locked content can't be erased or selected until it is unlocked" onClick={() => store.dispatch(unlockAllOps(pg))}>
                      <Icon name="lock" /> Unlock {n} on this page
                    </button>
                    <span className="divider" />
                  </>
                ) : null;
              })()}
              <button
                className={`chip ${snap ? 'active' : ''}`}
                aria-pressed={snap}
                title="Snap: moved selections line up with other objects, the page and its lines"
                onClick={() => setSnap(!snap)}
              >
                <Icon name="grid" /> Snap
              </button>
              <span className="divider" />
              <div className="erase-kinds" role="group" aria-label="Lasso selects">
                <span className="tool-hint">Selects</span>
                {LASSO_KINDS.map((k) => {
                  const on = lasso.kinds.includes(k);
                  return (
                    <button
                      key={k}
                      className={`chip ${on ? 'active' : ''}`}
                      aria-pressed={on}
                      onClick={() => setLasso({ ...lasso, kinds: toggleLassoKind(lasso.kinds, k) })}
                      title={on && lasso.kinds.length === 1 ? 'The lasso has to select something' : `${on ? 'Skip' : 'Select'} ${LASSO_LABELS[k].toLowerCase()}`}
                    >
                      <Icon name={k === 'handwriting' ? 'pen' : k} /> {LASSO_LABELS[k]}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {toolKind === 'tape' && (
            <>
              {TAPE_COLORS.map((c) => (
                <button key={c} className={`swatch-btn ${tapeColor === c ? 'active' : ''}`} aria-label={`Tape colour ${c}`} aria-pressed={tapeColor === c} onClick={() => setTapeColor(c)}>
                  <span className="swatch" style={{ background: c }} />
                </button>
              ))}
              <span className="divider" />
              <span className="tool-hint">Drag over notes to cover them; tap tape to peek</span>
              <button
                className="btn sm ghost"
                disabled={!countTape(doc)}
                onClick={() =>
                  setRevealed((r) => {
                    const all = doc.pages.flatMap((p) => p.items.filter((it) => it.kind === 'tape').map((it) => it.id));
                    return all.every((id) => r.has(id)) ? new Set() : new Set(all);
                  })
                }
              >
                {doc.pages.every((p) => p.items.every((it) => it.kind !== 'tape' || revealed.has(it.id))) && countTape(doc) ? 'Cover all' : 'Show all'}
              </button>
              <button
                className="btn sm ghost danger-text"
                disabled={!countTape(doc)}
                onClick={() => {
                  const n = countTape(doc);
                  if (!confirm(`Remove all ${n} ${n === 1 ? 'strip' : 'strips'} of tape from this notebook? You can undo this.`)) return;
                  store.dispatch(removeAllTapeOps(store.doc));
                  setRevealed(new Set());
                }}
              >
                Remove all tape
              </button>
            </>
          )}
          {toolKind === 'eraser' && (
            <>
              {ERASER_SIZES.map((size, i) => (
                <button
                  key={size}
                  className={`width-btn ${eraser.size === size ? 'active' : ''}`}
                  aria-label={`Eraser size ${i + 1}`}
                  aria-pressed={eraser.size === size}
                  onClick={() => setEraser({ ...eraser, size })}
                >
                  <span className="eraser-dot" style={{ width: 6 + i * 6, height: 6 + i * 6 }} />
                </button>
              ))}
              <span className="divider" />
              <div className="segmented" role="radiogroup" aria-label="Eraser mode">
                {(['stroke', 'partial'] as EraseMode[]).map((m) => (
                  <button key={m} role="radio" aria-checked={eraser.mode === m} className={eraser.mode === m ? 'active' : ''} onClick={() => setEraser({ ...eraser, mode: m })}>
                    {m === 'stroke' ? 'Whole stroke' : 'Partial'}
                  </button>
                ))}
              </div>
              <span className="divider" />
              <div className="erase-kinds" role="group" aria-label="Erase">
                <span className="tool-hint">Erases</span>
                {INK_KINDS.map((k) => (
                  <button
                    key={k}
                    className={`chip ${eraser.kinds.includes(k) ? 'active' : ''}`}
                    aria-pressed={eraser.kinds.includes(k)}
                    onClick={() => setEraser({ ...eraser, kinds: toggleEraseKind(eraser.kinds, k) })}
                    title={eraser.kinds.includes(k) && eraser.kinds.length === 1 ? 'The eraser has to erase something' : `${eraser.kinds.includes(k) ? 'Stop erasing' : 'Erase'} ${CONTENT_LABELS[k].toLowerCase()}`}
                  >
                    <Icon name={k === 'pen' ? 'pen' : k} /> {CONTENT_LABELS[k]}
                  </button>
                ))}
              </div>
              <span className="divider" />
              <DeleteItemsMenu page={workingPage} onDelete={(kind) => workingPage && store.dispatch(deleteContentOps(workingPage, kind))} />
            </>
          )}
        </div>
      )}

      <div className="editor-body">
      {sidebarOpen && !board && (
        <PageSidebar
          pages={doc.pages}
          docId={doc.id}
          currentPage={currentPage}
          onJump={(i) => scrollToPage(i, 'auto')}
          onMove={movePage}
          actions={pageActions}
          bookmarks={bookmarkedIndices(doc)}
          onToggleBookmark={toggleBookmark}
          tab={sidebarTab}
          onTab={setSidebarTab}
          readOnly={readOnly}
          outline={
            <OutlinePanel
              doc={doc}
              currentPage={currentPage}
              readOnly={readOnly}
              renaming={outlineRenaming}
              onRenamed={() => setOutlineRenaming(null)}
              onJump={jumpToEntry}
              onAddPage={() => doc.pages[currentPage] && addToOutline({ pageId: doc.pages[currentPage].id }, `Page ${currentPage + 1}`)}
              dispatch={(op) => op && store.dispatch([op])}
            />
          }
        />
      )}
      <div className="canvas-area" ref={areaRef}>
      <div
        ref={scrollerRef}
        className="scroller"
        onScroll={onScroll}
        onPointerDownCapture={onTouchDown}
        onPointerMoveCapture={onTouchMove}
        onPointerUpCapture={onTouchUp}
        onPointerCancelCapture={onTouchUp}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          if (readOnly) return;
          const files = [...e.dataTransfer.files].filter(isImageFile);
          if (!files.length) return;
          e.preventDefault();
          void insertPhotos(files, e.clientX, e.clientY);
        }}
      >
        <div className={`pages ${scrollDir}`} style={{ gap: PAGE_GAP }}>
          {doc.pages.map((page) => (
            <PageView
              key={page.id}
              page={page}
              zoom={zoom}
              store={store}
              tool={tool}
              penOnly={penOnly}
              gesture={gesture}
              selection={selection}
              setSelection={setSelection}
              selectionColors={PEN_COLORS}
              stickyColors={STICKY_COLORS}
              rulerEdges={ruler ? rulerEdgesClient : undefined}
              onSaveElement={(sel) => void saveAsElement(sel)}
              onCopy={(sel, cut) => void copySelection(sel, cut)}
              onScreenshot={(pageId, rect, action) => void takeScreenshot(pageId, rect, action)}
              onAddToOutline={addSelectionToOutline}
              onAddToStudySet={addToStudySet}
              cardBackPending={!!cardDraft?.picking}
              onLayerBlocked={(name, why) => setNotice(layerNotice(name, why))}
              onScribbleErase={(n) => setNotice(`Scribbled out ${n} ${n === 1 ? 'stroke' : 'strokes'} · Undo brings ${n === 1 ? 'it' : 'them'} back`)}
              revealed={revealed}
              onToggleTape={toggleTape}
              onFollowLink={followLink}
              readOnly={readOnly}
              onLaser={presenter.presenting ? presenter.sendLaser : undefined}
              onSample={
                sampling
                  ? (hex) => {
                      setInkTool(sampling, { color: hex });
                      setSampling(null);
                      setNotice(`Picked ${hex}`);
                    }
                  : undefined
              }
              onEditLink={(sel, link) => setLinkDialog({ sel, link })}
              playback={playback}
              onSeekInk={audioOpen && recState === 'idle' && recordings.length ? seekInk : undefined}
              zoomTarget={zoomTarget}
              setZoomTarget={setZoomTarget}
              highlights={searchHit?.pageId === page.id ? searchHit.rects : undefined}
              handwriting={handwriting}
              spell={spell}
            />
          ))}
        </div>
      </div>
      {pageDialog?.kind === 'template' && doc.pages.find((p) => p.id === pageDialog.pageId) && (
        <ChangeTemplateDialog
          page={doc.pages.find((p) => p.id === pageDialog.pageId)!}
          onCancel={() => setPageDialog(null)}
          onApply={(c) => void applyTemplate(pageDialog.pageId, c).catch((e: Error) => alert(`Could not change the template: ${e.message}`))}
        />
      )}
      {(pageDialog?.kind === 'move' || pageDialog?.kind === 'copy') && (
        <NotebookPickerDialog currentId={doc.id} mode={pageDialog.kind} onCancel={() => setPageDialog(null)} onPick={(n) => sendPage(pageDialog.pageId, n, pageDialog.kind as 'move' | 'copy')} />
      )}
      {pdfExportOpen && (
        <PdfExportDialog
          pageCount={doc.pages.length}
          currentPage={currentPage}
          layerNames={layerNames(doc.pages)}
          shownLayerNames={layerNames(doc.pages.map((p) => withLayers(p, (l) => !l.hidden)))}
          onCancel={() => setPdfExportOpen(false)}
          onExport={exportAsPdf}
        />
      )}
      {searchOpen && <SearchPanel doc={doc} handwriting={handwriting} onJump={showSearchHit} onClose={closeSearch} />}
      {layersOpen && layersPage && (
        <LayersPanel
          page={layersPage}
          pageLabel={board ? 'Board' : `Page ${currentPage + 1}`}
          activeId={store.activeLayer(layersPage.id)}
          readOnly={readOnly}
          onSelect={(id) => chooseLayer(layersPage.id, id)}
          dispatch={(ops) => store.dispatch(ops)}
          onExport={() => setLayerExportOpen(true)}
          onClose={() => setLayersOpen(false)}
        />
      )}
      {layerExportOpen && layersPage && (
        <LayerExportDialog page={layersPage} onCancel={() => setLayerExportOpen(false)} onExport={(ids, format) => exportLayers(layersPage, ids, format)} />
      )}
      {ruler && <RulerOverlay ruler={ruler} setRuler={setRuler} zoom={zoom} onClose={() => setRuler(null)} />}
      </div>
      </div>
      {(audioOpen || recState !== 'idle') && (
        <AudioBar
          docId={doc.id}
          recordings={recordings}
          onStopRecording={finishRecording}
          onDelete={deleteRecording}
          setPlayback={setPlayback}
          api={audioApi}
          onClose={() => setAudioOpen(false)}
        />
      )}
      {zoomTarget && zoomPage && (
        <ZoomWindow store={store} page={zoomPage} target={zoomTarget} setTarget={setZoomTarget} tool={tool} penOnly={penOnly} onClose={() => setZoomTarget(null)} />
      )}

      {customising && <ToolbarSettings prefs={toolbarPrefs} onChange={setToolbarPrefs} onClose={() => setCustomising(false)} />}
      {cardDraft?.picking && (
        <div className="card-pick-banner" role="status">
          <span>Lasso the back of the card, then choose More › Use as card back.</span>
          <button className="btn sm" onClick={() => setCardDraft({ ...cardDraft, picking: false })}>
            Type it instead
          </button>
          <button className="btn sm ghost" onClick={() => setCardDraft(null)}>
            Cancel card
          </button>
        </div>
      )}
      {cardDraft && !cardDraft.picking && (
        <AddCardDialog
          draft={cardDraft.draft}
          onChange={(draft) => setCardDraft({ draft, picking: false })}
          onPickBack={() => {
            setCardDraft({ ...cardDraft, picking: true });
            setToolKind('lasso');
          }}
          onDone={(message) => {
            setCardDraft(null);
            setNotice(message);
          }}
          onCancel={() => setCardDraft(null)}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {picker && (
        <ColorPicker
          color={ink[picker.tool].color}
          anchor={picker.anchor}
          swatches={swatches[swatchGroup(picker.tool)]}
          onChange={(hex) => setInkTool(picker.tool, { color: hex })}
          onPickFromPage={() => {
            setSampling(picker.tool);
            setPicker(null);
          }}
          onAddSwatch={(hex) => setSwatches((s) => ({ ...s, [swatchGroup(picker.tool)]: addSwatch(s[swatchGroup(picker.tool)], hex) }))}
          onRemoveSwatch={(hex) => setSwatches((s) => ({ ...s, [swatchGroup(picker.tool)]: s[swatchGroup(picker.tool)].filter((c) => c !== hex) }))}
          onClose={() => setPicker(null)}
        />
      )}
      {sampling && (
        <div className="sampling-banner" data-no-gesture role="status">
          <Icon name="eyedropper" /> Tap the page to pick a colour
          <button className="btn sm ghost" onClick={() => setSampling(null)}>
            Cancel
          </button>
        </div>
      )}
      {back.length > 0 && !zoomTarget && (
        <button className="back-pill" data-no-gesture onClick={goBack}>
          <Icon name="back" /> Back to page {back[back.length - 1].pageIndex + 1}
        </button>
      )}
      {linkDialog && (
        <LinkDialog
          pages={doc.pages}
          initial={linkDialog.link?.target}
          currentPage={currentPage}
          onCancel={() => setLinkDialog(null)}
          onSave={saveLink}
          onRemove={linkDialog.link ? () => saveLink(null) : undefined}
        />
      )}
      {settingsOpen && <SettingsDialog values={settingsValues} onChange={changeSettings} onClose={() => setSettingsOpen(false)} board={board} />}
      {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} />}
      <div className="page-indicator" data-no-gesture hidden={!!zoomTarget || board}>
        {currentPage + 1} / {doc.pages.length}
      </div>
    </div>
  );
}
