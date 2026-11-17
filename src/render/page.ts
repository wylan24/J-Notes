import { pagePaper, pageSize, type Page, type PageBackground, type PageSize, type Paper, type PdfBackground, type Stroke, type Template } from '../core/model';
import { templateLayout, type LineTone } from '../core/templates';
import { paintStroke } from './stroke';
import { ensureImage, imageResolver, paintItems, type ImageResolver, type ItemPaintOptions } from './items';
import { ensurePdfRaster, pdfResolver } from './pdf';

/** Paper and template-line colours for each paper colour. */
export const PAPER_STYLES: Record<Paper, Record<LineTone | 'fill' | 'dot' | 'label', string>> = {
  white: { fill: '#fffefb', rule: '#c9d6e8', margin: '#f0b4b4', grid: '#dde3ec', strong: '#9fb0c7', dot: '#b9c2cf', label: '#8a95a5' },
  yellow: { fill: '#fdf5d3', rule: '#c4cfd9', margin: '#eaa79f', grid: '#e2dcc0', strong: '#a9a68f', dot: '#bdb59a', label: '#8f8770' },
  dark: { fill: '#26282c', rule: '#3d4a5c', margin: '#6b3a3a', grid: '#383c43', strong: '#56637a', dot: '#555b65', label: '#8a919c' },
};

const TONES: LineTone[] = ['grid', 'rule', 'strong', 'margin'];

function paintTemplate(ctx: CanvasRenderingContext2D, template: Template, size: PageSize, paper: Paper): void {
  const c = PAPER_STYLES[paper];
  const { lines, dots, labels } = templateLayout(template, size);
  ctx.save();
  ctx.lineWidth = 1;
  // One path per tone, lightest first; the half-unit offset keeps 1-unit lines crisp at 1×.
  for (const tone of TONES) {
    ctx.strokeStyle = c[tone];
    ctx.beginPath();
    for (const l of lines) {
      if (l.tone !== tone) continue;
      ctx.moveTo(l.x1 + (l.x1 === l.x2 ? 0.5 : 0), l.y1 + (l.y1 === l.y2 ? 0.5 : 0));
      ctx.lineTo(l.x2 + (l.x1 === l.x2 ? 0.5 : 0), l.y2 + (l.y1 === l.y2 ? 0.5 : 0));
    }
    ctx.stroke();
  }
  ctx.fillStyle = c.dot;
  for (const d of dots) ctx.fillRect(d.x - 1, d.y - 1, 2, 2);
  if (labels.length) {
    ctx.fillStyle = c.label;
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    for (const l of labels) ctx.fillText(l.text, l.x, l.y);
  }
  ctx.restore();
}

/** Draws a PDF page's render for a page of `size` at `wanted` device px per page unit, or null while none is ready. */
export type PdfResolver = (bg: PdfBackground, size: PageSize, wanted: number) => CanvasImageSource | null;

/**
 * The page's background beneath the template: a custom template image, fitted inside the page and
 * centred, or a PDF page, which fills it. Nothing is drawn until it is ready.
 */
function paintBackground(ctx: CanvasRenderingContext2D, bg: PageBackground, size: PageSize, opts: PaintOptions): void {
  if (bg.kind === 'pdf') {
    // The current transform's scale is the device px per page unit this paint is at.
    const t = ctx.getTransform();
    const raster = opts.pdf?.(bg, size, Math.hypot(t.a, t.b));
    if (raster) {
      // A render may be shrunk a lot (a thumbnail drawn from the page's render); smooth it properly.
      ctx.save();
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(raster, 0, 0, size.w, size.h);
      ctx.restore();
    }
    return;
  }
  const img = opts.items?.images?.(bg.blobId) as (CanvasImageSource & { width: number; height: number }) | null | undefined;
  if (!img || !img.width || !img.height) return;
  const k = Math.min(size.w / img.width, size.h / img.height);
  const w = img.width * k, h = img.height * k;
  ctx.drawImage(img, (size.w - w) / 2, (size.h - h) / 2, w, h);
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
  /** Renders of PDF page backgrounds. Without it, PDF pages paint as plain paper. */
  pdf?: PdfResolver;
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
  if (page.background) paintBackground(ctx, page.background, pageSize(page), opts);
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

/** A notebook's page as a PNG data URL, `width` CSS px wide, with its photos and PDF background as loaded so far. */
export function renderThumbnail(page: Page, docId: string, width = 240): string {
  const canvas = document.createElement('canvas');
  paintPage(canvas, page, width / pageSize(page).w, 1, { items: { images: imageResolver(docId) }, pdf: pdfResolver(docId) });
  return canvas.toDataURL('image/png');
}

/** Export one page at 2× as a PNG. Its images and PDF background are loaded first so none export as placeholders. */
export async function exportPagePng(page: Page, docId: string, filename: string): Promise<void> {
  const scale = 2;
  const bg = page.background;
  const blobIds = page.items.flatMap((it) => (it.kind === 'image' ? [it.blobId] : []));
  if (bg?.kind === 'image') blobIds.push(bg.blobId);
  await Promise.all([
    ...blobIds.map((id) => ensureImage(docId, id)),
    ...(bg?.kind === 'pdf' ? [ensurePdfRaster(docId, bg, pageSize(page), scale)] : []),
  ]);
  const canvas = document.createElement('canvas');
  paintPage(canvas, page, scale, 1, { items: { images: imageResolver(docId) }, pdf: pdfResolver(docId) });
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
