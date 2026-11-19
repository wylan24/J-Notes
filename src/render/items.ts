import { forDarkPaper } from '../core/color';
import type { ImageItem, InputPoint, LineItem, LinkItem, PageItem, ShapeItem, StickyItem, Stroke, TapeItem, TextItem } from '../core/model';
import { lineStrokes, shapeOutline } from '../core/shapeItems';
import { linePoints } from '../core/shapes';
import { buildStrokePath } from './stroke';
import type { Vec } from '../core/geometry';
import { LINK_PAD, LINK_TEXT_SIZE } from '../core/links';
import { bulletShape, layoutRich, markerPlace, type RichLine } from '../core/richText';
import { fontFamily, richTextLines, LINE_HEIGHT, STICKY_ICON, STICKY_PAD, STICKY_TEXT_SIZE, TEXT_PAD, textLines, wrapLines, type MeasureText } from '../core/items';
import { getBlob } from '../storage/db';
import { cropOf, itemMatrix } from '../core/imageEdit';
import { isIdentity } from '../core/transform';

export type ImageResolver = (blobId: string) => CanvasImageSource | null;

// --- Decoded image cache --------------------------------------------------------
// Images are decoded once per notebook and blob, and kept for the session. Pages paint
// a placeholder until their images are ready, then repaint when notified.

interface Entry {
  img: HTMLImageElement | null;
  failed: boolean;
  loading: Promise<void> | null;
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const key = (docId: string, blobId: string) => `${docId}/${blobId}`;

export function onImagesLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tell painters that some image or PDF page they may be showing has become available. */
export function emitImagesLoaded(): void {
  listeners.forEach((l) => l());
}

export function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // The object URL stays alive for as long as the image is cached.
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read this image'));
    img.src = URL.createObjectURL(blob);
  });
}

/** Seed the cache with an image that was just decoded (e.g. on insert). */
export function primeImage(docId: string, blobId: string, img: HTMLImageElement): void {
  cache.set(key(docId, blobId), { img, failed: false, loading: null });
}

export function ensureImage(docId: string, blobId: string): Promise<void> {
  const k = key(docId, blobId);
  const cur = cache.get(k);
  if (cur?.img || cur?.failed) return Promise.resolve();
  if (cur?.loading) return cur.loading;
  const entry: Entry = { img: null, failed: false, loading: null };
  entry.loading = getBlob(docId, blobId)
    .then(async (b) => {
      if (!b) throw new Error('missing blob');
      entry.img = await decodeImage(new Blob([b.bytes], { type: b.type }));
    })
    .catch(() => {
      entry.failed = true;
    })
    .finally(() => {
      entry.loading = null;
      emitImagesLoaded();
    });
  cache.set(k, entry);
  return entry.loading;
}

/** Resolve images for one notebook, starting a load for any that aren't ready yet. */
export function imageResolver(docId: string): ImageResolver {
  return (blobId) => {
    const e = cache.get(key(docId, blobId));
    if (e?.img) return e.img;
    if (!e) void ensureImage(docId, blobId);
    return null;
  };
}

// --- Text measuring ---------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null;

export function canvasFont(font: string, size: number, bold = false, italic = false): string {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${fontFamily(font)}`;
}

/** A measureText for the given font, for layout that matches what the canvas draws. */
export function measurer(font: string, size: number): MeasureText {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  if (!ctx) return (s) => s.length * size * 0.55;
  return (s, bold, italic) => {
    ctx.font = canvasFont(font, size, bold, italic);
    return ctx.measureText(s).width;
  };
}

// --- Painting ----------------------------------------------------------------------

export interface ItemPaintOptions {
  images?: ImageResolver;
  hidden?: ReadonlySet<string>;
  /** Items to draw in place of the stored ones (a move or resize in progress). */
  override?: ReadonlyMap<string, PageItem>;
  /** Tape strips currently lifted to show what is under them. */
  revealed?: ReadonlySet<string>;
  /** On dark paper: dark text and shape outlines show lighter (on screen only). */
  dark?: boolean;
}

/** Pixel size of a loaded image, whatever kind of source it is. */
export function sourceSize(img: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight };
  const s = img as { width: number | { baseVal: { value: number } }; height: number | { baseVal: { value: number } } };
  const n = (v: number | { baseVal: { value: number } }) => (typeof v === 'number' ? v : v.baseVal.value);
  return { w: n(s.width), h: n(s.height) };
}

function paintImage(ctx: CanvasRenderingContext2D, it: ImageItem, images?: ImageResolver) {
  const img = images?.(it.blobId);
  if (img) {
    const c = cropOf(it);
    if (c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1) {
      ctx.drawImage(img, it.x, it.y, it.w, it.h);
    } else {
      const { w, h } = sourceSize(img);
      ctx.drawImage(img, c.x * w, c.y * h, c.w * w, c.h * h, it.x, it.y, it.w, it.h);
    }
    return;
  }
  ctx.save();
  ctx.fillStyle = '#ecebe7';
  ctx.fillRect(it.x, it.y, it.w, it.h);
  ctx.strokeStyle = '#cfccc4';
  ctx.lineWidth = 1;
  ctx.strokeRect(it.x + 0.5, it.y + 0.5, it.w - 1, it.h - 1);
  ctx.restore();
}

function paintLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, size: number) {
  const lh = size * LINE_HEIGHT;
  lines.forEach((line, i) => ctx.fillText(line, x, y + (i + 0.5) * lh));
}

/**
 * Formatted lines, starting at (x, y): highlights behind each line, then markers and text, each
 * vertically centred in its line box as plain text is.
 */
export function paintRich(ctx: CanvasRenderingContext2D, lines: RichLine[], x: number, y: number, size: number, font: string, color: string) {
  const lh = size * LINE_HEIGHT;
  ctx.save();
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const top = y + i * lh;
    for (const p of line.pieces) {
      if (!p.hl) continue;
      ctx.fillStyle = p.hl;
      ctx.fillRect(x + p.x, top, p.w, lh);
    }
    ctx.fillStyle = color;
    if (line.marker) {
      const shape = bulletShape(line.marker.text);
      const { cx, right, r } = markerPlace(line.marker, size);
      const cy = top + lh / 2;
      if (shape === 'square') ctx.fillRect(x + cx - r, cy - r, 2 * r, 2 * r);
      else if (shape) {
        ctx.beginPath();
        ctx.arc(x + cx, cy, shape === 'circle' ? r * 0.85 : r, 0, Math.PI * 2);
        if (shape === 'disc') ctx.fill();
        else {
          ctx.strokeStyle = color;
          ctx.lineWidth = r * 0.35;
          ctx.stroke();
        }
      } else {
        ctx.font = canvasFont(font, size);
        ctx.textAlign = 'right';
        ctx.fillText(line.marker.text, x + right, cy);
        ctx.textAlign = 'left';
      }
    }
    for (const p of line.pieces) {
      ctx.font = canvasFont(font, size, !!p.b, !!p.i);
      ctx.fillText(p.text, x + p.x, top + lh / 2);
    }
  });
  ctx.restore();
}

function paintText(ctx: CanvasRenderingContext2D, it: TextItem, dark: boolean) {
  const color = dark ? forDarkPaper(it.color) : it.color;
  if (it.rich) {
    paintRich(ctx, richTextLines({ ...it, rich: it.rich }, measurer(it.font, it.size)), it.x + TEXT_PAD, it.y + TEXT_PAD, it.size, it.font, color);
    return;
  }
  ctx.save();
  ctx.font = canvasFont(it.font, it.size);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  paintLines(ctx, textLines(it, measurer(it.font, it.size)), it.x + TEXT_PAD, it.y + TEXT_PAD, it.size);
  ctx.restore();
}

function paintSticky(ctx: CanvasRenderingContext2D, it: StickyItem) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = it.color;
  if (it.collapsed) {
    // A small note with a folded corner and a few "lines".
    const s = STICKY_ICON, f = s * 0.3;
    ctx.beginPath();
    ctx.moveTo(it.x, it.y);
    ctx.lineTo(it.x + s, it.y);
    ctx.lineTo(it.x + s, it.y + s - f);
    ctx.lineTo(it.x + s - f, it.y + s);
    ctx.lineTo(it.x, it.y + s);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      ctx.moveTo(it.x + 6, it.y + 8 + i * 5);
      ctx.lineTo(it.x + s - (i === 2 ? 12 : 6), it.y + 8 + i * 5);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.fillRect(it.x, it.y, it.w, it.h);
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.rect(it.x, it.y, it.w, it.h);
  ctx.clip();
  ctx.font = canvasFont('sans', STICKY_TEXT_SIZE);
  ctx.fillStyle = '#1d1d1f';
  ctx.textBaseline = 'middle';
  if (it.rich) {
    const lines = layoutRich(it.rich, it.w - 2 * STICKY_PAD, STICKY_TEXT_SIZE, measurer('sans', STICKY_TEXT_SIZE));
    paintRich(ctx, lines, it.x + STICKY_PAD, it.y + STICKY_PAD, STICKY_TEXT_SIZE, 'sans', '#1d1d1f');
  } else {
    const lines = wrapLines(it.text, it.w - 2 * STICKY_PAD, measurer('sans', STICKY_TEXT_SIZE));
    paintLines(ctx, lines, it.x + STICKY_PAD, it.y + STICKY_PAD, STICKY_TEXT_SIZE);
  }
  ctx.restore();
}

/** Sticky notes and tape sit above ink; everything else below it. */
export const isOverItem = (it: PageItem) => it.kind === 'sticky' || it.kind === 'tape';

/**
 * Tape: an opaque strip with a faint diagonal texture and a soft shadow, covering what is beneath.
 * Lifted, it becomes a pale outline so you can still see where it is.
 */
function paintTape(ctx: CanvasRenderingContext2D, it: TapeItem, revealed: boolean) {
  ctx.save();
  if (revealed) {
    ctx.fillStyle = it.color;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(it.x, it.y, it.w, it.h);
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(it.x + 0.75, it.y + 0.75, it.w - 1.5, it.h - 1.5);
    ctx.restore();
    return;
  }
  ctx.shadowColor = 'rgba(0,0,0,0.16)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = it.color;
  ctx.fillRect(it.x, it.y, it.w, it.h);
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.rect(it.x, it.y, it.w, it.h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let d = -it.h; d < it.w; d += 9) {
    ctx.moveTo(it.x + d, it.y + it.h);
    ctx.lineTo(it.x + d + it.h, it.y);
  }
  ctx.stroke();
  ctx.restore();
}

export const LINK_COLOR = '#2563eb';

/** A visible link is blue underlined text; a hotspot is a faint blue wash with a dashed underline. */
function paintLink(ctx: CanvasRenderingContext2D, it: LinkItem) {
  ctx.save();
  if (it.label) {
    ctx.font = canvasFont('sans', LINK_TEXT_SIZE);
    ctx.fillStyle = LINK_COLOR;
    ctx.textBaseline = 'middle';
    const y = it.y + it.h / 2;
    const w = Math.min(it.w - 2 * LINK_PAD, measurer('sans', LINK_TEXT_SIZE)(it.label));
    ctx.fillText(it.label, it.x + LINK_PAD, y, it.w - 2 * LINK_PAD);
    ctx.fillRect(it.x + LINK_PAD, y + LINK_TEXT_SIZE * 0.55, w, 1.2);
  } else {
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.fillRect(it.x, it.y, it.w, it.h);
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(it.x, it.y + it.h);
    ctx.lineTo(it.x + it.w, it.y + it.h);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Paint one layer of items: 'under' is images and text boxes (beneath ink, so they can be
 * written on), 'over' is sticky notes (above ink).
 */
export function paintItems(ctx: CanvasRenderingContext2D, items: readonly PageItem[], layer: 'under' | 'over', opts: ItemPaintOptions = {}) {
  for (const stored of items) {
    if (opts.hidden?.has(stored.id)) continue;
    const it = opts.override?.get(stored.id) ?? stored;
    if (isOverItem(it) !== (layer === 'over')) continue;
    const m = itemMatrix(it);
    const turned = !isIdentity(m);
    if (turned) {
      ctx.save();
      ctx.transform(...m);
    }
    paintItem(ctx, it, opts);
    if (turned) ctx.restore();
  }
}

// --- Shapes and lines ------------------------------------------------------------------------

/** Points along a polyline, spaced as recognised-shape ink is, at even pressure. */
function inkPoints(pts: readonly Vec[]): InputPoint[] {
  const out: InputPoint[] = [];
  for (let i = 1; i < pts.length; i++) out.push(...linePoints(pts[i - 1], pts[i]).slice(i > 1 ? 1 : 0));
  return out.length ? out : pts.map((p) => ({ x: p.x, y: p.y, p: 0.5 }));
}

/**
 * What a shape or line draws, in its unturned frame: the area to fill (closed shapes with a fill),
 * and its outline as strokes in the pen engine, so it looks like recognised-shape ink and exports
 * the same way.
 */
export function shapeInk(it: ShapeItem | LineItem): { fill: Vec[] | null; strokes: Stroke[] } {
  const style = { id: it.id, tool: 'pen' as const, color: it.color, width: it.width, simulatePressure: false, shape: true, ...(it.dash ? { dash: it.dash } : {}) };
  if (it.kind === 'line') return { fill: null, strokes: lineStrokes(it).map((pts) => ({ ...style, points: inkPoints(pts) })) };
  const outline = shapeOutline(it);
  return { fill: it.fill ? outline : null, strokes: [{ ...style, points: inkPoints(outline) }] };
}

// Items are immutable (ops replace them), so their drawn paths are cached by identity.
const shapePaths = new WeakMap<PageItem, { fill: Path2D | null; ink: Path2D }>();

function paintShape(ctx: CanvasRenderingContext2D, it: ShapeItem | LineItem, dark: boolean) {
  let p = shapePaths.get(it);
  if (!p) {
    const { fill, strokes } = shapeInk(it);
    let fillPath: Path2D | null = null;
    if (fill) {
      fillPath = new Path2D();
      fill.forEach((q, i) => (i ? fillPath!.lineTo(q.x, q.y) : fillPath!.moveTo(q.x, q.y)));
      fillPath.closePath();
    }
    const ink = new Path2D();
    for (const s of strokes) ink.addPath(buildStrokePath(s.points, s, true));
    p = { fill: fillPath, ink };
    shapePaths.set(it, p);
  }
  ctx.save();
  if (p.fill && it.kind === 'shape' && it.fill) {
    ctx.fillStyle = it.fill;
    ctx.fill(p.fill);
  }
  ctx.fillStyle = dark ? forDarkPaper(it.color) : it.color;
  ctx.fill(p.ink);
  ctx.restore();
}

function paintItem(ctx: CanvasRenderingContext2D, it: PageItem, opts: ItemPaintOptions) {
  if (it.kind === 'image') paintImage(ctx, it, opts.images);
  else if (it.kind === 'shape' || it.kind === 'line') paintShape(ctx, it, !!opts.dark);
  else if (it.kind === 'text') paintText(ctx, it, !!opts.dark);
  else if (it.kind === 'link') paintLink(ctx, it);
  else if (it.kind === 'tape') paintTape(ctx, it, !!opts.revealed?.has(it.id));
  else paintSticky(ctx, it);
}
