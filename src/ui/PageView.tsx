import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react';
import {
  pagePaper,
  pageSize,
  type DashStyle,
  type EraseMode,
  type InputPoint,
  type CropRect,
  type ImageItem,
  type LineItem,
  type LinkItem,
  type LinkTarget,
  type ShapeItem,
  type Page,
  type PageItem,
  type PenStyle,
  type RichBlock,
  type StickyItem,
  type Stroke,
  type TextItem,
  type ToolKind,
} from '../core/model';
import { FONTS, fontFamily, itemAt, LINE_HEIGHT, newSticky, newText, resizeItem, STICKY_PAD, STICKY_TEXT_SIZE, TEXT_PAD, textHeight, type FontKey, type TextStyle } from '../core/items';
import { newId } from '../core/ids';
import { LASER_FADE_MS, paintLaser, type LaserPoint } from '../render/laser';
import { linkAt, TAP_MS, TAP_SLOP_PX } from '../core/links';
import { forDarkPaper, pixelToHex } from '../core/color';
import { newTape, tapeAt, tapeRect } from '../core/tape';
import { isScribble, scribbledStrokes } from '../core/scribble';
import { inkKind, type InkKind } from '../core/contentKinds';
import { CropOverlay } from './CropOverlay';
import { SelectionMenu, type MenuAction } from './SelectionMenu';
import { ConvertDialog } from './ConvertDialog';
import type { HandwritingIndex } from '../hwr/indexer';
import { addPersonalWord, type SpellChecker } from '../hwr/spellcheck';
import { pageLines } from '../core/handwriting';
import { findMisspellings, inkColour, replacementFor, textOverInk, textSizeFor, type Misspelling } from '../core/spelling';
import { align as alignInk, insertSpace, minReflowWidth, moveOps, movedStrokes, reflow, smartInkLayout, straighten, type Align, type InkMove } from '../core/smartInk';
import type { RichEditorHandle } from './RichTextEditor';
import { itemBlocks, richPatch } from '../core/richText';
import { ShapeStyleRow } from './ShapeStyle';
import { bendHandle, bendTo, itemFromShape, lineEnds, lineGeometry, touchesCircle } from '../core/shapeItems';
import { anchorPoint, attachDrawnLine, attachmentAt, followConnectors, quickConnectOps, SIDE_AT, SIDES, type Side } from '../core/connectors';
import { animatedResolver, ensureGif, gifFrameIndex, isAnimated, isStatic } from '../render/gifs';
import { screenshotRect, type Rect } from '../core/screenshot';
import { cropPatch, flipPatch } from '../core/imageEdit';
import { canRotate, itemRotation } from '../core/items';
import { snapMove, snapTargets, type SnapGuide, type SnapTargets } from '../core/snap';
import { arrangeSelectionOps, lockSelectionOps, type Arrange } from '../core/arrange';
import { findLayer, visibleContent, workingContent } from '../core/layers';
import { lassoAllowsItem, lassoPolygon, selectWithLasso, type LassoKind, type LassoShape } from '../core/lasso';
import { pointsLength, strokeHitsCircle, unionBounds, type Vec } from '../core/geometry';
import { edgeNear, mapEdge, projectToEdge, type Edge } from '../core/ruler';
import { newInkStroke, pressureOf, timeStamp } from './ink';
import { playbackState, seekTimeFor, stampShape, strokeAtForSeek } from '../core/audio';
import {
  deleteSelectionOps,
  duplicateSelection as duplicateSelectionOps,
  moveSelectionOps,
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
import { paintPage, paintRegion, paintStrokes, PAPER_STYLES } from '../render/page';
import { isLargePage } from '../core/whiteboard';
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
  /** Scribbling over ink with the pen erases it. */
  scribbleErase: boolean;
  /** How much the current ink tool steadies the line, 0..1. */
  stabilise: number;
  /** Highlighter draws ruler-straight lines from the first point. */
  straight: boolean;
  /** Eraser radius in screen px, independent of zoom. */
  eraserPx: number;
  eraseMode: EraseMode;
  /** Which ink the eraser erases. */
  eraseKinds: readonly InkKind[];
  /** Freehand loop or rectangle. */
  lassoShape: LassoShape;
  /** What the lasso picks up. */
  lassoKinds: readonly LassoKind[];
  /** Dragged selections snap to other objects, the page and its lines. */
  snap: boolean;
  /** Style for new text boxes. */
  text: TextStyle;
  /** Colour for new sticky notes. */
  stickyColor: string;
  /** Fill for new shapes from the Shapes tool; null for none. */
  shapeFill: string | null;
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
  /** A region screenshot was taken: add it to the page as a photo, copy it, or save it as a PNG. */
  onScreenshot?: (pageId: string, rect: Rect, action: 'insert' | 'copy' | 'save') => void;
  /** Copy the selection to the clipboard, removing it with `cut`. */
  onCopy?: (sel: Selection, cut: boolean) => void;
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
  /** A pen scribble just erased this many strokes. */
  onScribbleErase?: (count: number) => void;
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
  /** A tool was used while the active layer is hidden or locked, so it did nothing. */
  onLayerBlocked?: (layerName: string, why: 'hidden' | 'locked') => void;
  /** The notebook's recognised handwriting; null when recognition is off. */
  handwriting?: HandwritingIndex | null;
  /** Underline misspelt handwriting; null when spellcheck is off. */
  spell?: SpellChecker | null;
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

const noSubscribe = () => () => {};
const zeroVersion = () => 0;

// The formatted-text editor is large; it loads the first time something is edited.
const RichTextEditor = lazy(() => import('./RichTextEditor'));

/** The item with its formatting set, or without a `rich` field when it has none. */
function withRich<T extends EditableItem>(it: T, rich: RichBlock[] | undefined): T {
  const { rich: _old, ...rest } = it;
  return (rich ? { ...rest, rich } : rest) as T;
}

const HOLD_MS = 550;
/** Side of a tile of a large page, in CSS px. */
const TILE = 512;
/** How near (screen px) an end must be to an item's edge to attach to it. */
const ATTACH_SLOP_PX = 14;
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
      /** Shape and line items touched; they are erased whole in either mode. */
      shapeHits: Set<string> | null;
      /** Ids of the content on the active layer the eraser may touch. */
      erasable: ReadonlySet<string>;
      cursor: Vec;
      last: Vec;
    }
  /** `path` is the raw pointer path; the enclosed area depends on the lasso shape. */
  | { kind: 'lasso'; pointerId: number; path: Vec[] }
  | { kind: 'laser'; pointerId: number; cursor: Vec }
  | { kind: 'tape'; pointerId: number; start: Vec; cur: Vec };

export function PageView({ page, zoom, store, tool, penOnly, gesture, selection, setSelection, selectionColors, stickyColors, rulerEdges, zoomTarget, setZoomTarget, onSaveElement, onScreenshot, onCopy, onAddToOutline, onFollowLink, onEditLink, readOnly, onLaser, onSample, revealed, onToggleTape, onScribbleErase, playback, onSeekInk, highlights, onLayerBlocked, handwriting = null, spell = null }: Props) {
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
  // Snapping while a selection is dragged: what it can line up with (found once per drag), and the guides showing.
  const snapRef = useRef<SnapTargets | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  // Cropping a photo: the photo is hidden on the canvas while the crop overlay shows all of it.
  const [cropping, setCroppingState] = useState<ImageItem | null>(null);
  // A captured screenshot region waiting for the person to choose what to do with it.
  const [shot, setShot] = useState<Rect | null>(null);
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
  const editorApi = useRef<RichEditorHandle | null>(null);
  const [resize, setResize] = useState<{ pointerId: number; sx: number; sy: number; item: PageItem; preview: PageItem } | null>(null);
  const visibleRef = useRef(false);
  // Dragging a selected line's end or bend handle.
  const [lineEdit, setLineEdit] = useState<{ pointerId: number; handle: 0 | 1 | 'bend'; item: LineItem; preview: LineItem } | null>(null);
  // Smart Ink: dragging a side handle to rewrap selected handwriting, and the insert-space mode.
  const [reflowing, setReflowing] = useState<{ pointerId: number; side: 'w' | 'e'; from: { left: number; right: number }; left: number; right: number; moves: InkMove[] } | null>(null);
  const [spacing, setSpacing] = useState(false);
  // Convert to text: the dialog is open for the selection.
  const [converting, setConverting] = useState(false);
  // Spellcheck: the underlined word whose suggestions are showing.
  const [fixing, setFixing] = useState<{ mark: Misspelling; suggestions: string[] } | null>(null);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const scale = zoom;
  const size = pageSize(page);
  const selected = selection?.pageId === page.id ? selection : null;
  const images = imageResolver(store.doc.id);
  // A whiteboard's page is far too big for one canvas: it is painted in tiles, and the live layer
  // covers only the part on screen. `view` is the part of the page (page units) the live layer covers.
  const tiled = isLargePage(size);
  const darkPaper = pagePaper(page) === 'dark';
  const viewRef = useRef({ x: 0, y: 0, w: size.w, h: size.h });
  if (!tiled) viewRef.current = { x: 0, y: 0, w: size.w, h: size.h };

  /** What tools can act on: the unlocked content of the page's active layer. */
  const working = () => workingContent(pageRef.current, store.activeLayer(pageRef.current.id));

  /** A client (screen) point in page units, through the live layer. Also returns page units per CSS px. */
  const clientToPage = (cx: number, cy: number): Vec & { k: number } => {
    const r = liveRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    const k = v.w / (r.width || 1);
    return { x: v.x + (cx - r.left) * k, y: v.y + (cy - r.top) * k, k };
  };

  // --- Virtualisation: only pages near the viewport own a full-res canvas. ---
  useEffect(() => {
    const el = wrapRef.current!;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '100% 100%' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const paintOptions = () => ({
    hidden: hidden.current ?? undefined,
    replace: replaced.current ?? undefined,
    items: { images: animatedResolver(store.doc.id, images, performance.now()), hidden: hiddenItems.current ?? undefined, override: itemOverride.current ?? undefined, revealed },
    pdf: pdfResolver(store.doc.id),
    fade: playbackRef.current ? (s: Stroke) => playbackState(s, playbackRef.current!.rec, playbackRef.current!.t) === 'ahead' : undefined,
  });

  // --- Tiles (large pages) ---------------------------------------------------------------
  const tilesRef = useRef<HTMLDivElement>(null);
  /** Tile canvases by "col,row", each with the content version it was painted at. */
  const tiles = useRef(new Map<string, { canvas: HTMLCanvasElement; painted: number }>());
  const tileVersion = useRef(0);
  const tileZoom = useRef(zoom);

  /** The part of the page on screen, in CSS px from its top-left corner (null when none of it is). */
  const onScreen = (): { x0: number; y0: number; x1: number; y1: number } | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    const port = wrap.closest('.scroller')?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const x0 = Math.max(0, port.left - r.left), y0 = Math.max(0, port.top - r.top);
    const x1 = Math.min(r.width, port.right - r.left), y1 = Math.min(r.height, port.bottom - r.top);
    return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
  };

  /** Paint the tiles on screen that are missing or out of date, drop far-off ones, and move the live layer over what is visible. */
  const syncTiles = () => {
    const host = tilesRef.current;
    const live = liveRef.current;
    if (!host || !live) return;
    if (tileZoom.current !== scale) {
      // Tiles are a fixed CSS size, so a new zoom means a new grid.
      tileZoom.current = scale;
      for (const t of tiles.current.values()) t.canvas.remove();
      tiles.current.clear();
    }
    const vis = visibleRef.current ? onScreen() : null;
    const want = new Set<string>();
    if (vis) {
      const cssW = size.w * scale, cssH = size.h * scale;
      const c0 = Math.max(0, Math.floor(vis.x0 / TILE) - 1), c1 = Math.min(Math.ceil(cssW / TILE) - 1, Math.floor(vis.x1 / TILE) + 1);
      const r0 = Math.max(0, Math.floor(vis.y0 / TILE) - 1), r1 = Math.min(Math.ceil(cssH / TILE) - 1, Math.floor(vis.y1 / TILE) + 1);
      const opts = paintOptions();
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const key = `${col},${row}`;
          want.add(key);
          let t = tiles.current.get(key);
          if (!t) {
            const canvas = document.createElement('canvas');
            canvas.className = 'page-tile';
            const w = Math.min(TILE, cssW - col * TILE), h = Math.min(TILE, cssH - row * TILE);
            Object.assign(canvas.style, { left: `${col * TILE}px`, top: `${row * TILE}px`, width: `${w}px`, height: `${h}px` });
            host.appendChild(canvas);
            t = { canvas, painted: -1 };
            tiles.current.set(key, t);
          }
          if (t.painted !== tileVersion.current) {
            const w = parseFloat(t.canvas.style.width), h = parseFloat(t.canvas.style.height);
            const rect = { x: (col * TILE) / scale, y: (row * TILE) / scale, w: w / scale, h: h / scale };
            paintRegion(t.canvas, pageRef.current, rect, w, h, dpr, { ...opts, region: { minX: rect.x, minY: rect.y, maxX: rect.x + rect.w, maxY: rect.y + rect.h } });
            t.painted = tileVersion.current;
          }
        }
      }
      // The live layer covers what is on screen, unless a stroke is in progress on it.
      if (!active.current && !dragRef.current) {
        const v = { x: vis.x0 / scale, y: vis.y0 / scale, w: (vis.x1 - vis.x0) / scale, h: (vis.y1 - vis.y0) / scale };
        viewRef.current = v;
        Object.assign(live.style, { left: `${vis.x0}px`, top: `${vis.y0}px`, width: `${vis.x1 - vis.x0}px`, height: `${vis.y1 - vis.y0}px` });
      }
    }
    for (const [key, t] of tiles.current) {
      if (want.has(key)) continue;
      t.canvas.remove();
      tiles.current.delete(key);
    }
  };

  /** The tile canvas under a client point. */
  const tileAt = (cx: number, cy: number): HTMLCanvasElement | null => {
    for (const t of tiles.current.values()) {
      const r = t.canvas.getBoundingClientRect();
      if (cx >= r.left && cx < r.right && cy >= r.top && cy < r.bottom) return t.canvas;
    }
    return null;
  };

  // Scrolling a tiled page paints the tiles that come into view (once per frame).
  useEffect(() => {
    if (!tiled || !visible) return;
    let frame = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), syncTiles()));
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiled, visible, zoom, dpr]);

  const renderBase = () => {
    if (tiled) {
      tileVersion.current++;
      syncTiles();
      return;
    }
    const canvas = baseRef.current;
    if (!canvas) return;
    paintPage(canvas, pageRef.current, scale, dpr, paintOptions());
    if (clearLiveOnNextBase.current) {
      clearLiveOnNextBase.current = false;
      clearLive();
    }
  };

  // Animated GIFs: find out which photos are, then repaint whenever one of them moves to a new frame.
  // Off-screen pages don't animate, and nothing does for people who ask for reduced motion.
  const imageBlobs = page.items.flatMap((it) => (it.kind === 'image' ? [it.blobId] : [])).join(' ');
  useEffect(() => {
    if (!visible || !imageBlobs) return;
    const docId = store.doc.id;
    const ids = imageBlobs.split(' ');
    for (const id of ids) ensureGif(docId, id);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let last = '';
    let timer = 0;
    const tick = () => {
      const now = performance.now();
      const shown = ids.map((id) => gifFrameIndex(docId, id, now)).join(',');
      if (ids.some((id) => isAnimated(docId, id)) && shown !== last) {
        last = shown;
        renderBase();
      }
      if (ids.every((id) => isStatic(docId, id))) return; // nothing here moves
      timer = window.setTimeout(tick, 20);
    };
    tick();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, imageBlobs, store, zoom, dpr]);

  // Re-render committed layer on content change immediately, on zoom change debounced
  // (the CSS-stretched old bitmap covers the gap, like a tile cache would).
  const lastZoom = useRef(zoom);
  visibleRef.current = visible;
  // Repaint once images this page shows have been decoded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onImagesLoaded(() => visibleRef.current && renderBase()), [zoom, dpr]);
  useLayoutEffect(() => {
    if (tiled) {
      // Off screen, `syncTiles` drops every tile; on screen it paints what is missing.
      renderBase();
      return;
    }
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
    const v = viewRef.current;
    const w = Math.round(v.w * scale * dpr);
    const h = Math.round(v.h * scale * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(w / v.w, 0, 0, h / v.h, (-v.x * w) / v.w, (-v.y * h) / v.h);
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
      // On dark paper, ink shows as it will once committed (see paintStroke).
      ctx.fillStyle = darkPaper && a.stroke.tool !== 'highlighter' ? forDarkPaper(a.stroke.color) : a.stroke.color;
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
    } else if (a.kind === 'lasso' && a.path.length > 1) {
      const poly = lassoPolygon(tool.lassoShape, a.path);
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (const p of poly) ctx.lineTo(p.x, p.y);
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

  /** Item previews plus the connectors attached to them, re-routed to follow. */
  const withFollowers = (moved: Map<string, PageItem>): Map<string, PageItem> => {
    const items = pageRef.current.items.map((it) => moved.get(it.id) ?? it);
    for (const [id, line] of followConnectors(items)) if (!moved.has(id)) moved.set(id, line);
    return moved;
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
      itemOverride.current = m ? withFollowers(new Map(pageRef.current.items.filter((it) => ids.has(it.id)).map((it) => [it.id, transformItem(it, m)]))) : null;
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
    // Until the editor has loaded nothing can have been typed, so the item keeps its text.
    const { text, rich } = richPatch(editorApi.current?.getBlocks() ?? itemBlocks(ed.item));
    const cur = pageRef.current;
    const it = ed.item;
    const changed = text !== it.text || JSON.stringify(rich) !== JSON.stringify(it.rich);
    let ops: DocOp[] = [];
    if (it.kind === 'text') {
      const h = textHeight({ ...it, text, rich }, measureFor(it));
      if (!text.trim()) {
        const op = !ed.isNew && removeItemsOp(cur, [it.id]);
        if (op) ops = [op];
      } else if (ed.isNew) {
        ops = [{ type: 'items.added', pageId: cur.id, items: [withRich({ ...it, text, h }, rich)] }];
      } else if (changed) {
        const op = updateItemOp(cur, it.id, { text, rich, h });
        if (op) ops = [op];
      }
    } else if (ed.isNew) {
      ops = [{ type: 'items.added', pageId: cur.id, items: [withRich({ ...it, text }, rich)] }];
    } else if (changed) {
      const op = updateItemOp(cur, it.id, { text, rich });
      if (op) ops = [op];
    }
    editingRef.current = null;
    hiddenItems.current = null;
    setEditingState(null);
    if (ops.length) store.dispatch(ops);
    else renderBase();
  };

  /** Text and Sticky tools: tap an item of that kind to edit it, or empty paper to add one. */
  const tapItemTool = (pt: Vec) => {
    if (tool.kind === 'text') {
      const hit = itemAt(working(), pt, ['text']);
      setEditing(hit ? { item: hit as TextItem, isNew: false } : { item: newText(pt, tool.text, size), isNew: true });
    } else {
      const hit = itemAt(working(), pt, ['sticky']) as StickyItem | null;
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
    const { x, y } = clientToPage(e.clientX, e.clientY);
    return {
      x,
      y,
      // Mouse reports 0.5 while pressed; finger often 0 or 1 — both are synthesised later.
      p: pressureOf(e, pointerType),
      ...timeStamp(),
    };
  };

  /** The ruler edge beside page point `pt`, mapped into page space, if the ruler is out. */
  const rulerEdgeAt = (pt: Vec): Edge | null => {
    const edges = rulerEdges?.();
    if (!edges || !liveRef.current) return null;
    const { k } = clientToPage(0, 0);
    const toPagePt = (v: Vec) => {
      const p = clientToPage(v.x, v.y);
      return { x: p.x, y: p.y };
    };
    return edgeNear(pt, edges.map((e) => mapEdge(e, toPagePt, k)), RULER_REACH_PX * k);
  };

  const ignoreTouch = (e: React.PointerEvent) =>
    e.pointerType === 'touch' && (penOnly || gesture.current.active || gesture.current.touches.size > 1);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (onSample) {
      // Read the drawn page (paper, PDF, photos, ink) at this point.
      e.preventDefault();
      // On a tiled page, read the tile under the press.
      const base = tiled ? tileAt(e.clientX, e.clientY) : baseRef.current;
      const r = base?.getBoundingClientRect();
      const ctx = base?.getContext('2d', { willReadFrequently: true });
      if (!base || !r || !ctx || !base.width) return;
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
    if (shot) setShot(null);
    const pt = toPage(e, e.pointerType);
    if (editingRef.current) {
      // Tapping away ends editing; with the Text or Sticky tool that tap does nothing else.
      commitEdit();
      if (tool.kind === 'text' || tool.kind === 'sticky') return;
    }
    // A press on a link follows it, and one on tape shows or covers what is under it, if it turns out
    // to be a tap, whatever the tool.
    const link = onFollowLink ? linkAt(visibleContent(pageRef.current), pt, 4 / scale) : null;
    const tape = !link && onToggleTape ? tapeAt(visibleContent(pageRef.current), pt) : null;
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
      const hit = strokeAtForSeek(visibleContent(pageRef.current).strokes, pt, 8 / scale);
      if (hit?.rec) {
        onSeekInk(hit.rec, seekTimeFor(hit));
        return;
      }
    }
    // Tools that add or remove content need a layer they can work on.
    if (tool.kind !== 'lasso' && tool.kind !== 'laser') {
      const layer = findLayer(pageRef.current, store.activeLayer(page.id));
      if (layer && (layer.hidden || layer.locked)) {
        // Links and tape still work; anything else is refused with a reason.
        linkTap.current = null;
        if (link) onFollowLink?.(link.target);
        else if (tape) onToggleTape?.(tape.id);
        else onLayerBlocked?.(layer.name, layer.hidden ? 'hidden' : 'locked');
        return;
      }
    }
    if (tool.kind === 'text' || tool.kind === 'sticky') {
      tapItemTool(pt);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (liveRef.current) liveRef.current.style.mixBlendMode = tool.kind === 'highlighter' ? (darkPaper ? 'screen' : 'multiply') : 'normal';

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
      const kinds = tool.eraseKinds;
      const work = working();
      const erasable = new Set([...work.strokes.map((s) => s.id), ...work.items.map((it) => it.id)]);
      active.current = {
        kind: 'erase',
        pointerId: e.pointerId,
        r: tool.eraserPx / scale,
        mode: tool.eraseMode,
        canErase: (s) => erasable.has(s.id) && kinds.includes(inkKind(s)),
        hits: new Set(),
        pieces: new Map(),
        shapeHits: kinds.includes('shapes') ? new Set() : null,
        erasable,
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
      active.current = { kind: 'lasso', pointerId: e.pointerId, path: [pt] };
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
    if (a.shapeHits) {
      for (const it of pageRef.current.items) {
        if ((it.kind !== 'shape' && it.kind !== 'line') || !a.erasable.has(it.id) || a.shapeHits.has(it.id)) continue;
        if (pts.some((p) => touchesCircle(it, p, a.r))) {
          a.shapeHits.add(it.id);
          hiddenItems.current = a.shapeHits;
          changed = true;
        }
      }
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
      a.path.push(...pts);
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
      if (a.kind === 'erase' && a.shapeHits?.size) hiddenItems.current = null;
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
        // Scribbling over ink with the pen rubs it out (one undo step) instead of adding the scribble.
        if (tool.kind === 'pen' && tool.scribbleErase && !a.snap && isScribble(a.stroke.points)) {
          const ids = scribbledStrokes(a.stroke.points, working().strokes);
          const op = ids.length ? removeStrokesOp(pageRef.current, ids) : null;
          if (op) {
            clearLiveOnNextBase.current = true;
            store.dispatch([op]);
            onScribbleErase?.(ids.length);
            return;
          }
        }
        // The Shapes tool also recognises on lift, without needing a hold.
        const shape = a.snap?.shape ?? (tool.kind === 'shapes' ? recognizeShape(a.stroke.points) : null);
        clearLiveOnNextBase.current = true;
        // A recognised shape becomes a shape item. Highlighter lines stay highlighter ink, and shapes
        // drawn during a recording stay ink so tapping them still plays the audio from there.
        if (shape && a.stroke.tool === 'pen' && a.stroke.points[0]?.t === undefined) {
          const fill = tool.kind === 'shapes' ? tool.shapeFill : null;
          let item = itemFromShape(shape, { color: a.stroke.color, width: a.stroke.width, dash: a.stroke.dash ?? 'solid', fill });
          // A line drawn from the edge of a shape (or to one) connects to it.
          if (item.kind === 'line') item = attachDrawnLine(visibleContent(pageRef.current), item, ATTACH_SLOP_PX / scale);
          store.dispatch([{ type: 'items.added', pageId: page.id, items: [item] }]);
          return;
        }
        store.dispatch([{ type: 'strokes.added', pageId: page.id, strokes: inkStrokes(a.stroke, shape) }]);
        return;
      }
    } else if (a.kind === 'erase') {
      hidden.current = null;
      replaced.current = null;
      if (a.shapeHits?.size) hiddenItems.current = null;
      let ops: DocOp[] = [];
      if (commit && a.mode === 'stroke') {
        const op = removeStrokesOp(pageRef.current, a.hits);
        if (op) ops = [op];
      } else if (commit) {
        ops = replaceStrokesOps(pageRef.current, a.pieces);
      }
      const itemOp = commit && a.shapeHits?.size ? removeItemsOp(pageRef.current, a.shapeHits) : null;
      if (itemOp) ops.push(itemOp);
      if (ops.length) store.dispatch(ops);
      else renderBase();
    } else if (a.kind === 'laser') {
      onLaser?.(page.id, [], null);
      scheduleLive(); // let the trail fade out instead of clearing it
      return;
    } else if (a.kind === 'lasso' && commit && tool.lassoShape === 'screenshot') {
      setShot(screenshotRect(a.path[0], a.path[a.path.length - 1], size));
    } else if (a.kind === 'lasso' && commit) {
      // A tap (rather than a loop) selects the item under it.
      const p = working();
      if (pointsLength(a.path as InputPoint[]) * scale < 8) {
        const hit = itemAt({ ...p, items: p.items.filter((it) => lassoAllowsItem(tool.lassoKinds, it)) }, a.path[0]);
        setSelection(hit ? { pageId: page.id, strokeIds: [], itemIds: [hit.id] } : null);
      } else {
        setSelection(selectWithLasso(p, lassoPolygon(tool.lassoShape, a.path), tool.lassoKinds));
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
    const link = linkAt(visibleContent(pageRef.current), tap.pt, 4 / scale);
    if (link) return onFollowLink?.(link.target);
    const tape = tapeAt(visibleContent(pageRef.current), tap.pt);
    if (tape) return onToggleTape?.(tape.id);
    if (onSeekInk) {
      const hit = strokeAtForSeek(visibleContent(pageRef.current).strokes, tap.pt, 8 / scale);
      if (hit?.rec) onSeekInk(hit.rec, seekTimeFor(hit));
    }
  };

  // --- Selection (lasso result) -------------------------------------------------
  const selStrokes = selected ? selectedStrokes(page, selected) : [];
  // While resizing, the box follows the preview rather than the stored item.
  const previewed = resize ? resize.preview : lineEdit ? lineEdit.preview : null;
  const shownPage = previewed ? { ...page, items: page.items.map((it) => (it.id === previewed.id ? previewed : it)) } : page;
  const selBounds = selected && !editing && !cropping && selectionBounds(shownPage, selected);
  const soleItem = selected && !selected.strokeIds.length && selected.itemIds.length === 1 ? (page.items.find((it) => it.id === selected.itemIds[0]) ?? null) : null;
  // A turned item resizes with the corner handles (uniformly, about a corner) rather than its own handle.
  const soleTurned = !!soleItem && !!itemRotation(soleItem);

  const startCrop = (it: ImageItem) => {
    hiddenItems.current = new Set([it.id]);
    setCroppingState(it);
    renderBase();
  };
  const endCrop = (crop: CropRect | null) => {
    const it = cropping;
    hiddenItems.current = null;
    setCroppingState(null);
    const op = it && crop ? updateItemOp(pageRef.current, it.id, cropPatch(it, crop)) : null;
    if (op) store.dispatch([op]);
    else renderBase();
  };
  const flipSoleImage = (axis: 'h' | 'v') => {
    if (soleItem?.kind !== 'image') return;
    const op = updateItemOp(page, soleItem.id, flipPatch(soleItem, axis));
    if (op) store.dispatch([op]);
  };

  /** CSS to turn an item's text editor with the item, about the item's centre. */
  const turnStyle = (it: PageItem): React.CSSProperties => {
    const theta = itemRotation(it);
    return theta ? { transform: `rotate(${theta}rad)`, transformOrigin: `${(it.w * scale) / 2}px ${(it.h * scale) / 2}px` } : {};
  };

  const selTexts = selected ? page.items.filter((it): it is TextItem => it.kind === 'text' && selected.itemIds.includes(it.id)) : [];
  const selShapes = selected ? page.items.filter((it): it is ShapeItem | LineItem => (it.kind === 'shape' || it.kind === 'line') && selected.itemIds.includes(it.id)) : [];

  // --- Resize and rotate handles (lasso selections) ----------------------------------
  const pagePoint = (e: { clientX: number; clientY: number }): Vec => {
    const { x, y } = clientToPage(e.clientX, e.clientY);
    return { x, y };
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

  // --- Smart Ink: rewrap, insert space, straighten and align selected handwriting ---------------
  // Only a selection of nothing but writing (every stroke on a line of words) can be rearranged.
  const inkLayout = useMemo(
    () => (selected && !selected.itemIds.length && selected.strokeIds.length && !readOnly ? smartInkLayout(selectedStrokes(page, selected)) : null),
    [page, selected, readOnly],
  );
  const inkEdges = () => ({ left: Math.min(...inkLayout!.lines.map((l) => l.box.minX)), right: Math.max(...inkLayout!.lines.map((l) => l.box.maxX)) });

  /** Draw the selected strokes moved (in place, on their own layer), or as they are when `moves` is null. */
  const previewInk = (moves: InkMove[] | null) => {
    replaced.current = moves ? new Map(movedStrokes(selStrokes, moves).map((s) => [s.id, [s]])) : null;
    renderBase();
  };

  const commitInk = (moves: InkMove[]) => {
    const ops = moveOps(page, moves);
    replaced.current = null;
    if (ops.length) store.dispatch(ops);
    else renderBase();
  };

  const onReflowDown = (side: 'w' | 'e') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!inkLayout) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const from = inkEdges();
    setReflowing({ pointerId: e.pointerId, side, from, ...from, moves: [] });
  };
  const onReflowMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!reflowing || e.pointerId !== reflowing.pointerId || !inkLayout) return;
    const x = pagePoint(e).x;
    const min = minReflowWidth(inkLayout.paragraphs);
    let { left, right } = reflowing.from;
    if (reflowing.side === 'e') right = Math.max(left + min, Math.min(size.w, x));
    else left = Math.min(right - min, Math.max(0, x));
    const moves = reflow(inkLayout.paragraphs, left, right - left);
    setReflowing({ ...reflowing, left, right, moves });
    previewInk(moves);
  };
  const onReflowUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!reflowing || e.pointerId !== reflowing.pointerId) return;
    setReflowing(null);
    const changed = Math.abs(reflowing.left - reflowing.from.left) > 1 || Math.abs(reflowing.right - reflowing.from.right) > 1;
    commitInk(changed ? reflowing.moves : []);
  };

  const straightenSelection = () => inkLayout && commitInk(straighten(inkLayout.lines));
  const alignSelection = (how: Align) => {
    if (!inkLayout) return;
    const { left, right } = inkEdges();
    commitInk(alignInk(inkLayout.lines, how, left, right));
  };
  /** Insert space mode: a tap opens a gap before the next word, pushing the rest of the line along. */
  const insertSpaceAt = (pt: Vec) => {
    if (!inkLayout) return;
    const { left, right } = inkEdges();
    // A single line may grow to the page edge; several lines keep their width.
    const edge = inkLayout.lines.length === 1 ? Math.max(right, size.w - 24) : right;
    const letters = inkLayout.lines.map((l) => l.letter).sort((a, b) => a - b);
    const moves = insertSpace(inkLayout.paragraphs, pt, 1.5 * letters[letters.length >> 1], left, edge);
    if (moves?.length) commitInk(moves);
  };

  /** Swap ink for a text box over where it was, in the ink's colour and a matching size: one undo step. */
  const inkToText = (strokeIds: string[], box: Bounds, size: number, mid: number, text: string, fitWidth: boolean): TextItem | null => {
    const strokes = page.strokes.filter((s) => strokeIds.includes(s.id));
    const remove = removeStrokesOp(page, strokeIds);
    if (!remove || !text) return null;
    let item = textOverInk(box, text, size, inkColour(strokes), mid);
    const measure = measureFor(item);
    // A single corrected word is as wide as it needs; converted lines keep the ink's width.
    if (fitWidth) item = { ...item, w: Math.ceil(measure(text)) + 2 * TEXT_PAD + 2 };
    item = { ...item, h: textHeight(item, measure) };
    store.dispatch([remove, { type: 'items.added', pageId: page.id, items: [item] }]);
    return item;
  };

  const replaceSelectionWithText = (text: string) => {
    setConverting(false);
    if (!inkLayout || !selected) return;
    const lines = inkLayout.lines;
    const box = { minX: Math.min(...lines.map((l) => l.box.minX)), minY: Math.min(...lines.map((l) => l.box.minY)), maxX: Math.max(...lines.map((l) => l.box.maxX)), maxY: Math.max(...lines.map((l) => l.box.maxY)) };
    const sizes = lines.map(textSizeFor).sort((a, b) => a - b);
    const first = lines.reduce((a, b) => (b.box.minY < a.box.minY ? b : a));
    const item = inkToText(selected.strokeIds, box, sizes[sizes.length >> 1], (first.box.minY + first.box.maxY) / 2, text, false);
    if (item) setSelection({ pageId: page.id, strokeIds: [], itemIds: [item.id] });
  };

  // --- Spellcheck: underline handwritten words the dictionary doesn't know ------------------------
  const inkVersion = useSyncExternalStore(handwriting?.subscribe ?? noSubscribe, handwriting?.getVersion ?? zeroVersion);
  const misspelt = useMemo(
    () => (handwriting && spell && !readOnly ? findMisspellings(pageLines(page), handwriting.textOf, spell.correct) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, handwriting, inkVersion, spell, readOnly],
  );
  // Not over writing that is selected (it may be moving).
  const marks = selected ? misspelt.filter((m) => !m.strokeIds.some((id) => selected.strokeIds.includes(id))) : misspelt;
  const sameMark = (a: Misspelling, b: Misspelling) => a.strokeIds.join() === b.strokeIds.join();
  const shownFix = fixing && marks.some((m) => sameMark(m, fixing.mark)) ? fixing : null;
  const fixWord = (suggestion: string) => {
    if (!shownFix) return;
    const { mark } = shownFix;
    setFixing(null);
    inkToText(mark.strokeIds, mark.box, mark.size, mark.mid, replacementFor(mark.token, suggestion), true);
  };

  // A new selection (or none) ends insert-space mode and drops a rewrap in progress.
  useEffect(() => {
    setSpacing(false);
    setReflowing((r) => {
      if (r) {
        replaced.current = null;
        renderBase();
      }
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

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
    setLineEdit(null);
    renderBase();
    clearLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const onSelDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (spacing) {
      insertSpaceAt(pagePoint(e));
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    hidden.current = new Set(selected?.strokeIds ?? []);
    renderBase();
    if (liveRef.current) liveRef.current.style.mixBlendMode = 'normal';
    snapRef.current = tool.snap && selected ? snapTargets(visibleContent(page), selected) : null;
    setDrag({ pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 });
  };
  const onSelMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    let dx = (e.clientX - drag.sx) / scale;
    let dy = (e.clientY - drag.sy) / scale;
    if (snapRef.current && selBounds) {
      const snapped = snapMove(selBounds, dx, dy, snapRef.current, 6 / scale, size);
      ({ dx, dy } = snapped);
      setGuides(snapped.guides);
    }
    setDrag({ ...drag, dx, dy });
  };
  const onSelUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    hidden.current = null;
    snapRef.current = null;
    setGuides([]);
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
  const lockSelection = () => {
    if (!selected) return;
    store.dispatch(lockSelectionOps(page, selected));
    setSelection(null);
  };
  const arrangeSelection = (where: Arrange) => {
    if (!selected) return;
    const ops = arrangeSelectionOps(page, selected, where);
    if (ops.length) store.dispatch(ops);
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
    for (const t of [...selTexts, ...selShapes]) {
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

  // --- Selection menu contents ------------------------------------------------------------
  const moreActions: MenuAction[] = [];
  if (soleItem?.kind === 'image') {
    moreActions.push({ label: 'Flip horizontally', onClick: () => flipSoleImage('h') }, { label: 'Flip vertically', onClick: () => flipSoleImage('v') });
  }
  if (selected) {
    moreActions.push(
      { label: 'Bring to front', onClick: () => arrangeSelection('front') },
      { label: 'Send to back', onClick: () => arrangeSelection('back') },
      { label: 'Lock', onClick: lockSelection, title: "Lock: the eraser and lasso pass over it. Unlock from the Lasso tool's options." },
    );
    if (onEditLink) moreActions.push({ label: soleItem?.kind === 'link' ? 'Edit link' : 'Add link…', onClick: () => onEditLink(selected, soleItem?.kind === 'link' ? soleItem : null) });
    if (onAddToOutline) moreActions.push({ label: 'Add to outline', onClick: () => onAddToOutline(selected) });
    if (onSaveElement) moreActions.push({ label: 'Save as element', onClick: () => onSaveElement(selected) });
  }
  if (inkLayout) {
    moreActions.unshift(
      { label: 'Convert to text…', onClick: () => setConverting(true), title: 'Read the writing and turn it into a text box' },
      { label: 'Insert space', onClick: () => setSpacing(true), title: 'Tap between words to make room' },
      { label: 'Straighten', onClick: straightenSelection, title: 'Level sloping lines' },
      { label: 'Align left', onClick: () => alignSelection('left') },
      { label: 'Align centre', onClick: () => alignSelection('centre') },
      { label: 'Align right', onClick: () => alignSelection('right') },
    );
  }

  const styleRow =
    soleItem?.kind === 'text' ? (
      <>
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
        <span className="divider" />
        {selectionColors.map((c) => (
          <button key={c} className={`swatch-btn ${soleItem.color === c ? 'active' : ''}`} aria-label={`Recolor ${c}`} onClick={() => recolorSelection(c)}>
            <span className="swatch" style={{ background: c }} />
          </button>
        ))}
      </>
    ) : soleItem?.kind === 'sticky' ? (
      <>
        <button onClick={() => patchSoleItem({ collapsed: !soleItem.collapsed })}>{soleItem.collapsed ? 'Expand' : 'Collapse'}</button>
        {stickyColors.map((c) => (
          <button key={c} className={`swatch-btn ${soleItem.color === c ? 'active' : ''}`} aria-label={`Note colour ${c}`} onClick={() => patchSoleItem({ color: c })}>
            <span className="swatch" style={{ background: c }} />
          </button>
        ))}
      </>
    ) : soleItem?.kind === 'shape' || soleItem?.kind === 'line' ? (
      <ShapeStyleRow item={soleItem} colors={selectionColors} onRecolor={recolorSelection} onPatch={patchSoleItem} />
    ) : selStrokes.length > 0 || selTexts.length > 0 || selShapes.length > 0 ? (
      selectionColors.map((c) => (
        <button key={c} className="swatch-btn" aria-label={`Recolor ${c}`} onClick={() => recolorSelection(c)}>
          <span className="swatch" style={{ background: c }} />
        </button>
      ))
    ) : null;

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
    itemOverride.current = withFollowers(new Map([[item.id, preview]]));
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

  // --- Line handles: drag an end (attaching it to what it is dropped on) or the bend ------------
  const onLineDown = (handle: 0 | 1 | 'bend') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (soleItem?.kind !== 'line') return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setLineEdit({ pointerId: e.pointerId, handle, item: soleItem, preview: soleItem });
  };
  const onLineMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lineEdit || e.pointerId !== lineEdit.pointerId) return;
    const { item, handle } = lineEdit;
    const p = pagePoint(e);
    let preview: LineItem;
    if (handle === 'bend') {
      preview = { ...item, ...bendTo(item, p) };
    } else {
      const key = handle === 0 ? 'from' : 'to';
      const other = handle === 0 ? item.to : item.from;
      let att = attachmentAt(visibleContent(pageRef.current), p, ATTACH_SLOP_PX / scale, new Set([item.id]));
      if (att && att.id === other?.id) att = null; // not both ends on one item
      const target = att && pageRef.current.items.find((it) => it.id === att!.id);
      const ends = lineEnds(item);
      ends[handle] = att && target ? anchorPoint(target, att.at) : p;
      const { [key]: _old, ...rest } = item;
      preview = { ...rest, ...lineGeometry(ends[0], ends[1]), ...(att ? { [key]: att } : {}) } as LineItem;
    }
    itemOverride.current = new Map([[item.id, preview]]);
    renderBase();
    setLineEdit({ ...lineEdit, preview });
  };
  const onLineUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lineEdit || e.pointerId !== lineEdit.pointerId) return;
    const { item, preview, handle } = lineEdit;
    itemOverride.current = null;
    setLineEdit(null);
    const patch =
      handle === 'bend'
        ? { route: preview.route, bend: preview.bend }
        : { x: preview.x, y: preview.y, w: preview.w, h: preview.h, ends: preview.ends, [handle === 0 ? 'from' : 'to']: handle === 0 ? preview.from : preview.to };
    const changed = JSON.stringify(preview) !== JSON.stringify(item);
    const op = changed ? updateItemOp(page, item.id, patch) : null;
    if (op) store.dispatch([op]);
    else renderBase();
  };
  const shownLine = soleItem?.kind === 'line' ? (lineEdit?.preview ?? soleItem) : null;

  // --- Quick diagramming: a dot on each side of a lone selected shape adds a connected copy there ---
  const quickDots = soleItem?.kind === 'shape' && !drag && !xform && !resize ? soleItem : null;
  const quickConnect = (side: Side) => {
    if (!soleItem) return;
    const made = quickConnectOps(page, soleItem.id, side, size);
    if (!made) return;
    store.dispatch(made.ops);
    setSelection({ pageId: page.id, strokeIds: [], itemIds: [made.copyId] });
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
      {tiled ? <div ref={tilesRef} className="page-tiles" /> : <canvas ref={baseRef} className="page-layer" />}
      <canvas
        ref={liveRef}
        className={`page-layer live ${tiled ? 'windowed' : ''} ${onSample ? 'sampling' : readOnly ? 'read-only' : `tool-${tool.kind}`}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => (readOnly ? readOnlyTap(e.pointerId) : finish(true))}
        onPointerCancel={cancel}
        onLostPointerCapture={(e) => active.current?.pointerId === e.pointerId && finish(true)}
      />
      {drag &&
        guides.map((g) => (
          <div
            key={`${g.axis}${g.at}`}
            className={`snap-guide ${g.axis}`}
            style={
              g.axis === 'x'
                ? { left: g.at * scale, top: g.from * scale, height: (g.to - g.from) * scale }
                : { top: g.at * scale, left: g.from * scale, width: (g.to - g.from) * scale }
            }
          />
        ))}
      {shot && (
        <>
          <div className="shot-box" style={{ left: shot.x * scale, top: shot.y * scale, width: shot.w * scale, height: shot.h * scale }} />
          <div
            className="selection-menu"
            data-no-gesture
            style={{ left: shot.x * scale, top: shot.y * scale >= 56 ? shot.y * scale - 52 : (shot.y + shot.h) * scale + 12 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {(['insert', 'copy', 'save'] as const).map((action) => (
              <button
                key={action}
                onClick={() => {
                  onScreenshot?.(page.id, shot, action);
                  setShot(null);
                }}
              >
                {action === 'insert' ? 'Add as photo' : action === 'copy' ? 'Copy' : 'Save PNG'}
              </button>
            ))}
            <button onClick={() => setShot(null)}>Cancel</button>
          </div>
        </>
      )}
      {cropping && <CropOverlay item={cropping} scale={scale} image={images(cropping.blobId)} onDone={endCrop} onCancel={() => endCrop(null)} />}
      {selBounds && (
        <>
          <div
            className={`selection-box ${spacing ? 'spacing' : ''}`}
            data-no-gesture
            style={(() => {
              // Moving and scaling show the transformed box; rotating turns the original box;
              // rewrapping shows the new width over the rewrapped lines.
              const rewrapped = reflowing && unionBounds(movedStrokes(selStrokes, reflowing.moves));
              const b = rewrapped
                ? { ...rewrapped, minX: reflowing.left, maxX: reflowing.right }
                : xform?.kind === 'scale'
                  ? transformBounds(selBounds, xform.m)
                  : selBounds;
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
            {soleItem && !soleTurned && !drag && soleItem.kind !== 'line' && !(soleItem.kind === 'sticky' && soleItem.collapsed) && (
              <div
                className="resize-handle"
                aria-label="Resize"
                onPointerDown={onResizeDown}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeUp}
                onPointerCancel={onResizeUp}
              />
            )}
            {inkLayout && !drag && !xform && !spacing &&
              (['w', 'e'] as const).map((side) => (
                <div
                  key={side}
                  className={`reflow-handle ${side}`}
                  role="slider"
                  aria-label={side === 'w' ? 'Rewrap from the left' : 'Rewrap from the right'}
                  aria-valuenow={Math.round((reflowing?.right ?? selBounds.maxX) - (reflowing?.left ?? selBounds.minX))}
                  title="Drag to rewrap the writing"
                  onPointerDown={onReflowDown(side)}
                  onPointerMove={onReflowMove}
                  onPointerUp={onReflowUp}
                  onPointerCancel={onReflowUp}
                />
              ))}
            {(!soleItem || soleTurned) && !drag && !reflowing && !spacing && (!xform || xform.kind === 'scale') &&
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
            {!drag && !reflowing && !spacing && selected && (soleItem ? canRotate(soleItem) : true) && (!xform || xform.kind === 'rotate') && (
              <div
                // A lone shape's rotate handle sits at its corner, clear of the quick-diagram dot above it.
                className={`rotate-handle ${quickDots ? 'corner' : ''}`}
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
          {quickDots &&
            SIDES.map((side) => {
              const a = anchorPoint(quickDots, SIDE_AT[side]);
              const c = { x: quickDots.x + quickDots.w / 2, y: quickDots.y + quickDots.h / 2 };
              const d = Math.hypot(a.x - c.x, a.y - c.y) || 1;
              const out = 22; // screen px beyond the edge
              return (
                <button
                  key={side}
                  className="quick-dot"
                  data-no-gesture
                  aria-label={`Add a connected shape ${{ n: 'above', e: 'to the right', s: 'below', w: 'to the left' }[side]}`}
                  title="Add a connected shape"
                  style={{ left: a.x * scale + ((a.x - c.x) / d) * out, top: a.y * scale + ((a.y - c.y) / d) * out }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => quickConnect(side)}
                />
              );
            })}
          {shownLine && !drag && !xform && (
            <>
              {[...lineEnds(shownLine).map((p, i) => ({ p, handle: i as 0 | 1 })), { p: bendHandle(shownLine), handle: 'bend' as const }].map(({ p, handle }) => (
                <div
                  key={handle}
                  className={`line-handle ${handle === 'bend' ? 'bend' : ''} ${handle !== 'bend' && (handle === 0 ? shownLine.from : shownLine.to) ? 'attached' : ''}`}
                  data-no-gesture
                  role="button"
                  aria-label={handle === 'bend' ? 'Bend the line' : handle === 0 ? 'Move the start' : 'Move the end'}
                  style={{ left: p.x * scale, top: p.y * scale }}
                  onPointerDown={onLineDown(handle)}
                  onPointerMove={onLineMove}
                  onPointerUp={onLineUp}
                  onPointerCancel={onLineUp}
                />
              ))}
            </>
          )}
          {!drag && !resize && !xform && !lineEdit && !reflowing && spacing && (
            <SelectionMenu
              key="spacing"
              anchor={{ left: selBounds.minX * scale, top: selBounds.minY * scale, bottom: selBounds.maxY * scale }}
              clearance={12}
              pageW={cssW}
            >
              <span className="sel-hint">Tap between words to add space</span>
              <button onClick={() => setSpacing(false)}>Done</button>
            </SelectionMenu>
          )}
          {!drag && !resize && !xform && !lineEdit && !reflowing && !spacing && (
            <SelectionMenu
              key={selected ? `${selected.strokeIds.join()}|${selected.itemIds.join()}` : 'none'}
              anchor={{ left: selBounds.minX * scale, top: selBounds.minY * scale, bottom: selBounds.maxY * scale }}
              // Clear of the rotate handle when there is one.
              clearance={selected && (soleItem ? canRotate(soleItem) : true) ? 48 : 12}
              pageW={cssW}
              gapBelow={quickDots ? 40 : 16}
              more={moreActions}
              styleRow={styleRow}
            >
              {(soleItem?.kind === 'text' || (soleItem?.kind === 'sticky' && !soleItem.collapsed)) && <button onClick={editSoleItem}>Edit</button>}
              {soleItem?.kind === 'link' && onFollowLink && <button onClick={() => onFollowLink(soleItem.target)}>Open link</button>}
              {onCopy && selected && (
                <>
                  <button onClick={() => onCopy(selected, true)}>Cut</button>
                  <button onClick={() => onCopy(selected, false)}>Copy</button>
                </>
              )}
              <button onClick={duplicateSelection}>Duplicate</button>
              <button onClick={deleteSelection}>Delete</button>
              {soleItem?.kind === 'image' && <button onClick={() => startCrop(soleItem)}>Crop</button>}
            </SelectionMenu>
          )}
        </>
      )}
      {marks.map((m) => (
        <button
          key={m.strokeIds.join()}
          className={`spell-mark ${tool.kind === 'lasso' ? 'tappable' : ''}`}
          data-no-gesture
          aria-label={`Check spelling of “${m.word}”`}
          title="With the lasso, tap to fix"
          style={{ left: m.box.minX * scale, top: m.box.maxY * scale + 1, width: (m.box.maxX - m.box.minX) * scale }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => spell && setFixing({ mark: m, suggestions: spell.suggest(m.word).slice(0, 4) })}
        />
      ))}
      {shownFix && (
        <div
          className="selection-menu spell-pop"
          data-no-gesture
          role="menu"
          aria-label={`Spelling of “${shownFix.mark.word}”`}
          style={{ left: shownFix.mark.box.minX * scale, top: shownFix.mark.box.maxY * scale + 10 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {shownFix.suggestions.length ? (
            shownFix.suggestions.map((w) => (
              <button key={w} role="menuitem" onClick={() => fixWord(w)}>
                {replacementFor(shownFix.mark.token, w)}
              </button>
            ))
          ) : (
            <span className="sel-hint">No suggestions</span>
          )}
          <button
            role="menuitem"
            title="Stop marking this word"
            onClick={() => {
              addPersonalWord(shownFix.mark.word);
              setFixing(null);
            }}
          >
            Add to dictionary
          </button>
          <button role="menuitem" aria-label="Close" onClick={() => setFixing(null)}>
            ✕
          </button>
        </div>
      )}
      {converting && inkLayout && (
        <ConvertDialog paragraphs={inkLayout.paragraphs} strokes={selStrokes} handwriting={handwriting} onReplace={replaceSelectionWithText} onClose={() => setConverting(false)} />
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
        <Suspense fallback={null}>
          <RichTextEditor
            key={editing.item.id}
            blocks={itemBlocks(editing.item)}
            handle={editorApi}
            className={editing.item.kind}
            label={editing.item.kind === 'text' ? 'Text box' : 'Sticky note'}
            onDone={commitEdit}
            style={
              editing.item.kind === 'text'
                ? {
                    left: editing.item.x * scale,
                    top: editing.item.y * scale,
                    width: editing.item.w * scale,
                    minHeight: editing.item.h * scale,
                    padding: TEXT_PAD * scale,
                    font: `${editing.item.size * scale}px/${LINE_HEIGHT} ${fontFamily(editing.item.font)}`,
                    color: darkPaper ? forDarkPaper(editing.item.color) : editing.item.color,
                    ...turnStyle(editing.item),
                  }
                : {
                    left: editing.item.x * scale,
                    top: editing.item.y * scale,
                    width: editing.item.w * scale,
                    height: editing.item.h * scale,
                    padding: STICKY_PAD * scale,
                    font: `${STICKY_TEXT_SIZE * scale}px/${LINE_HEIGHT} ${fontFamily('sans')}`,
                    background: editing.item.color,
                    ...turnStyle(editing.item),
                  }
            }
          />
        </Suspense>
      )}
    </div>
  );
}
