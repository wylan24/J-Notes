import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PAGE_H, type EraseMode, type InkTool, type NotebookMeta, type PenStyle, type ToolKind } from '../core/model';
import { newId } from '../core/ids';
import { DocumentStore } from '../core/store';
import { getMeta, loadDocument, updateMeta } from '../storage/db';
import { Persister, type SaveStatus } from '../storage/persister';
import { downloadBlob, exportPagePng, renderThumbnail } from '../render/page';
import { toFile } from '../io/notebookFile';
import { PageView, type GestureState, type Selection, type ToolState } from './PageView';
import { Icon } from './icons';

const PAGE_GAP = 28;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

const PEN_COLORS = ['#1c1c1e', '#2557c7', '#d1342f', '#1d8a4a', '#8a4fd8'];
const HIGHLIGHT_COLORS = ['#ffd84d', '#9ff09a', '#ffb0d0', '#9fd4ff'];
const WIDTHS: Record<InkTool, number[]> = { pen: [1.8, 3, 5], highlighter: [12, 18, 26] };
const PEN_STYLES: { style: PenStyle; label: string }[] = [
  { style: 'fountain', label: 'Fountain pen' },
  { style: 'ball', label: 'Ball pen' },
  { style: 'brush', label: 'Brush pen' },
];
const ERASER_SIZES = [6, 12, 22];
const TOOLS: { kind: ToolKind; label: string; key: string }[] = [
  { kind: 'pen', label: 'Pen', key: 'P' },
  { kind: 'highlighter', label: 'Highlighter', key: 'H' },
  { kind: 'eraser', label: 'Eraser', key: 'E' },
  { kind: 'lasso', label: 'Lasso', key: 'L' },
  { kind: 'laser', label: 'Laser pointer', key: 'K' },
];

interface InkSettings {
  pen: { color: string; width: number; style: PenStyle; sharpness: number };
  highlighter: { color: string; width: number; straight: boolean };
}
interface EraserSettings {
  size: number;
  mode: EraseMode;
  highlighterOnly: boolean;
}

const DEFAULT_INK: InkSettings = {
  pen: { color: PEN_COLORS[0], width: WIDTHS.pen[1], style: 'fountain', sharpness: 0.5 },
  highlighter: { color: HIGHLIGHT_COLORS[0], width: WIDTHS.highlighter[1], straight: false },
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
    return { pen: { ...DEFAULT_INK.pen, ...saved.pen }, highlighter: { ...DEFAULT_INK.highlighter, ...saved.highlighter } };
  });
  const [eraser, setEraser] = useState<EraserSettings>(() => ({ ...DEFAULT_ERASER, ...readPref<Partial<EraserSettings>>('jnotes.eraser', {}) }));
  const setPen = (patch: Partial<InkSettings['pen']>) => setInk((v) => ({ ...v, pen: { ...v.pen, ...patch } }));
  const setHighlighter = (patch: Partial<InkSettings['highlighter']>) => setInk((v) => ({ ...v, highlighter: { ...v.highlighter, ...patch } }));
  const setInkTool = (t: InkTool, patch: { color?: string; width?: number }) => (t === 'pen' ? setPen(patch) : setHighlighter(patch));
  const [penOnly, setPenOnly] = useState(() => readPref('jnotes.penOnly', false));
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
      void updateMeta(store.doc.id, { thumbnail: renderThumbnail(store.doc.pages[0]) });
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
      if (store.doc.pages[0]) void updateMeta(store.doc.id, { thumbnail: renderThumbnail(store.doc.pages[0]) });
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
  const inkTool = toolKind === 'pen' || toolKind === 'highlighter' ? toolKind : null;
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
  };

  const addPage = () => {
    const index = Math.min(currentPage + 1, doc.pages.length);
    store.dispatch([{ type: 'page.added', index, page: { id: newId(), template: meta.template, strokes: [] } }]);
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (el) el.scrollTo({ top: index * (PAGE_H * zoom + PAGE_GAP), behavior: 'smooth' });
    });
  };

  const deletePage = () => {
    const page = doc.pages[currentPage];
    if (!page || doc.pages.length <= 1) return;
    if (page.strokes.length && !confirm(`Delete page ${currentPage + 1}? You can undo this.`)) return;
    store.dispatch([{ type: 'page.removed', page, index: currentPage }]);
  };

  const rename = (title: string) => {
    const t = title.trim() || 'Untitled';
    setMeta((m) => ({ ...m, title: t }));
    void updateMeta(meta.id, { title: t });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(toFile(meta, doc))], { type: 'application/json' });
    downloadBlob(blob, `${meta.title}.jnotes.json`);
  };

  // --- Keyboard ---------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
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
      } else if (mod && e.key === '-') {
        e.preventDefault();
        setZoomAt(zoomRef.current / 1.2);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        setZoomAt(1);
      } else if (!mod && selection && (e.key === 'Delete' || e.key === 'Backspace')) {
        const page = store.doc.pages.find((p) => p.id === selection.pageId);
        const ids = new Set(selection.ids);
        const strokes = page?.strokes.filter((s) => ids.has(s.id)) ?? [];
        if (page && strokes.length)
          store.dispatch([{ type: 'strokes.removed', pageId: page.id, strokes, indices: page.strokes.flatMap((s, i) => (ids.has(s.id) ? [i] : [])) }]);
        setSelection(null);
      } else if (e.key === 'Escape') {
        setSelection(null);
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
    const stride = PAGE_H * zoom + PAGE_GAP;
    setCurrentPage(Math.max(0, Math.min(doc.pages.length - 1, Math.floor((el.scrollTop + el.clientHeight / 2) / stride))));
  };

  return (
    <div className="editor">
      <header className="toolbar" data-no-gesture>
        <div className="tb-group">
          <button className="icon-btn" onClick={onExit} aria-label="Back to library" title="Library">
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
          {TOOLS.map(({ kind: k, label, key }) => (
            <button
              key={k}
              className={`icon-btn ${toolKind === k ? 'active' : ''}`}
              aria-pressed={toolKind === k}
              aria-label={label}
              title={`${label} (${key})`}
              onClick={() => {
                setToolKind(k);
                setSelection(null);
              }}
            >
              <Icon name={k} />
            </button>
          ))}
        </div>

        <div className="tb-group">
          <button className={`chip ${penOnly ? 'active' : ''}`} onClick={() => setPenOnly(!penOnly)} title="When on, fingers scroll and only a stylus draws">
            <Icon name="stylus" /> Stylus only
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
          <button className="icon-btn" onClick={addPage} aria-label="Add page after current" title="Add page">
            <Icon name="addPage" />
          </button>
          <button className="icon-btn" onClick={deletePage} disabled={doc.pages.length <= 1} aria-label="Delete current page" title="Delete page">
            <Icon name="trash" />
          </button>
          <details className="menu">
            <summary className="icon-btn" aria-label="Export">
              <Icon name="share" />
            </summary>
            <div className="menu-pop">
              <button onClick={() => doc.pages[currentPage] && void exportPagePng(doc.pages[currentPage], `${meta.title} p${currentPage + 1}.png`)}>Export page as PNG</button>
              <button onClick={exportJson}>Export notebook (.jnotes.json)</button>
            </div>
          </details>
        </div>
      </header>

      {(inkTool || toolKind === 'eraser') && (
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
              {(inkTool === 'pen' ? PEN_COLORS : HIGHLIGHT_COLORS).map((c) => (
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

      <div
        ref={scrollerRef}
        className="scroller"
        onScroll={onScroll}
        onPointerDownCapture={onTouchDown}
        onPointerMoveCapture={onTouchMove}
        onPointerUpCapture={onTouchUp}
        onPointerCancelCapture={onTouchUp}
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
            />
          ))}
        </div>
      </div>

      <div className="page-indicator" data-no-gesture>
        {currentPage + 1} / {doc.pages.length}
      </div>
    </div>
  );
}
