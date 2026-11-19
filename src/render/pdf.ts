// PDF page backgrounds. pdf.js is loaded on first use (it is large), parses in its own worker,
// and pages are rendered on request, newest request first, into a memory-bounded cache.
// Callers ask for a page at a resolution, get the best render so far (or null), and are notified
// through `onImagesLoaded` when a sharper one is ready, exactly like photos.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfPageSize, PT_TO_UNITS, rasterScale, sharpEnough } from '../core/pdf';
import type { TextRun } from '../core/pdfSearch';
import type { PageSize, PdfBackground } from '../core/model';
import { getBlob } from '../storage/db';
import { emitImagesLoaded } from './items';
import type { PdfResolver } from './page';

type PdfJs = typeof import('pdfjs-dist');

let lib: Promise<PdfJs> | null = null;

/** Load pdf.js and point it at its worker. Only the first call downloads anything. */
function pdfjs(): Promise<PdfJs> {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, worker]) => {
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  });
  return lib;
}

/** Open PDF bytes. pdf.js takes ownership of the buffer it is given, so it gets a copy. */
async function open(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  return m.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise;
}

/** Page count and the size of every page in page units, for creating a notebook from a PDF. */
export async function readPdf(bytes: ArrayBuffer): Promise<{ sizes: PageSize[] }> {
  const pdf = await open(bytes);
  try {
    const sizes: PageSize[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
      sizes.push(pdfPageSize(vp.width, vp.height));
    }
    return { sizes };
  } finally {
    void pdf.destroy();
  }
}

// --- Open documents ------------------------------------------------------------------------

const docs = new Map<string, Promise<PDFDocumentProxy>>();

function openDocument(docId: string, blobId: string): Promise<PDFDocumentProxy> {
  const key = `${docId}/${blobId}`;
  let d = docs.get(key);
  if (!d) {
    d = getBlob(docId, blobId).then((b) => {
      if (!b) throw new Error('missing PDF');
      return open(b.bytes);
    });
    d.catch(() => docs.delete(key)); // let a later request retry
    docs.set(key, d);
  }
  return d;
}

// --- Rendered pages --------------------------------------------------------------------------

interface Raster {
  canvas: HTMLCanvasElement;
  /** Device px per page unit it was rendered at. */
  scale: number;
}

/** Total pixels of rendered pages kept; least recently used go first. */
const CACHE_PIXELS = 48_000_000;
const rasters = new Map<string, Raster>();
let cachedPixels = 0;

const keyOf = (docId: string, bg: PdfBackground) => `${docId}/${bg.blobId}/${bg.pageIndex}`;

function store(key: string, r: Raster): void {
  const old = rasters.get(key);
  if (old) {
    cachedPixels -= old.canvas.width * old.canvas.height;
    rasters.delete(key);
  }
  rasters.set(key, r);
  cachedPixels += r.canvas.width * r.canvas.height;
  for (const [k, v] of rasters) {
    if (cachedPixels <= CACHE_PIXELS || k === key) break;
    cachedPixels -= v.canvas.width * v.canvas.height;
    v.canvas.width = v.canvas.height = 0; // release the bitmap now, not at GC
    rasters.delete(k);
  }
}

interface Job {
  key: string;
  docId: string;
  bg: PdfBackground;
  scale: number;
}

/** Waiting renders by key. The newest is served first: it is what's on screen now. */
const queue = new Map<string, Job>();
const running = new Set<string>();
const waiters = new Map<string, Array<() => void>>();
const CONCURRENCY = 2;
const failed = new Set<string>();

function request(job: Job): void {
  if (failed.has(job.key)) return;
  // A sharper render asked for while one is running waits behind it, rather than being dropped.
  const queued = queue.get(job.key);
  if (queued && queued.scale >= job.scale) {
    // Move it to the back (served next).
    queue.delete(job.key);
    queue.set(job.key, queued);
    return;
  }
  queue.delete(job.key);
  queue.set(job.key, job);
  pump();
}

function pump(): void {
  while (running.size < CONCURRENCY) {
    // Newest first, skipping pages already being rendered.
    const job = [...queue.values()].reverse().find((j) => !running.has(j.key));
    if (!job) return;
    queue.delete(job.key);
    running.add(job.key);
    void render(job).finally(() => {
      running.delete(job.key);
      // Waiters are released once nothing more is pending for their page.
      if (!queue.has(job.key)) {
        waiters.get(job.key)?.forEach((w) => w());
        waiters.delete(job.key);
      }
      pump();
    });
  }
}

async function render(job: Job): Promise<void> {
  // A sharper render may have landed while this one waited (e.g. a thumbnail's after the page's).
  if ((rasters.get(job.key)?.scale ?? 0) >= job.scale) return;
  try {
    const pdf = await openDocument(job.docId, job.bg.blobId);
    const page = await pdf.getPage(job.bg.pageIndex + 1);
    const viewport = page.getViewport({ scale: job.scale * PT_TO_UNITS });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    // Never swap a sharper render for a softer one that finished later.
    if ((rasters.get(job.key)?.scale ?? 0) >= job.scale) return;
    store(job.key, { canvas, scale: job.scale });
    performance.mark('jnotes:pdf-render');
    emitImagesLoaded();
  } catch (e) {
    console.error('Could not render PDF page', e);
    failed.add(job.key);
  }
}

/**
 * The best render of a PDF page so far, for drawing at `wanted` device px per page unit on a page
 * of `size`. Starts a sharper render if this one is too soft; null until the first is ready.
 */
export function pdfRaster(docId: string, bg: PdfBackground, size: PageSize, wanted: number): HTMLCanvasElement | null {
  const key = keyOf(docId, bg);
  const hit = rasters.get(key);
  if (hit) {
    rasters.delete(key); // most recently used
    rasters.set(key, hit);
  }
  if (!hit || !sharpEnough(hit.scale, wanted, size)) request({ key, docId, bg, scale: rasterScale(wanted, size) });
  return hit?.canvas ?? null;
}

/** Wait until a page has a render at least sharp enough for `wanted` (for export). */
export function ensurePdfRaster(docId: string, bg: PdfBackground, size: PageSize, wanted: number): Promise<void> {
  const key = keyOf(docId, bg);
  const hit = rasters.get(key);
  if ((hit && sharpEnough(hit.scale, wanted, size)) || failed.has(key)) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.set(key, [...(waiters.get(key) ?? []), resolve]);
    request({ key, docId, bg, scale: rasterScale(wanted, size) });
    if (!queue.has(key) && !running.has(key)) resolve();
  });
}

/** A resolver bound to one notebook, as the page renderer takes it. */
export const pdfResolver =
  (docId: string): PdfResolver =>
  (bg, size, wanted) =>
    pdfRaster(docId, bg, size, wanted);

// --- Text ------------------------------------------------------------------------------------

const texts = new Map<string, Promise<TextRun[]>>();

/**
 * The text of a PDF page as runs with boxes in page units (top-left origin), for search.
 * Cached for the session: a page's text never changes.
 */
export function pdfText(docId: string, bg: PdfBackground): Promise<TextRun[]> {
  const key = keyOf(docId, bg);
  let t = texts.get(key);
  if (!t) {
    t = (async () => {
      const [m, pdf] = await Promise.all([pdfjs(), openDocument(docId, bg.blobId)]);
      const page = await pdf.getPage(bg.pageIndex + 1);
      const viewport = page.getViewport({ scale: PT_TO_UNITS });
      const content = await page.getTextContent();
      const runs: TextRun[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        // Map the run's text matrix into page units; (e, f) is its baseline origin.
        const [a, b, c, d, e, f] = m.Util.transform(viewport.transform, item.transform);
        const h = Math.hypot(c, d) || Math.hypot(a, b);
        const w = item.width * PT_TO_UNITS;
        runs.push({ str: item.str, x: e, y: f - h * 0.85, w, h, eol: item.hasEOL });
      }
      page.cleanup();
      return runs;
    })();
    t.catch(() => texts.delete(key));
    texts.set(key, t);
  }
  return t;
}
