import type { ImageItem, LinkItem, PageItem, StickyItem, TextItem } from '../core/model';
import { LINK_PAD, LINK_TEXT_SIZE } from '../core/links';
import { fontFamily, LINE_HEIGHT, STICKY_ICON, STICKY_PAD, STICKY_TEXT_SIZE, TEXT_PAD, textLines, wrapLines, type MeasureText } from '../core/items';
import { getBlob } from '../storage/db';

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

export function canvasFont(font: string, size: number): string {
  return `${size}px ${fontFamily(font)}`;
}

/** A measureText for the given font, for layout that matches what the canvas draws. */
export function measurer(font: string, size: number): MeasureText {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  if (!ctx) return (s) => s.length * size * 0.55;
  return (s) => {
    ctx.font = canvasFont(font, size);
    return ctx.measureText(s).width;
  };
}

// --- Painting ----------------------------------------------------------------------

export interface ItemPaintOptions {
  images?: ImageResolver;
  hidden?: ReadonlySet<string>;
  /** Items to draw in place of the stored ones (a move or resize in progress). */
  override?: ReadonlyMap<string, PageItem>;
}

function paintImage(ctx: CanvasRenderingContext2D, it: ImageItem, images?: ImageResolver) {
  const img = images?.(it.blobId);
  if (img) {
    ctx.drawImage(img, it.x, it.y, it.w, it.h);
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

function paintText(ctx: CanvasRenderingContext2D, it: TextItem) {
  ctx.save();
  ctx.font = canvasFont(it.font, it.size);
  ctx.fillStyle = it.color;
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
  const lines = wrapLines(it.text, it.w - 2 * STICKY_PAD, measurer('sans', STICKY_TEXT_SIZE));
  paintLines(ctx, lines, it.x + STICKY_PAD, it.y + STICKY_PAD, STICKY_TEXT_SIZE);
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
    if ((it.kind === 'sticky') !== (layer === 'over')) continue;
    if (it.kind === 'image') paintImage(ctx, it, opts.images);
    else if (it.kind === 'text') paintText(ctx, it);
    else if (it.kind === 'link') paintLink(ctx, it);
    else paintSticky(ctx, it);
  }
}
