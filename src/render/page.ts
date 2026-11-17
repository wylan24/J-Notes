import { pagePaper, pageSize, type Page, type PageSize, type Paper, type Stroke, type Template } from '../core/model';
import { paintStroke } from './stroke';
import { ensureImage, imageResolver, paintItems, type ImageResolver, type ItemPaintOptions } from './items';

/** Paper and template-line colours for each paper colour. */
export const PAPER_STYLES: Record<Paper, { fill: string; rule: string; margin: string; grid: string; dot: string }> = {
  white: { fill: '#fffefb', rule: '#c9d6e8', margin: '#f0b4b4', grid: '#dde3ec', dot: '#b9c2cf' },
  yellow: { fill: '#fdf5d3', rule: '#c4cfd9', margin: '#eaa79f', grid: '#e2dcc0', dot: '#bdb59a' },
  dark: { fill: '#26282c', rule: '#3d4a5c', margin: '#6b3a3a', grid: '#383c43', dot: '#555b65' },
};

function paintTemplate(ctx: CanvasRenderingContext2D, template: Template, { w, h }: PageSize, paper: Paper): void {
  const c = PAPER_STYLES[paper];
  ctx.save();
  switch (template) {
    case 'ruled': {
      ctx.strokeStyle = c.rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 112; y < h - 40; y += 32) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();
      ctx.strokeStyle = c.margin;
      ctx.beginPath();
      ctx.moveTo(96.5, 0);
      ctx.lineTo(96.5, h);
      ctx.stroke();
      break;
    }
    case 'grid': {
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 28; x < w; x += 28) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
      }
      for (let y = 28; y < h; y += 28) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();
      break;
    }
    case 'dotted': {
      ctx.fillStyle = c.dot;
      for (let x = 28; x < w; x += 28) for (let y = 28; y < h; y += 28) ctx.fillRect(x - 1, y - 1, 2, 2);
      break;
    }
    case 'blank':
      break;
  }
  ctx.restore();
}

/**
 * Paint strokes with every highlighter underneath every pen stroke, so
 * highlighting never covers handwriting whichever was drawn first.
 * `replace` swaps a stroke for other strokes (e.g. a partial erase in progress).
 */
/** Opacity of ink an audio playback hasn't reached yet. */
const AHEAD_ALPHA = 0.22;

export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  hidden?: ReadonlySet<string>,
  replace?: ReadonlyMap<string, Stroke[]>,
  fade?: (s: Stroke) => boolean,
): void {
  for (const pass of ['highlighter', 'pen'] as const) {
    for (const s of strokes) {
      if (s.tool !== pass || hidden?.has(s.id)) continue;
      const alpha = fade?.(s) ? AHEAD_ALPHA : 1;
      const repl = replace?.get(s.id);
      if (repl) repl.forEach((r) => paintStroke(ctx, r, undefined, alpha));
      else paintStroke(ctx, s, undefined, alpha);
    }
  }
}

export interface PaintOptions {
  /** Stroke ids not to draw (e.g. being dragged on the live layer). */
  hidden?: ReadonlySet<string>;
  /** Strokes to draw in place of others (e.g. a partial erase in progress). */
  replace?: ReadonlyMap<string, Stroke[]>;
  items?: ItemPaintOptions;
  /** Strokes to draw faded (ink an audio playback hasn't reached yet). */
  fade?: (s: Stroke) => boolean;
}

/**
 * Paint a full page into a canvas at `scale` page-units→CSS px and the given
 * device pixel ratio. Resizes the backing store if needed. Layers, bottom to top:
 * template, images and text boxes, highlighter, pen, sticky notes.
 */
export function paintPage(canvas: HTMLCanvasElement | OffscreenCanvas, page: Page, scale: number, dpr: number, opts: PaintOptions = {}): void {
  const size = pageSize(page);
  const w = Math.round(size.w * scale * dpr);
  const h = Math.round(size.h * scale * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER_STYLES[pagePaper(page)].fill;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(w / size.w, 0, 0, h / size.h, 0, 0);
  paintContent(ctx, page, opts);
}

function paintContent(ctx: CanvasRenderingContext2D, page: Page, opts: PaintOptions): void {
  paintTemplate(ctx, page.template, pageSize(page), pagePaper(page));
  paintItems(ctx, page.items, 'under', opts.items);
  paintStrokes(ctx, page.strokes, opts.hidden, opts.replace, opts.fade);
  paintItems(ctx, page.items, 'over', opts.items);
}

/**
 * Paint part of a page (`rect`, in page units) to fill a canvas of cssW×cssH CSS px.
 * Used by the zoom window. The page is painted through an offset transform (what falls outside
 * the canvas is dropped), so layering is identical to the full page.
 */
export function paintRegion(
  canvas: HTMLCanvasElement,
  page: Page,
  rect: { x: number; y: number; w: number; h: number },
  cssW: number,
  cssH: number,
  dpr: number,
  opts: PaintOptions = {},
): void {
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER_STYLES[pagePaper(page)].fill;
  ctx.fillRect(0, 0, w, h);
  const k = w / rect.w;
  ctx.setTransform(k, 0, 0, k, -rect.x * k, -rect.y * k);
  paintContent(ctx, page, opts);
}

/** A thumbnail of loose content (an element) on paper, fitted and centred in w×h CSS px. */
export function renderContentThumbnail(
  content: { strokes: Stroke[]; items: Page['items']; w: number; h: number },
  images?: ImageResolver,
  w = 176,
  h = 132,
): string {
  const pad = Math.max(content.w, content.h) * 0.08 + 4;
  // Widen whichever side is short so the content keeps its proportions.
  let rw = content.w + pad * 2;
  let rh = content.h + pad * 2;
  if (rw / rh < w / h) rw = (rh * w) / h;
  else rh = (rw * h) / w;
  const rect = { x: content.w / 2 - rw / 2, y: content.h / 2 - rh / 2, w: rw, h: rh };
  const canvas = document.createElement('canvas');
  const page: Page = { id: 'element', template: 'blank', strokes: content.strokes, items: content.items };
  paintRegion(canvas, page, rect, w, h, 2, { items: { images } });
  return canvas.toDataURL('image/png');
}

export function renderThumbnail(page: Page, images?: ImageResolver, width = 240): string {
  const canvas = document.createElement('canvas');
  paintPage(canvas, page, width / pageSize(page).w, 1, { items: { images } });
  return canvas.toDataURL('image/png');
}

/** Export one page at 2× as a PNG. Its images are loaded first so none export as placeholders. */
export async function exportPagePng(page: Page, docId: string, filename: string): Promise<void> {
  await Promise.all(page.items.flatMap((it) => (it.kind === 'image' ? [ensureImage(docId, it.blobId)] : [])));
  const canvas = document.createElement('canvas');
  paintPage(canvas, page, 2, 1, { items: { images: imageResolver(docId) } });
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (blob) downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
