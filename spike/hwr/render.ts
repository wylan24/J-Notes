// Turn written ink into the grayscale images the models read, drawn with the app's own pen so the
// models see exactly what the app would give them.
import type { InputPoint, Stroke } from '../../src/core/model';
import { paintStroke } from '../../src/render/stroke';
import { boxOf } from './segment';

/** One stroke as captured: its points (page units = CSS px at 100%) and whether a stylus drew it. */
export interface InkStroke {
  points: InputPoint[];
  pen: boolean;
}

/** The app's default pen: black fountain pen, middle width, default steadying. */
export function asStroke(s: InkStroke, i: number): Stroke {
  return { id: `s${i}`, tool: 'pen', color: '#000000', width: 3, points: s.points, simulatePressure: !s.pen, penStyle: 'fountain', sharpness: 0.5, stabilise: 0.3 };
}

/**
 * Draw strokes black on white, cropped to their bounds plus a margin of `pad` × their height,
 * at `scale` px per page unit.
 */
export function renderInk(strokes: readonly InkStroke[], scale = 1, pad = 0.15): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const b = boxOf(strokes.flatMap((s) => s.points));
  if (!Number.isFinite(b.minX)) {
    canvas.width = canvas.height = 1;
    return canvas;
  }
  const m = Math.max(6, (b.maxY - b.minY) * pad);
  const x = b.minX - m, y = b.minY - m, w = b.maxX - b.minX + 2 * m, h = b.maxY - b.minY + 2 * m;
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
  strokes.forEach((s, i) => paintStroke(ctx, asStroke(s, i)));
  return canvas;
}

/**
 * SimpleHTR's input: the word scaled uniformly to fit 128×32, centred on white, grayscale, as
 * values in [-0.5, 0.5] (its `preprocess` and normalisation).
 */
export function simpleHtrInput(word: HTMLCanvasElement, w = 128, h = 32): Float32Array {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const k = Math.min(w / word.width, h / word.height);
  const nw = Math.max(1, Math.floor(word.width * k)), nh = Math.max(1, Math.floor(word.height * k));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(word, Math.floor((w - nw) / 2), Math.floor((h - nh) / 2), nw, nh);
  const px = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255 - 0.5;
  return out;
}
