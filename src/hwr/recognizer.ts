// The handwriting model, from the main thread: one shared worker, loaded on demand, reading one
// line at a time. Recognition is opt-in (Settings), since the model is a 70 MB download.
import type { Stroke } from '../core/model';
import type { InkLine } from '../core/segment';
import { paintStroke } from '../render/stroke';
import type { Reply, Request } from './recognizer.worker';

export type RecognizerStatus =
  | { state: 'off' }
  /** Downloading or starting the model; `total` is 0 until the sizes are known. */
  | { state: 'loading'; loaded: number; total: number }
  | { state: 'ready' }
  | { state: 'error'; message: string };

/** Give up on a load that makes no progress for this long (a CDN download can stall silently). */
const LOAD_STALL_MS = 3 * 60_000;
/** Give up on one line after this long; the worker is restarted. */
const LINE_TIMEOUT_MS = 60_000;

let worker: Worker | null = null;
let status: RecognizerStatus = { state: 'off' };
const listeners = new Set<() => void>();
let nextId = 1;
const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let stallTimer: ReturnType<typeof setTimeout> | null = null;
let ready: Promise<void> | null = null;
let readyHooks: { resolve: () => void; reject: (e: Error) => void } | null = null;

function setStatus(s: RecognizerStatus): void {
  status = s;
  listeners.forEach((l) => l());
}

export const recognizerStatus = (): RecognizerStatus => status;

export function onRecognizerStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function watchStall(): void {
  if (stallTimer) clearTimeout(stallTimer);
  stallTimer = setTimeout(() => fail('The handwriting model stopped downloading. Check the connection and try again.'), LOAD_STALL_MS);
}

function fail(message: string): void {
  stop();
  setStatus({ state: 'error', message });
}

/** Start the worker and load the model (from the browser cache after the first time). */
export function startRecognizer(): Promise<void> {
  if (ready) return ready;
  ready = new Promise<void>((resolve, reject) => (readyHooks = { resolve, reject }));
  ready.catch(() => {});
  worker = new Worker(new URL('./recognizer.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const r = e.data;
    if (r.type === 'progress') {
      watchStall();
      setStatus({ state: 'loading', loaded: r.loaded, total: r.total });
    } else if (r.type === 'loaded') {
      if (stallTimer) clearTimeout(stallTimer);
      setStatus({ state: 'ready' });
      readyHooks?.resolve();
    } else if (r.type === 'result') {
      const p = pending.get(r.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(r.id);
        p.resolve(r.text);
      }
    } else if (r.id !== undefined && pending.has(r.id)) {
      const p = pending.get(r.id)!;
      clearTimeout(p.timer);
      pending.delete(r.id);
      p.reject(new Error(r.message));
    } else {
      fail(`The handwriting model could not start: ${r.message}`);
    }
  };
  worker.onerror = (e) => fail(`The handwriting model could not start: ${e.message}`);
  setStatus({ state: 'loading', loaded: 0, total: 0 });
  watchStall();
  worker.postMessage({ type: 'load' } satisfies Request);
  return ready;
}

/** Stop the worker; anything waiting is told so. */
export function stop(): void {
  if (stallTimer) clearTimeout(stallTimer);
  stallTimer = null;
  worker?.terminate();
  worker = null;
  readyHooks?.reject(new Error('Recognition stopped'));
  readyHooks = null;
  ready = null;
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error('Recognition stopped'));
  }
  pending.clear();
  setStatus({ state: 'off' });
}

/** Read one line image. Starts the model if needed. */
export async function recognise(img: { rgba: Uint8ClampedArray; width: number; height: number }): Promise<string> {
  await startRecognizer();
  const w = worker!;
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Reading a line took too long'));
      // The worker may be stuck; start afresh (the model reloads from the browser cache).
      stop();
    }, LINE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ type: 'line', id, ...img } satisfies Request, [img.rgba.buffer]);
  });
}

/**
 * A line of writing as the model reads it: black ink on white, levelled by the line's slope,
 * cropped to the ink with a margin, at one pixel per page unit (what the spike measured).
 */
export function lineImage(strokes: readonly Stroke[], line: InkLine): { rgba: Uint8ClampedArray; width: number; height: number } {
  const { box, slope } = line;
  const theta = -Math.atan(slope);
  const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  // The levelled box: the corners turned about the centre.
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const corners = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.minX, box.maxY],
    [box.maxX, box.maxY],
  ].map(([x, y]) => ({ x: c.x + (x - c.x) * cos - (y - c.y) * sin, y: c.y + (x - c.x) * sin + (y - c.y) * cos }));
  const minX = Math.min(...corners.map((p) => p.x)), maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y)), maxY = Math.max(...corners.map((p) => p.y));
  const m = Math.max(6, (maxY - minY) * 0.15);
  const width = Math.max(1, Math.round(maxX - minX + 2 * m));
  const height = Math.max(1, Math.round(maxY - minY + 2 * m));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.translate(m - minX, m - minY);
  ctx.translate(c.x, c.y);
  ctx.rotate(theta);
  ctx.translate(-c.x, -c.y);
  for (const s of strokes) paintStroke(ctx, { ...s, color: '#000000', dash: undefined });
  return { rgba: ctx.getImageData(0, 0, width, height).data, width, height };
}
