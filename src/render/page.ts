import { PAGE_H, PAGE_W, type Page, type Stroke, type Template } from '../core/model';
import { paintStroke } from './stroke';

export const PAPER = '#fffefb';

function paintTemplate(ctx: CanvasRenderingContext2D, template: Template): void {
  ctx.save();
  switch (template) {
    case 'ruled': {
      ctx.strokeStyle = '#c9d6e8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 112; y < PAGE_H - 40; y += 32) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(PAGE_W, y + 0.5);
      }
      ctx.stroke();
      ctx.strokeStyle = '#f0b4b4';
      ctx.beginPath();
      ctx.moveTo(96.5, 0);
      ctx.lineTo(96.5, PAGE_H);
      ctx.stroke();
      break;
    }
    case 'grid': {
      ctx.strokeStyle = '#dde3ec';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 28; x < PAGE_W; x += 28) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, PAGE_H);
      }
      for (let y = 28; y < PAGE_H; y += 28) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(PAGE_W, y + 0.5);
      }
      ctx.stroke();
      break;
    }
    case 'dotted': {
      ctx.fillStyle = '#b9c2cf';
      for (let x = 28; x < PAGE_W; x += 28) for (let y = 28; y < PAGE_H; y += 28) ctx.fillRect(x - 1, y - 1, 2, 2);
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
export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  hidden?: ReadonlySet<string>,
  replace?: ReadonlyMap<string, Stroke[]>,
): void {
  for (const pass of ['highlighter', 'pen'] as const) {
    for (const s of strokes) {
      if (s.tool !== pass || hidden?.has(s.id)) continue;
      const repl = replace?.get(s.id);
      if (repl) repl.forEach((r) => paintStroke(ctx, r));
      else paintStroke(ctx, s);
    }
  }
}

/**
 * Paint a full page into a canvas at `scale` page-units→CSS px and the given
 * device pixel ratio. Resizes the backing store if needed.
 */
export function paintPage(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  page: Page,
  scale: number,
  dpr: number,
  hidden?: ReadonlySet<string>,
  replace?: ReadonlyMap<string, Stroke[]>,
): void {
  const w = Math.round(PAGE_W * scale * dpr);
  const h = Math.round(PAGE_H * scale * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(w / PAGE_W, 0, 0, h / PAGE_H, 0, 0);
  paintTemplate(ctx, page.template);
  paintStrokes(ctx, page.strokes, hidden, replace);
}

export function renderThumbnail(page: Page, width = 240): string {
  const canvas = document.createElement('canvas');
  paintPage(canvas, page, width / PAGE_W, 1);
  return canvas.toDataURL('image/png');
}

export async function exportPagePng(page: Page, filename: string): Promise<void> {
  const canvas = document.createElement('canvas');
  paintPage(canvas, page, 2, 1);
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
