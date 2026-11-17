import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { pageIndexAt, pageSize, pageTops, type EraseMode, type InkTool, type NotebookMeta, type PenStyle, type Template, type ToolKind } from '../core/model';
import { newId } from '../core/ids';
import { DocumentStore } from '../core/store';
import { deleteSelectionOps } from '../core/selection';
import { appendPage, getBlobs, getMeta, listElements, loadDocument, putBlob, saveElement, updateMeta } from '../storage/db';
import { bookmarkedIndices, changeTemplateOp, clonePage, duplicatePageOp, insertPageOp, insertPagesOps, isBookmarked, pageBlobIds, toggleBookmarkOp } from '../core/pages';
import { pagesFromFiles } from '../io/importPages';
import { movePageOp } from '../core/ops';
import { ChangeTemplateDialog, NotebookPickerDialog, PageMenuItems, type PageActionHandlers } from './PageActions';
import { PageSidebar } from './PageSidebar';
import { SearchPanel, type SearchHit } from './SearchPanel';
import type { CustomTemplate } from './TemplateGrid';
import { Persister, type SaveStatus } from '../storage/persister';
import { downloadBlob, exportPagePng, renderContentThumbnail, renderThumbnail } from '../render/page';
import { imageResolver, primeImage } from '../render/items';
import { isImageFile, prepareImage } from '../io/images';
import { FONTS, newImage, type FontKey, type TextStyle } from '../core/items';
import type { PageItem } from '../core/model';
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
import { ZoomWindow } from './ZoomWindow';
import { rulerEdges, type Ruler } from '../core/ruler';
import { defaultTarget, type ZoomTarget } from '../core/zoomWindow';

const PAGE_GAP = 28;
/** Width of one toolbar icon button with its gap, and of the fixed buttons around the customisable ones. */
const TOOLBAR_ITEM_W = 38;
const TOOLBAR_FIXED_W = 3 * TOOLBAR_ITEM_W + 2 * 13;
const MIN_ZOOM = 0.4;
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
];
const ERASER_SIZES = [6, 12, 22];
const TOOLS: { kind: ToolKind; label: string; key: string }[] = [
  { kind: 'pen', label: 'Pen', key: 'P' },
  { kind: 'highlighter', label: 'Highlighter', key: 'H' },
  { kind: 'shapes', label: 'Shapes', key: 'S' },
  { kind: 'eraser', label: 'Eraser', key: 'E' },
  { kind: 'lasso', label: 'Lasso', key: 'L' },
  { kind: 'text', label: 'Text', key: 'T' },
  { kind: 'sticky', label: 'Sticky note', key: 'N' },
  { kind: 'laser', label: 'Laser pointer', key: 'K' },
];

interface InkSettings {
  pen: { color: string; width: number; style: PenStyle; sharpness: number };
  highlighter: { color: string; width: number; straight: boolean };
  shapes: { color: string; width: number };
}
interface EraserSettings {
  size: number;
  mode: EraseMode;
  highlighterOnly: boolean;
}

const DEFAULT_INK: InkSettings = {
  pen: { color: PEN_COLORS[0], width: WIDTHS.pen[1], style: 'fountain', sharpness: 0.5 },
  highlighter: { color: HIGHLIGHT_COLORS[0], width: WIDTHS.highlighter[1], straight: false },
  shapes: { color: PEN_COLORS[0], width: WIDTHS.shapes[1] },
};
const DEFAULT_ERASER: EraserSettings = { size: ERASER_SIZES[1], mode: 'stroke', highlighterOnly: false };

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

export function Editor({ id, onExit }: { id: string; onExit: () => void }) {
  const [state, setState] = useState<{ store: DocumentStore; meta: NotebookMeta; snapshotSeq: number } | { error: string } | null>(null);

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
  return <EditorInner key={id} {...state} onExit={onExit} />;
}

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
  const [zoom, setZoom] = useState(() => readPref('jnotes.zoom', 1));
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
  const [eraser, setEraser] = useState<EraserSettings>(() => ({ ...DEFAULT_ERASER, ...readPref<Partial<EraserSettings>>('jnotes.eraser', {}) }));
  const setPen = (patch: Partial<InkSettings['pen']>) => setInk((v) => ({ ...v, pen: { ...v.pen, ...patch } }));
  const setHighlighter = (patch: Partial<InkSettings['highlighter']>) => setInk((v) => ({ ...v, highlighter: { ...v.highlighter, ...patch } }));
  const setInkTool = (t: ColorTool, patch: { color?: string; width?: number }) => setInk((v) => ({ ...v, [t]: { ...v[t], ...patch } }));
  const [penOnly, setPenOnly] = useState(() => readPref('jnotes.penOnly', false));
  const [textStyle, setTextStyle] = useState<TextStyle>(() => ({ ...DEFAULT_TEXT, ...readPref<Partial<TextStyle>>('jnotes.text', {}) }));
  const [stickyColor, setStickyColor] = useState(() => readPref('jnotes.stickyColor', STICKY_COLORS[0]));
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<GestureState>({ touches: new Map(), active: false });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => writePref('jnotes.ink', ink), [ink]);
  useEffect(() => writePref('jnotes.eraser', eraser), [eraser]);
  useEffect(() => writePref('jnotes.penOnly', penOnly), [penOnly]);
  useEffect(() => writePref('jnotes.text', textStyle), [textStyle]);
  useEffect(() => writePref('jnotes.toolbar', toolbarPrefs), [toolbarPrefs]);
  useEffect(() => writePref('jnotes.stickyColor', stickyColor), [stickyColor]);
  useEffect(() => writePref('jnotes.zoom', zoom), [zoom]);

  // --- Persistence ------------------------------------------------------------
  // Created inside the effect (not useMemo) so StrictMode's mount→unmount→mount
  // cycle gets a fresh, subscribed persister each time.
  useEffect(() => {
    let lastThumb = 0;
    const persister = new Persister(store, snapshotSeq, () => {
      // Refresh the library thumbnail at most every few seconds.
      if (Date.now() - lastThumb < 3000 || !store.doc.pages[0]) return;
      lastThumb = Date.now();
      void updateMeta(store.doc.id, { thumbnail: renderThumbnail(store.doc.pages[0], store.doc.id) });
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
      if (store.doc.pages[0]) void updateMeta(store.doc.id, { thumbnail: renderThumbnail(store.doc.pages[0], store.doc.id) });
      void persister.dispose();
    };
  }, [store, snapshotSeq]);

  // --- Zoom with a fixed anchor point ----------------------------------------------
  const pendingAnchor = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);
  const setZoomAt = useCallback((next: number, clientX?: number, clientY?: number) => {
    const el = scrollerRef.current;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (!el || z === zoomRef.current) return;
    const r = el.getBoundingClientRect();
    const px = (clientX ?? r.left + r.width / 2) - r.left;
    const py = (clientY ?? r.top + r.height / 2) - r.top;
    pendingAnchor.current = { cx: (el.scrollLeft + px) / zoomRef.current, cy: (el.scrollTop + py) / zoomRef.current, px, py };
    zoomRef.current = z;
    setZoom(z);
  }, []);

  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    const el = scrollerRef.current;
    if (!a || !el) return;
    pendingAnchor.current = null;
    el.scrollLeft = a.cx * zoom - a.px;
    el.scrollTop = a.cy * zoom - a.py;
  }, [zoom]);

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
    if (penOnly || g.touches.size >= 2) {
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
    straight: ink.highlighter.straight,
    eraserPx: eraser.size,
    eraseMode: eraser.mode,
    highlighterOnly: eraser.highlighterOnly,
    text: textStyle,
    stickyColor,
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
    if (!images.length || !target) return;
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
    onExit();
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

  const placeElementAt = async (el: SavedElement, clientX?: number, clientY?: number): Promise<boolean> => {
    const target = photoTarget(clientX, clientY, clientX !== undefined);
    if (!target) return false;
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

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type === 'text')) return;
      const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
      if (!files.length) return;
      e.preventDefault();
      void insertPhotosRef.current(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // --- Page actions -------------------------------------------------------------------
  // Dialogs name their page by id, so a reorder while one is open can't retarget it.
  const [pageDialog, setPageDialog] = useState<null | { kind: 'template' | 'move' | 'copy'; pageId: string }>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => readPref('jnotes.sidebar', false));
  useEffect(() => writePref('jnotes.sidebar', sidebarOpen), [sidebarOpen]);

  const scrollToPage = (index: number, behavior: ScrollBehavior = 'smooth') =>
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (el) el.scrollTo({ top: pageTops(store.doc.pages, zoom, PAGE_GAP).tops[index] ?? 0, behavior });
    });

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
    const y = hit.rects.length ? Math.min(...hit.rects.map((r) => r.y)) : 0;
    const top = (pageTops(store.doc.pages, zoom, PAGE_GAP).tops[index] ?? 0) + y * zoom - el.clientHeight / 3;
    el.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  };

  const movePage = (pageId: string, to: number) => {
    const op = movePageOp(store.doc, pageId, to);
    if (op) store.dispatch([op]);
  };

  const rename = (title: string) => {
    const t = title.trim() || 'Untitled';
    setMeta((m) => ({ ...m, title: t }));
    void updateMeta(meta.id, { title: t });
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
      if ((e.target instanceof HTMLInputElement && e.target.type !== 'range') || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.metaKey || e.ctrlKey;
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
    setCurrentPage(pageIndexAt(pageTops(doc.pages, zoom, PAGE_GAP).tops, el.scrollTop + el.clientHeight / 2));
  };

  return (
    <div className="editor">
      <header className="toolbar" data-no-gesture ref={toolbarRef}>
        <div className="tb-group" ref={leftGroupRef}>
          <button className="icon-btn" onClick={() => void exit()} aria-label="Back to library" title="Library">
            <Icon name="back" />
          </button>
          <input className="title-input" defaultValue={meta.title} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Notebook title" />
          <span className={`save-status ${status}`} title="Saved locally on this device">
            {status === 'saved' ? 'Saved' : status === 'error' ? 'Save failed' : 'Saving…'}
          </span>
        </div>

        <div className="tb-group tools" role="toolbar" aria-label="Tools">
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
          <span className="divider" />
          <button
            className={`icon-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={() => setSidebarOpen((o: boolean) => !o)}
            aria-pressed={sidebarOpen}
            aria-label="Page thumbnails"
            title="Page thumbnails"
          >
            <Icon name="sidebar" />
          </button>
          <button
            className={`icon-btn ${searchOpen ? 'active' : ''}`}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            aria-pressed={searchOpen}
            aria-label="Search PDF text"
            title="Search (⌘F)"
          >
            <Icon name="search" />
          </button>
          <button
            className={`icon-btn ${currentBookmarked ? 'active' : ''}`}
            onClick={() => doc.pages[currentPage] && toggleBookmark(doc.pages[currentPage].id)}
            aria-pressed={currentBookmarked}
            aria-label={currentBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            title={currentBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          >
            <Icon name="bookmark" />
          </button>
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
          <details className="menu">
            <summary className="icon-btn" aria-label="Export">
              <Icon name="share" />
            </summary>
            <div className="menu-pop">
              <button onClick={() => doc.pages[currentPage] && void exportPagePng(doc.pages[currentPage], doc.id, `${meta.title} p${currentPage + 1}.png`)}>Export page as PNG</button>
              <button onClick={() => void exportJson().catch((e: Error) => alert(`Export failed: ${e.message}`))}>Export notebook (.jnotes.json)</button>
            </div>
          </details>
        </div>
      </header>

      {(inkTool || toolKind === 'eraser' || toolKind === 'text' || toolKind === 'sticky') && (
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
          {inkTool && (
            <>
              {inkTool === 'pen' && <span className="divider" />}
              {(inkTool === 'highlighter' ? HIGHLIGHT_COLORS : PEN_COLORS).map((c) => (
                <button
                  key={c}
                  className={`swatch-btn ${ink[inkTool].color === c ? 'active' : ''}`}
                  aria-label={`Color ${c}`}
                  onClick={() => setInkTool(inkTool, { color: c })}
                >
                  <span className="swatch" style={{ background: c }} />
                </button>
              ))}
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
              <button
                className={`chip ${eraser.highlighterOnly ? 'active' : ''}`}
                aria-pressed={eraser.highlighterOnly}
                onClick={() => setEraser({ ...eraser, highlighterOnly: !eraser.highlighterOnly })}
                title="Only erase highlighter ink"
              >
                <Icon name="highlighter" /> Highlighter only
              </button>
            </>
          )}
        </div>
      )}

      <div className="editor-body">
      {sidebarOpen && (
        <PageSidebar
          pages={doc.pages}
          docId={doc.id}
          currentPage={currentPage}
          onJump={(i) => scrollToPage(i, 'auto')}
          onMove={movePage}
          actions={pageActions}
          bookmarks={bookmarkedIndices(doc)}
          onToggleBookmark={toggleBookmark}
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
          const files = [...e.dataTransfer.files].filter(isImageFile);
          if (!files.length) return;
          e.preventDefault();
          void insertPhotos(files, e.clientX, e.clientY);
        }}
      >
        <div className="pages" style={{ gap: PAGE_GAP }}>
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
              playback={playback}
              onSeekInk={audioOpen && recState === 'idle' && recordings.length ? seekInk : undefined}
              zoomTarget={zoomTarget}
              setZoomTarget={setZoomTarget}
              highlights={searchHit?.pageId === page.id ? searchHit.rects : undefined}
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
      {searchOpen && <SearchPanel doc={doc} onJump={showSearchHit} onClose={closeSearch} />}
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
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      <div className="page-indicator" data-no-gesture hidden={!!zoomTarget}>
        {currentPage + 1} / {doc.pages.length}
      </div>
    </div>
  );
}
