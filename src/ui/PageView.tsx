import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  pagePaper,
  pageSize,
  type DashStyle,
  type EraseMode,
  type InputPoint,
  type LinkItem,
  type LinkTarget,
  type Page,
  type PageItem,
  type PenStyle,
  type StickyItem,
  type Stroke,
  type TextItem,
  type ToolKind,
} from '../core/model';
import { FONTS, fontFamily, itemAt, LINE_HEIGHT, newSticky, newText, resizeItem, STICKY_PAD, STICKY_TEXT_SIZE, TEXT_PAD, textHeight, type FontKey, type TextStyle } from '../core/items';
import { newId } from '../core/ids';
import { LASER_FADE_MS, paintLaser, type LaserPoint } from '../render/laser';
import { linkAt, TAP_MS, TAP_SLOP_PX } from '../core/links';
import { pixelToHex } from '../core/color';
import { newTape, tapeAt, tapeRect } from '../core/tape';
import { pointsLength, strokeHitsCircle, type Vec } from '../core/geometry';
import { edgeNear, mapEdge, projectToEdge, type Edge } from '../core/ruler';
import { newInkStroke, pressureOf, timeStamp } from './ink';
import { playbackState, seekTimeFor, stampShape, strokeAtForSeek } from '../core/audio';
import {
  deleteSelectionOps,
  duplicateSelection as duplicateSelectionOps,
  moveSelectionOps,
  selectInLasso,
  selectedStrokes,
  selectionBounds,
  type Selection,
} from '../core/selection';
import { detectLine, recognizeShape, shapeCenter, shapePaths, transformShape, type Shape } from '../core/shapes';
import { clampTarget, type ZoomTarget } from '../core/zoomWindow';
import { removeItemsOp, removeStrokesOp, updateItemOp, type DocOp } from '../core/ops';
import { rotateAbout, scaleAbout, snapAngle, transformBounds, transformItem, transformSelectionOps, translate, type Matrix } from '../core/transform';
import type { Bounds } from '../core/geometry';
import { replaceStrokesOps, splitStroke } from '../core/erase';
import type { DocumentStore } from '../core/store';
import { paintPage, paintStrokes, PAPER_STYLES } from '../render/page';
import { imageResolver, measurer, onImagesLoaded } from '../render/items';
import { pdfResolver } from '../render/pdf';
import { paintInk } from '../render/stroke';

export interface ToolState {
  kind: ToolKind;
  color: string;
  width: number;
  penStyle: PenStyle;
  /** Fountain-pen tip sharpness, 0..1. */
  sharpness: number;
  /** Line style for the pen and Shapes tools. */
  dash: DashStyle;
  /** Colour of new tape. */
  tapeColor: string;
  /** How much the current ink tool steadies the line, 0..1. */
  stabilise: number;
  /** Highlighter draws ruler-straight lines from the first point. */
  straight: boolean;
  /** Eraser radius in screen px, independent of zoom. */
  eraserPx: number;
  eraseMode: EraseMode;
  highlighterOnly: boolean;
  /** Style for new text boxes. */
  text: TextStyle;
  /** Colour for new sticky notes. */
  stickyColor: string;
}

export type { Selection };

export interface GestureState {
  touches: Map<number, Vec>;
  active: boolean;
}

interface Props {
  page: Page;
  zoom: number;
  store: DocumentStore;
  tool: ToolState;
  penOnly: boolean;
  gesture: MutableRefObject<GestureState>;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  selectionColors: string[];
  stickyColors: string[];
  /** Save the lasso selection to the elements library. */
  onSaveElement?: (sel: Selection) => void;
  /** Add the selection's area to the notebook's outline. */
  onAddToOutline?: (sel: Selection) => void;
  /** Go where a tapped link points. */
  onFollowLink?: (target: LinkTarget) => void;
  /** Make the selection a link, or edit the link that is selected. */
  onEditLink?: (sel: Selection, link: LinkItem | null) => void;
  /** Read-only: no tool does anything; a tap follows a link (or seeks recorded audio) and nothing else. */
  readOnly?: boolean;
  /** Tape strips lifted to show what is under them, and a tap on a strip to lift or lay it back. */
  revealed?: ReadonlySet<string>;
  onToggleTape?: (id: string) => void;
  /** Eyedropper: the next press reports the colour under it instead of using the tool. */
  onSample?: (hex: string) => void;
  /** Laser points as they are drawn (page units), for a presentation window; head null when the pen lifts. */
  onLaser?: (pageId: string, points: Vec[], head: Vec | null) => void;
  /** An audio recording playing at time `t` (ms): its ink that hasn't been reached yet is drawn faded. */
  playback?: { rec: string; t: number } | null;
  /** When set, tapping ink written during a recording plays the audio from there instead of using the tool. */
  onSeekInk?: (rec: string, t: number) => void;
  /** The ruler's edges in client (screen) coordinates, when it is out. */
  rulerEdges?: () => Edge[] | null;
  /** The zoom window's target box, shown on its page. */
  zoomTarget?: ZoomTarget | null;
  setZoomTarget?: (t: ZoomTarget) => void;
  /** Boxes to highlight (a search result on this page), in page units. */
  highlights?: readonly { x: number; y: number; w: number; h: number }[];
}

type EditableItem = TextItem | StickyItem;
interface Editing {
  item: EditableItem;
  /** Not in the document yet: committing adds it (an empty new text box is dropped). */
  isNew: boolean;
}

const FONT_LABELS: Record<FontKey, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono' };
const FONT_KEYS = Object.keys(FONTS) as FontKey[];

/** Measuring for an item's text, so stored heights match what the canvas draws. */
const measureFor = (it: PageItem) => (it.kind === 'text' ? measurer(it.font, it.size) : measurer('sans', STICKY_TEXT_SIZE));

const HOLD_MS = 550;
/** Strokes starting this close to a ruler edge (screen px) are drawn along it. */
const RULER_REACH_PX = 28;

/** A point moved onto the ruler edge, with the ink just touching it. Pressure and timestamp are kept. */
const onRuler = (p: InputPoint, e: Edge, width: number): InputPoint => ({ ...p, ...projectToEdge(p, e, width / 2) });

/**
 * After snapping, lines and arrows keep their start and follow the pen with their end;
 * closed shapes scale about their centre as the pen moves toward or away from it.
 */
interface Snap {
  base: Shape;
  shape: Shape;
  pivot: Vec;
  grab: number;
}

function makeSnap(shape: Shape, pen: Vec): Snap {
  const pivot = shapeCenter(shape);
  return { base: shape, shape, pivot, grab: Math.hypot(pen.x - pivot.x, pen.y - pivot.y) };
}

function followPen(s: Snap, pen: Vec): Shape {
  const b = s.base;
  if (b.kind === 'line') return { ...b, b: { x: pen.x, y: pen.y } };
  if (b.kind === 'arrow') return { ...b, tip: { x: pen.x, y: pen.y } };
  if (s.grab < 8) return b; // pen is too near the centre for a stable scale factor
  return transformShape(b, s.pivot, Math.max(0.1, Math.hypot(pen.x - s.pivot.x, pen.y - s.pivot.y) / s.grab));
}

/** The strokes to commit for an ink gesture: one per shape path, or the freehand stroke. */
function inkStrokes(stroke: Stroke, shape: Shape | null): Stroke[] {
  if (!shape) return [stroke];
  // A shape drawn during a recording keeps the time its freehand stroke started.
  const t = stroke.points[0]?.t;
  return shapePaths(shape).map((points, i) => ({ ...stroke, id: i ? newId() : stroke.id, points: stampShape(points, t), simulatePressure: false, shape: true }));
}


type Active =
  | {
      kind: 'ink';
      pointerId: number;
      stroke: Stroke;
      predicted: InputPoint[];
      /** Freehand ink snapped to a shape (after a hold, or a straight highlighter from the start). */
      snap: Snap | null;
      recognize: (pts: InputPoint[]) => Shape | null;
      holdTimer: ReturnType<typeof setTimeout> | null;
      anchor: Vec;
      /** The ruler edge this stroke is drawn along (page space). */
      ruler: Edge | null;
    }
  | {
      kind: 'erase';
      pointerId: number;
      /** Radius in page units, fixed for the whole gesture. */
      r: number;
      mode: EraseMode;
      canErase: (s: Stroke) => boolean;
      /** Whole-stroke mode: strokes to remove. */
      hits: Set<string>;
      /** Partial mode: original stroke id → its surviving pieces. */
      pieces: Map<string, Stroke[]>;
      cursor: Vec;
      last: Vec;
    }
  | { kind: 'lasso'; pointerId: number; poly: Vec[] }
  | { kind: 'laser'; pointerId: number; cursor: Vec }
  | { kind: 'tape'; pointerId: number; start: Vec; cur: Vec };

export function PageView({ page, zoom, store, tool, penOnly, gesture, selection, setSelection, selectionColors, stickyColors, rulerEdges, zoomTarget, setZoomTarget, onSaveElement, onAddToOutline, onFollowLink, onEditLink, readOnly, onLaser, onSample, revealed, onToggleTape, playback, onSeekInk, highlights }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  // Refs read by event handlers so they always see the latest props without re-binding.
  const pageRef = useRef(page);
  pageRef.current = page;
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const hidden = useRef<Set<string> | null>(null);
  const replaced = useRef<Map<string, Stroke[]> | null>(null);
  const laserTrail = useRef<LaserPoint[]>([]);
  const active = useRef<Active | null>(null);
  /** Read-only: a press waiting to see whether it is a tap. */
  const readTap = useRef<{ pointerId: number; pt: Vec; x: number; y: number; t: number; moved: boolean } | null>(null);
  /** A press that began on a link; it follows the link if it ends as a tap. */
  const linkTap = useRef<{ pointerId: number; link: LinkItem | null; tapeId: string | null; x: number; y: number; t: number; moved: boolean } | null>(null);
  const clearLiveOnNextBase = useRef(false);
  const liveFrame = useRef(0);
  const [drag, setDragState] = useState<{ pointerId: number; sx: number; sy: number; dx: number; dy: number } | null>(null);
  // Mirror for the rAF painter, which must never see a stale closure.
  const dragRef = useRef<{ m: Matrix; ids: string[] } | null>(null);
  // Resize (corner handles) or rotate (top handle) of a lasso selection in progress.
  const [xform, setXformState] = useState<{
    pointerId: number;
    kind: 'scale' | 'rotate';
    pivot: Vec;
    start: Vec;
    bounds: Bounds;
    m: Matrix;
    angle: number;
  } | null>(null);
  // Items: hidden while edited in the textarea, or drawn moved/resized while a drag is in progress.
  const hiddenItems = useRef<Set<string> | null>(null);
  const itemOverride = useRef<Map<string, PageItem> | null>(null);
  const [editing, setEditingState] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [resize, setResize] = useState<{ pointerId: number; sx: number; sy: number; item: PageItem; preview: PageItem } | null>(null);
  const visibleRef = useRef(false);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const scale = zoom;
  const size = pageSize(page);
  const selected = selection?.pageId === page.id ? selection : null;
  const images = imageResolver(store.doc.id);

  // --- Virtualisation: only pages near the viewport own a full-res canvas. ---
  useEffect(() => {
    const el = wrapRef.current!;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '100% 100%' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const renderBase = () => {
    const canvas = baseRef.current;
    if (!canvas) return;
    paintPage(canvas, pageRef.current, scale, dpr, {
      hidden: hidden.current ?? undefined,
      replace: replaced.current ?? undefined,
      items: { images, hidden: hiddenItems.current ?? undefined, override: itemOverride.current ?? undefined, revealed },
      pdf: pdfResolver(store.doc.id),
      fade: playbackRef.current ? (s) => playbackState(s, playbackRef.current!.rec, playbackRef.current!.t) === 'ahead' : undefined,
    });
    if (clearLiveOnNextBase.current) {
      clearLiveOnNextBase.current = false;
      clearLive();
    }
  };

  // Re-render committed layer on content change immediately, on zoom change debounced
  // (the CSS-stretched old bitmap covers the gap, like a tile cache would).
  const lastZoom = useRef(zoom);
  visibleRef.current = visible;
  // Repaint once images this page shows have been decoded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onImagesLoaded(() => visibleRef.current && renderBase()), [zoom, dpr]);
  useLayoutEffect(() => {
    if (!visible) {
      const c = baseRef.current;
      if (c && c.width) {
        c.width = 0; // release GPU memory for off-screen pages
        c.height = 0;
      }
      return;
    }
    if (lastZoom.current !== zoom && baseRef.current?.width) {
      lastZoom.current = zoom;
      const t = setTimeout(renderBase, 120);
      return () => clearTimeout(t);
    }
    lastZoom.current = zoom;
    renderBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, zoom, visible, dpr, playback?.rec, playback?.t, revealed]);

  // --- Live (wet-ink) layer -------------------------------------------------
  const liveCtx = () => {
    const c = liveRef.current!;
    const w = Math.round(size.w * scale * dpr);
    const h = Math.round(size.h * scale * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(w / size.w, 0, 0, h / size.h, 0, 0);
    return ctx;
  };

  const clearLive = () => {
    // A frame queued during the gesture must not repaint after we've cleared.
    if (liveFrame.current) cancelAnimationFrame(liveFrame.current);
    liveFrame.current = 0;
    const c = liveRef.current;
    if (c && c.width) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
  };

  const drawLive = () => {
    liveFrame.current = 0;
    const a = active.current;
    const d = dragRef.current;
    const ctx = liveCtx();
    if (d) {
      ctx.transform(...d.m);
      const ids = new Set(d.ids);
      paintStrokes(ctx, pageRef.current.strokes.filter((s) => ids.has(s.id)));
      return;
    }
    const trail = laserTrail.current;
    if (trail.length || a?.kind === 'laser') {
      const now = performance.now();
      while (trail.length && now - trail[0].t > LASER_FADE_MS) trail.shift();
      paintLaser(ctx, trail, now, scale, a?.kind === 'laser' ? a.cursor : null);
      // Keep animating until the trail has faded and the pointer is up.
      if (trail.length || a?.kind === 'laser') liveFrame.current = requestAnimationFrame(drawLive);
    }
    if (!a) return;
    if (a.kind === 'ink') {
      const paths = a.snap ? shapePaths(a.snap.shape) : [[...a.stroke.points, ...a.predicted]];
      // Highlighter on the live layer is drawn opaque and blended via CSS multiply.
      ctx.fillStyle = a.stroke.color;
      if (a.stroke.tool === 'highlighter') ctx.globalAlpha = 0.38;
      const style = a.snap ? { ...a.stroke, simulatePressure: false, shape: true } : a.stroke;
      for (const pts of paths) paintInk(ctx, pts, style, !!a.snap);
    } else if (a.kind === 'erase') {
      ctx.beginPath();
      ctx.arc(a.cursor.x, a.cursor.y, a.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120,120,120,0.12)';
      ctx.strokeStyle = 'rgba(80,80,80,0.6)';
      ctx.lineWidth = 1 / scale;
      ctx.fill();
      ctx.stroke();
    } else if (a.kind === 'tape') {
      const r = tapeRect(a.start, a.cur);
      if (r) {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = tool.tapeColor;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    } else if (a.kind === 'lasso' && a.poly.length > 1) {
      ctx.beginPath();
      ctx.moveTo(a.poly[0].x, a.poly[0].y);
      for (const p of a.poly) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(64,120,220,0.06)';
      ctx.fill();
      ctx.setLineDash([6 / scale, 5 / scale]);
      ctx.strokeStyle = '#3f7be0';
      ctx.lineWidth = 1.5 / scale;
      ctx.stroke();
    }
  };

  const scheduleLive = () => {
    if (!liveFrame.current) liveFrame.current = requestAnimationFrame(drawLive);
  };

  const setDrag = (next: typeof drag) => {
    setDragState(next);
    previewTransform(next ? translate(next.dx, next.dy) : null);
  };

  /**
   * Show the selection under `m` (null ends the preview): strokes on the live layer, items on the
   * base layer so they keep their place under or over the ink.
   */
  const previewTransform = (m: Matrix | null) => {
    dragRef.current = m && selected ? { m, ids: selected.strokeIds } : null;
    if (m) scheduleLive();
    if (selected?.itemIds.length) {
      const ids = new Set(selected.itemIds);
      itemOverride.current = m ? new Map(pageRef.current.items.filter((it) => ids.has(it.id)).map((it) => [it.id, transformItem(it, m)])) : null;
      if (m) renderBase();
    }
  };

  // --- Text box and sticky note editing --------------------------------------------
  const setEditing = (next: Editing | null) => {
    editingRef.current = next;
    hiddenItems.current = next ? new Set([next.item.id]) : null;
    setEditingState(next);
    renderBase();
  };

  const commitEdit = () => {
    const ed = editingRef.current;
    if (!ed) return;
    const text = textareaRef.current?.value ?? ed.item.text;
    const cur = pageRef.current;
    const it = ed.item;
    let ops: DocOp[] = [];
    if (it.kind === 'text') {
      const h = textHeight({ ...it, text }, measureFor(it));
      if (!text.trim()) {
        const op = !ed.isNew && removeItemsOp(cur, [it.id]);
        if (op) ops = [op];
      } else if (ed.isNew) {
        ops = [{ type: 'items.added', pageId: cur.id, items: [{ ...it, text, h }] }];
      } else if (text !== it.text) {
        const op = updateItemOp(cur, it.id, { text, h });
        if (op) ops = [op];
      }
    } else if (ed.isNew) {
      ops = [{ type: 'items.added', pageId: cur.id, items: [{ ...it, text }] }];
    } else if (text !== it.text) {
      const op = updateItemOp(cur, it.id, { text });
      if (op) ops = [op];
    }
    editingRef.current = null;
    hiddenItems.current = null;
    setEditingState(null);
    if (ops.length) store.dispatch(ops);
    else renderBase();
  };

  // Focus the editor once it is on screen, with the caret at the end.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!editing || !ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    autoGrow(ta);
  }, [editing]);

  const autoGrow = (ta: HTMLTextAreaElement) => {
    if (editingRef.current?.item.kind !== 'text') return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  /** Text and Sticky tools: tap an item of that kind to edit it, or empty paper to add one. */
  const tapItemTool = (pt: Vec) => {
    if (tool.kind === 'text') {
      const hit = itemAt(pageRef.current, pt, ['text']);
      setEditing(hit ? { item: hit as TextItem, isNew: false } : { item: newText(pt, tool.text, size), isNew: true });
    } else {
      const hit = itemAt(pageRef.current, pt, ['sticky']) as StickyItem | null;
      if (hit?.collapsed) {
        const op = updateItemOp(pageRef.current, hit.id, { collapsed: false });
        if (op) store.dispatch([op]);
      } else {
        setEditing(hit ? { item: hit, isNew: false } : { item: newSticky(pt, tool.stickyColor, size), isNew: true });
      }
    }
  };

  // --- Input -----------------------------------------------------------------
  const toPage = (e: { clientX: number; clientY: number; pressure: number }, pointerType: string): InputPoint => {
    const r = liveRef.current!.getBoundingClientRect();
    const k = size.w / r.width;
    return {
      x: (e.clientX - r.left) * k,
      y: (e.clientY - r.top) * k,
      // Mouse reports 0.5 while pressed; finger often 0 or 1 — both are synthesised later.
      p: pressureOf(e, pointerType),
      ...timeStamp(),
    };
  };

  /** The ruler edge beside page point `pt`, mapped into page space, if the ruler is out. */
  const rulerEdgeAt = (pt: Vec): Edge | null => {
    const edges = rulerEdges?.();
    if (!edges || !liveRef.current) return null;
    const r = liveRef.current.getBoundingClientRect();
    const k = size.w / r.width;
    const toPagePt = (v: Vec) => ({ x: (v.x - r.left) * k, y: (v.y - r.top) * k });
    return edgeNear(pt, edges.map((e) => mapEdge(e, toPagePt, k)), RULER_REACH_PX * k);
  };

  const ignoreTouch = (e: React.PointerEvent) =>
    e.pointerType === 'touch' && (penOnly || gesture.current.active || gesture.current.touches.size > 1);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (onSample) {
      // Read the drawn page (paper, PDF, photos, ink) at this point.
      e.preventDefault();
      const base = baseRef.current;
      const r = e.currentTarget.getBoundingClientRect();
      const ctx = base?.getContext('2d', { willReadFrequently: true });
      if (!base || !ctx || !base.width) return;
      const x = Math.floor(((e.clientX - r.left) / r.width) * base.width);
      const y = Math.floor(((e.clientY - r.top) / r.height) * base.height);
      try {
        onSample(pixelToHex(ctx.getImageData(Math.min(x, base.width - 1), Math.min(y, base.height - 1), 1, 1).data));
      } catch {
        // A page drawn from something the browser won't let us read: leave the colour as it was.
      }
      return;
    }
    if (readOnly) {
      // Only remember the press: it follows a link if it ends as a tap. Fingers count here even in
      // Stylus only mode (there's nothing to draw); a finger that pans moves, so it won't count as a tap.
      if (e.pointerType === 'touch' && gesture.current.touches.size > 1) return;
      const pt = toPage(e, e.pointerType);
      readTap.current = { pointerId: e.pointerId, pt, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      return;
    }
    if (ignoreTouch(e) || active.current) return;
    e.preventDefault();
    if (selection) setSelection(null);
    const pt = toPage(e, e.pointerType);
    if (editingRef.current) {
      // Tapping away ends editing; with the Text or Sticky tool that tap does nothing else.
      commitEdit();
      if (tool.kind === 'text' || tool.kind === 'sticky') return;
    }
    // A press on a link follows it, and one on tape shows or covers what is under it, if it turns out
    // to be a tap, whatever the tool.
    const link = onFollowLink ? linkAt(pageRef.current, pt, 4 / scale) : null;
    const tape = !link && onToggleTape ? tapeAt(pageRef.current, pt) : null;
    linkTap.current = link || tape ? { pointerId: e.pointerId, link, tapeId: tape?.id ?? null, x: e.clientX, y: e.clientY, t: performance.now(), moved: false } : null;
    if ((link || tape) && (tool.kind === 'text' || tool.kind === 'sticky')) {
      // These tools act on press, so a press on a link or tape is taken as a tap on it.
      linkTap.current = null;
      if (link) onFollowLink?.(link.target);
      else if (tape) onToggleTape?.(tape.id);
      return;
    }
    // Playback mode: tapping recorded ink jumps the audio to when it was written.
    if (onSeekInk) {
      const hit = strokeAtForSeek(pageRef.current.strokes, pt, 8 / scale);
      if (hit?.rec) {
        onSeekInk(hit.rec, seekTimeFor(hit));
        return;
      }
    }
    if (tool.kind === 'text' || tool.kind === 'sticky') {
      tapItemTool(pt);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (liveRef.current) liveRef.current.style.mixBlendMode = tool.kind === 'highlighter' ? 'multiply' : 'normal';

    if (tool.kind === 'pen' || tool.kind === 'highlighter' || tool.kind === 'shapes') {
      const highlighter = tool.kind === 'highlighter';
      // A pen or highlighter stroke that starts beside the ruler is drawn along its edge.
      const ruler = tool.kind !== 'shapes' ? rulerEdgeAt(pt) : null;
      // A straight highlighter starts already snapped: the line follows the pointer until lift.
      const straight = highlighter && tool.straight && !ruler;
      const stroke = newInkStroke(tool, ruler ? onRuler(pt, ruler, tool.width) : pt, e.pointerType);
      // The highlighter only straightens; pen and Shapes snap to any shape.
      const recognize = highlighter
        ? (pts: InputPoint[]): Shape | null => {
            const l = detectLine(pts);
            return l && { kind: 'line', a: l.a, b: l.b };
          }
        : recognizeShape;
      const snap = straight ? makeSnap({ kind: 'line', a: pt, b: pt }, pt) : null;
      active.current = { kind: 'ink', pointerId: e.pointerId, stroke, predicted: [], snap, recognize, holdTimer: null, anchor: pt, ruler };
      if (!straight && !ruler) armHold();
    } else if (tool.kind === 'eraser') {
      const highlighterOnly = tool.highlighterOnly;
      active.current = {
        kind: 'erase',
        pointerId: e.pointerId,
        r: tool.eraserPx / scale,
        mode: tool.eraseMode,
        canErase: (s) => !highlighterOnly || s.tool === 'highlighter',
        hits: new Set(),
        pieces: new Map(),
        cursor: pt,
        last: pt,
      };
      eraseAt([pt]);
    } else if (tool.kind === 'laser') {
      active.current = { kind: 'laser', pointerId: e.pointerId, cursor: pt };
      laserTrail.current.push({ ...pt, t: performance.now() });
      onLaser?.(page.id, [pt], pt);
    } else if (tool.kind === 'tape') {
      active.current = { kind: 'tape', pointerId: e.pointerId, start: pt, cur: pt };
    } else {
      active.current = { kind: 'lasso', pointerId: e.pointerId, poly: [pt] };
    }
    scheduleLive();
  };

  const armHold = () => {
    const a = active.current;
    if (a?.kind !== 'ink') return;
    if (a.holdTimer) clearTimeout(a.holdTimer);
    a.holdTimer = setTimeout(() => {
      const cur = active.current;
      if (cur !== a || a.snap) return;
      const shape = a.recognize(a.stroke.points);
      if (!shape) return;
      a.snap = makeSnap(shape, a.stroke.points[a.stroke.points.length - 1]);
      scheduleLive();
    }, HOLD_MS);
  };

  const eraseAt = (pts: Vec[]) => {
    const a = active.current;
    if (a?.kind !== 'erase') return;
    let changed = false;
    if (a.mode === 'stroke') {
      for (const s of pageRef.current.strokes) {
        if (a.hits.has(s.id) || !a.canErase(s)) continue;
        if (pts.some((p) => strokeHitsCircle(s, p.x, p.y, a.r))) {
          a.hits.add(s.id);
          changed = true;
        }
      }
      if (changed) hidden.current = a.hits;
    } else {
      // Cut along the segment from the last eraser position, so fast swipes leave no gaps.
      const path = [a.last, ...pts];
      for (const s of pageRef.current.strokes) {
        if (!a.canErase(s)) continue;
        let touched = false;
        const next = (a.pieces.get(s.id) ?? [s]).flatMap((piece) => {
          const cut = splitStroke(piece, path, a.r);
          if (cut) touched = true;
          return cut ?? [piece];
        });
        if (touched) {
          a.pieces.set(s.id, next);
          changed = true;
        }
      }
      if (changed) replaced.current = a.pieces;
    }
    a.last = pts[pts.length - 1];
    if (changed) renderBase();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rt = readTap.current;
    if (rt && rt.pointerId === e.pointerId && Math.hypot(e.clientX - rt.x, e.clientY - rt.y) > TAP_SLOP_PX) rt.moved = true;
    const tap = linkTap.current;
    if (tap && tap.pointerId === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP_PX) tap.moved = true;
    const a = active.current;
    if (!a || e.pointerId !== a.pointerId) return;
    if (e.pointerType === 'touch' && gesture.current.active) {
      cancel(); // a second finger turned this into a pan/zoom
      return;
    }
    const native = e.nativeEvent;
    // Coalesced events recover the full sample rate (120–240 Hz on styluses)
    // that a 60 Hz pointermove would otherwise drop.
    const samples = native.getCoalescedEvents?.() ?? [];
    const pts = (samples.length ? samples : [native]).map((s) => toPage(s, e.pointerType));

    if (a.kind === 'ink') {
      const last = pts[pts.length - 1];
      if (a.snap) {
        a.snap.shape = followPen(a.snap, last);
      } else if (a.ruler) {
        const prev = a.stroke.points;
        for (const p of pts) {
          const q = onRuler(p, a.ruler, a.stroke.width);
          const r = prev[prev.length - 1];
          if (Math.abs(q.x - r.x) > 0.01 || Math.abs(q.y - r.y) > 0.01) prev.push(q);
        }
      } else {
        const prev = a.stroke.points;
        for (const p of pts) {
          const q = prev[prev.length - 1];
          if (p.x !== q.x || p.y !== q.y) prev.push(p);
        }
        // Predicted events extend the wet ink ahead of the pen to hide latency.
        const predicted = native.getPredictedEvents?.() ?? [];
        a.predicted = predicted.map((s) => toPage(s, e.pointerType));
        if (Math.hypot(last.x - a.anchor.x, last.y - a.anchor.y) * scale > 3) {
          a.anchor = last;
          armHold();
        }
      }
    } else if (a.kind === 'erase') {
      a.cursor = pts[pts.length - 1];
      eraseAt(pts);
    } else if (a.kind === 'tape') {
      a.cur = pts[pts.length - 1];
    } else if (a.kind === 'laser') {
      const t = performance.now();
      a.cursor = pts[pts.length - 1];
      laserTrail.current.push(...pts.map((p) => ({ x: p.x, y: p.y, t })));
      onLaser?.(page.id, pts.map((p) => ({ x: p.x, y: p.y })), a.cursor);
    } else {
      a.poly.push(...pts);
    }
    scheduleLive();
  };

  const finish = (commitArg: boolean) => {
    const a = active.current;
    if (!a) return;
    active.current = null;
    // A quick tap on a link follows it: whatever the tool began (a dot, an erase, a selection) is dropped.
    const tap = linkTap.current;
    linkTap.current = null;
    const follow = commitArg && tap && tap.pointerId === a.pointerId && !tap.moved && performance.now() - tap.t < TAP_MS ? tap : null;
    const commit = commitArg && !follow;
    if (follow) {
      if (a.kind === 'ink' && a.holdTimer) clearTimeout(a.holdTimer);
      hidden.current = null;
      replaced.current = null;
      if (a.kind === 'erase') renderBase();
      clearLive();
      if (follow.link) onFollowLink?.(follow.link.target);
      else if (follow.tapeId) onToggleTape?.(follow.tapeId);
      return;
    }
    if (a.kind === 'tape') {
      clearLive();
      const rect = commit ? tapeRect(a.start, a.cur) : null;
      if (rect) store.dispatch([{ type: 'items.added', pageId: page.id, items: [newTape(rect, tool.tapeColor)] }]);
      return;
    }
    if (a.kind === 'ink') {
      if (a.holdTimer) clearTimeout(a.holdTimer);
      if (commit) {
        // The Shapes tool also recognises on lift, without needing a hold.
        const shape = a.snap?.shape ?? (tool.kind === 'shapes' ? recognizeShape(a.stroke.points) : null);
        clearLiveOnNextBase.current = true;
        store.dispatch([{ type: 'strokes.added', pageId: page.id, strokes: inkStrokes(a.stroke, shape) }]);
        return;
      }
    } else if (a.kind === 'erase') {
      hidden.current = null;
      replaced.current = null;
      let ops: DocOp[] = [];
      if (commit && a.mode === 'stroke') {
        const op = removeStrokesOp(pageRef.current, a.hits);
        if (op) ops = [op];
      } else if (commit) {
        ops = replaceStrokesOps(pageRef.current, a.pieces);
      }
      if (ops.length) store.dispatch(ops);
      else renderBase();
    } else if (a.kind === 'laser') {
      onLaser?.(page.id, [], null);
      scheduleLive(); // let the trail fade out instead of clearing it
      return;
    } else if (a.kind === 'lasso' && commit) {
      // A tap (rather than a loop) selects the item under it.
      if (pointsLength(a.poly as InputPoint[]) * scale < 8) {
        const hit = itemAt(pageRef.current, a.poly[0]);
        setSelection(hit ? { pageId: page.id, strokeIds: [], itemIds: [hit.id] } : null);
      } else {
        setSelection(selectInLasso(pageRef.current, a.poly));
      }
    }
    clearLive();
  };

  const cancel = () => {
    readTap.current = null;
    finish(false);
  };

  /** Read-only: a quick, still tap follows the link under it, or jumps recorded audio to the ink under it. */
  const readOnlyTap = (pointerId: number) => {
    const tap = readTap.current;
    readTap.current = null;
    if (!tap || tap.pointerId !== pointerId || tap.moved || performance.now() - tap.t > TAP_MS) return;
    const link = linkAt(pageRef.current, tap.pt, 4 / scale);
    if (link) return onFollowLink?.(link.target);
    const tape = tapeAt(pageRef.current, tap.pt);
    if (tape) return onToggleTape?.(tape.id);
    if (onSeekInk) {
      const hit = strokeAtForSeek(pageRef.current.strokes, tap.pt, 8 / scale);
      if (hit?.rec) onSeekInk(hit.rec, seekTimeFor(hit));
    }
  };

  // --- Selection (lasso result) -------------------------------------------------
  const selStrokes = selected ? selectedStrokes(page, selected) : [];
  // While resizing, the box follows the preview rather than the stored item.
  const shownPage = resize ? { ...page, items: page.items.map((it) => (it.id === resize.item.id ? resize.preview : it)) } : page;
  const selBounds = selected && !editing && selectionBounds(shownPage, selected);
  const soleItem = selected && !selected.strokeIds.length && selected.itemIds.length === 1 ? (page.items.find((it) => it.id === selected.itemIds[0]) ?? null) : null;
  const selTexts = selected ? page.items.filter((it): it is TextItem => it.kind === 'text' && selected.itemIds.includes(it.id)) : [];

  // --- Resize and rotate handles (lasso selections) ----------------------------------
  const pagePoint = (e: { clientX: number; clientY: number }): Vec => {
    const r = liveRef.current!.getBoundingClientRect();
    const k = size.w / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };

  const onXformDown = (kind: 'scale' | 'rotate', corner?: 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selBounds) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const b = selBounds;
    const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    // Corner handles scale about the opposite corner.
    const pivot = kind === 'rotate' ? center : { x: corner?.endsWith('w') ? b.maxX : b.minX, y: corner?.startsWith('n') ? b.maxY : b.minY };
    hidden.current = new Set(selected?.strokeIds ?? []);
    renderBase();
    if (liveRef.current) liveRef.current.style.mixBlendMode = 'normal';
    const start = kind === 'rotate' ? pagePoint(e) : { x: corner?.endsWith('w') ? b.minX : b.maxX, y: corner?.startsWith('n') ? b.minY : b.maxY };
    setXformState({ pointerId: e.pointerId, kind, pivot, start, bounds: b, m: [1, 0, 0, 1, 0, 0], angle: 0 });
    previewTransform([1, 0, 0, 1, 0, 0]);
  };

  const onXformMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!xform || e.pointerId !== xform.pointerId) return;
    const p = pagePoint(e);
    const { pivot, start, bounds } = xform;
    let m: Matrix;
    let angle = 0;
    if (xform.kind === 'scale') {
      // Project the pointer onto the pivot→corner diagonal, so the selection keeps its proportions.
      const dx = start.x - pivot.x, dy = start.y - pivot.y;
      const k = ((p.x - pivot.x) * dx + (p.y - pivot.y) * dy) / (dx * dx + dy * dy || 1);
      const minK = 8 / Math.max(1, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      m = scaleAbout(Math.max(minK, k), pivot);
    } else {
      angle = snapAngle(Math.atan2(p.y - pivot.y, p.x - pivot.x) - Math.atan2(start.y - pivot.y, start.x - pivot.x));
      m = rotateAbout(angle, pivot);
    }
    setXformState({ ...xform, m, angle });
    previewTransform(m);
  };

  const onXformUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!xform || e.pointerId !== xform.pointerId) return;
    hidden.current = null;
    itemOverride.current = null;
    dragRef.current = null;
    setXformState(null);
    const ops = selected ? transformSelectionOps(page, selected, xform.m) : [];
    if (ops.length) {
      clearLiveOnNextBase.current = true;
      store.dispatch(ops);
    } else {
      renderBase();
      clearLive();
    }
  };

  // If the selection goes away mid-gesture (Esc, undo, a tool switch), its handles unmount before
  // pointer-up. Drop the preview and show the strokes again; nothing is committed.
  const gestureSelection = useRef(selected);
  useEffect(() => {
    if (gestureSelection.current === selected) return;
    gestureSelection.current = selected;
    if (!dragRef.current && !itemOverride.current) return;
    hidden.current = null;
    itemOverride.current = null;
    dragRef.current = null;
    setDragState(null);
    setXformState(null);
    setResize(null);
    renderBase();
    clearLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const onSelDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    hidden.current = new Set(selected?.strokeIds ?? []);
    renderBase();
    if (liveRef.current) liveRef.current.style.mixBlendMode = 'normal';
    setDrag({ pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 });
  };
  const onSelMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    setDrag({ ...drag, dx: (e.clientX - drag.sx) / scale, dy: (e.clientY - drag.sy) / scale });
  };
  const onSelUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    hidden.current = null;
    setDrag(null);
    const ops = selected && (Math.abs(drag.dx) > 0.5 || Math.abs(drag.dy) > 0.5) ? moveSelectionOps(page, selected, drag.dx, drag.dy) : [];
    if (ops.length) {
      clearLiveOnNextBase.current = true;
      store.dispatch(ops);
    } else {
      renderBase();
      clearLive();
    }
  };

  const deleteSelection = () => {
    if (selected) store.dispatch(deleteSelectionOps(page, selected));
    setSelection(null);
  };
  const duplicateSelection = () => {
    if (!selected) return;
    const dup = duplicateSelectionOps(page, selected, 24, 24);
    store.dispatch(dup.ops);
    setSelection(dup.selection);
  };
  const recolorSelection = (color: string) => {
    const ops: DocOp[] = [];
    if (selStrokes.length)
      ops.push({
        type: 'strokes.recolored',
        pageId: page.id,
        ids: selStrokes.map((s) => s.id),
        colors: selStrokes.map(() => color),
        previous: selStrokes.map((s) => s.color),
      });
    for (const t of selTexts) {
      const op = updateItemOp(page, t.id, { color });
      if (op) ops.push(op);
    }
    if (ops.length) store.dispatch(ops);
  };

  /** Patch the one selected item. Text boxes get their height re-measured. */
  const patchSoleItem = (patch: Parameters<typeof updateItemOp>[2]) => {
    if (!soleItem) return;
    let full = patch;
    if (soleItem.kind === 'text') {
      const next = { ...soleItem, ...patch } as TextItem;
      full = { ...patch, h: textHeight(next, measureFor(next)) };
    }
    const op = updateItemOp(page, soleItem.id, full);
    if (op) store.dispatch([op]);
  };

  const editSoleItem = () => {
    if (soleItem?.kind !== 'text' && (soleItem?.kind !== 'sticky' || soleItem.collapsed)) return;
    setSelection(null);
    setEditing({ item: soleItem, isNew: false });
  };

  // --- Resize handle (one selected item) ----------------------------------------------
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!soleItem) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setResize({ pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, item: soleItem, preview: soleItem });
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resize || e.pointerId !== resize.pointerId) return;
    const { item } = resize;
    const preview = resizeItem(item, item.w + (e.clientX - resize.sx) / scale, item.h + (e.clientY - resize.sy) / scale, measureFor(item));
    itemOverride.current = new Map([[item.id, preview]]);
    renderBase();
    setResize({ ...resize, preview });
  };
  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resize || e.pointerId !== resize.pointerId) return;
    const { item, preview } = resize;
    itemOverride.current = null;
    setResize(null);
    const op = preview.w !== item.w || preview.h !== item.h ? updateItemOp(page, item.id, { w: preview.w, h: preview.h }) : null;
    if (op) store.dispatch([op]);
    else renderBase();
  };

  // --- Zoom window target box: drag to move it ----------------------------------------
  const targetDrag = useRef<{ pointerId: number; sx: number; sy: number; x: number; y: number } | null>(null);
  const onTargetDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!zoomTarget) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    targetDrag.current = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, x: zoomTarget.x, y: zoomTarget.y };
  };
  const onTargetMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = targetDrag.current;
    if (!d || !zoomTarget || e.pointerId !== d.pointerId) return;
    setZoomTarget?.(clampTarget({ ...zoomTarget, x: d.x + (e.clientX - d.sx) / scale, y: d.y + (e.clientY - d.sy) / scale }, size));
  };
  const onTargetUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (targetDrag.current?.pointerId === e.pointerId) targetDrag.current = null;
  };
  const showTarget = zoomTarget?.pageId === page.id ? zoomTarget : null;

  const cssW = size.w * scale;
  const cssH = size.h * scale;

  return (
    <div ref={wrapRef} className="page" data-page-id={page.id} style={{ width: cssW, height: cssH, background: PAPER_STYLES[pagePaper(page)].fill }}>
      <canvas ref={baseRef} className="page-layer" />
      <canvas
        ref={liveRef}
        className={`page-layer live ${onSample ? 'sampling' : readOnly ? 'read-only' : `tool-${tool.kind}`}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => (readOnly ? readOnlyTap(e.pointerId) : finish(true))}
        onPointerCancel={cancel}
        onLostPointerCapture={(e) => active.current?.pointerId === e.pointerId && finish(true)}
      />
      {selBounds && (
        <>
          <div
            className="selection-box"
            data-no-gesture
            style={(() => {
              // Moving and scaling show the transformed box; rotating turns the original box.
              const b = xform?.kind === 'scale' ? transformBounds(selBounds, xform.m) : selBounds;
              const dx = drag?.dx ?? 0, dy = drag?.dy ?? 0;
              return {
                left: (b.minX + dx) * scale - 6,
                top: (b.minY + dy) * scale - 6,
                width: (b.maxX - b.minX) * scale + 12,
                height: (b.maxY - b.minY) * scale + 12,
                transform: xform?.kind === 'rotate' ? `rotate(${xform.angle}rad)` : undefined,
              };
            })()}
            onPointerDown={onSelDown}
            onPointerMove={onSelMove}
            onPointerUp={onSelUp}
            onPointerCancel={onSelUp}
            onDoubleClick={editSoleItem}
          >
            {soleItem && !drag && !(soleItem.kind === 'sticky' && soleItem.collapsed) && (
              <div
                className="resize-handle"
                aria-label="Resize"
                onPointerDown={onResizeDown}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeUp}
                onPointerCancel={onResizeUp}
              />
            )}
            {!soleItem && !drag && (!xform || xform.kind === 'scale') &&
              (['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                <div
                  key={c}
                  className={`xform-handle ${c}`}
                  aria-label="Resize selection"
                  onPointerDown={onXformDown('scale', c)}
                  onPointerMove={onXformMove}
                  onPointerUp={onXformUp}
                  onPointerCancel={onXformUp}
                />
              ))}
            {!soleItem && !drag && selected && selected.strokeIds.length > 0 && (!xform || xform.kind === 'rotate') && (
              <div
                className="rotate-handle"
                aria-label="Rotate selection"
                onPointerDown={onXformDown('rotate')}
                onPointerMove={onXformMove}
                onPointerUp={onXformUp}
                onPointerCancel={onXformUp}
              >
                {xform && <span className="angle-label">{Math.round((((xform.angle * 180) / Math.PI) % 360 + 540) % 360 - 180)}°</span>}
              </div>
            )}
          </div>
          {!drag && !resize && !xform && (
            <div
              className="selection-menu"
              data-no-gesture
              style={{
                left: selBounds.minX * scale,
                // Above the selection (clear of the rotate handle), or below it near the top of the page.
                top: (() => {
                  const above = selBounds.minY * scale - (selected && selected.strokeIds.length && !soleItem ? 88 : 52);
                  return above >= 4 ? above : selBounds.maxY * scale + 16;
                })(),
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {(soleItem?.kind === 'text' || (soleItem?.kind === 'sticky' && !soleItem.collapsed)) && <button onClick={editSoleItem}>Edit</button>}
              <button onClick={deleteSelection}>Delete</button>
              <button onClick={duplicateSelection}>Duplicate</button>
              {onSaveElement && selected && <button onClick={() => onSaveElement(selected)}>Save as element</button>}
              {onAddToOutline && selected && <button onClick={() => onAddToOutline(selected)}>Add to outline</button>}
              {onEditLink && selected && (
                <button onClick={() => onEditLink(selected, soleItem?.kind === 'link' ? soleItem : null)}>{soleItem?.kind === 'link' ? 'Edit link' : 'Link…'}</button>
              )}
              {soleItem?.kind === 'link' && onFollowLink && <button onClick={() => onFollowLink(soleItem.target)}>Open link</button>}
              {soleItem?.kind === 'text' && (
                <>
                  <span className="divider" />
                  <button
                    title="Font"
                    onClick={() => patchSoleItem({ font: FONT_KEYS[(FONT_KEYS.indexOf(soleItem.font as FontKey) + 1) % FONT_KEYS.length] })}
                    style={{ fontFamily: fontFamily(soleItem.font) }}
                  >
                    {FONT_LABELS[soleItem.font as FontKey] ?? 'Sans'}
                  </button>
                  <button aria-label="Smaller text" onClick={() => patchSoleItem({ size: Math.max(8, soleItem.size - 2) })}>
                    A−
                  </button>
                  <button aria-label="Larger text" onClick={() => patchSoleItem({ size: Math.min(96, soleItem.size + 2) })}>
                    A+
                  </button>
                </>
              )}
              {soleItem?.kind === 'sticky' && (
                <>
                  <span className="divider" />
                  <button onClick={() => patchSoleItem({ collapsed: !soleItem.collapsed })}>{soleItem.collapsed ? 'Expand' : 'Collapse'}</button>
                  {stickyColors.map((c) => (
                    <button key={c} className={`swatch-btn ${soleItem.color === c ? 'active' : ''}`} aria-label={`Note colour ${c}`} onClick={() => patchSoleItem({ color: c })}>
                      <span className="swatch" style={{ background: c }} />
                    </button>
                  ))}
                </>
              )}
              {(selStrokes.length > 0 || selTexts.length > 0) && (
                <>
                  <span className="divider" />
                  {selectionColors.map((c) => (
                    <button key={c} className="swatch-btn" aria-label={`Recolor ${c}`} onClick={() => recolorSelection(c)}>
                      <span className="swatch" style={{ background: c }} />
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}
      {highlights?.map((r, i) => (
        <div key={i} className="search-hit" style={{ left: r.x * scale - 2, top: r.y * scale - 2, width: r.w * scale + 4, height: r.h * scale + 4 }} />
      ))}
      {showTarget && (
        // The box lets ink through; only its grip tab moves it.
        <div className="zoom-target" style={{ left: showTarget.x * scale, top: showTarget.y * scale, width: showTarget.w * scale, height: showTarget.h * scale }}>
          <div
            className="zoom-target-grip"
            data-no-gesture
            role="button"
            aria-label="Move the zoom window area"
            title="Drag to move the zoom window area"
            onPointerDown={onTargetDown}
            onPointerMove={onTargetMove}
            onPointerUp={onTargetUp}
            onPointerCancel={onTargetUp}
          />
        </div>
      )}
      {editing && (
        <textarea
          ref={textareaRef}
          className={`item-editor ${editing.item.kind}`}
          data-no-gesture
          defaultValue={editing.item.text}
          aria-label={editing.item.kind === 'text' ? 'Text box' : 'Sticky note'}
          spellCheck
          onBlur={commitEdit}
          onInput={(e) => autoGrow(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={
            editing.item.kind === 'text'
              ? {
                  left: editing.item.x * scale,
                  top: editing.item.y * scale,
                  width: editing.item.w * scale,
                  minHeight: editing.item.h * scale,
                  padding: TEXT_PAD * scale,
                  font: `${editing.item.size * scale}px/${LINE_HEIGHT} ${fontFamily(editing.item.font)}`,
                  color: editing.item.color,
                }
              : {
                  left: editing.item.x * scale,
                  top: editing.item.y * scale,
                  width: editing.item.w * scale,
                  height: editing.item.h * scale,
                  padding: STICKY_PAD * scale,
                  font: `${STICKY_TEXT_SIZE * scale}px/${LINE_HEIGHT} ${fontFamily('sans')}`,
                  background: editing.item.color,
                }
          }
        />
      )}
    </div>
  );
}
