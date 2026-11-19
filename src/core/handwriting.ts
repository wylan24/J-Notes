// Handwriting search: which lines of writing a notebook has, the cache key each line's recognised
// text is stored under, and finding a query in that text. The model itself runs in a worker
// (src/hwr); this part is pure, so it is tested in Node.
import type { NotebookDoc, Page, Stroke } from './model';
import { contentByLayer } from './layers';
import { segmentLines, type InkLine } from './segment';
import { findInPage, normaliseQuery, type PageMatch, type TextRun } from './pdfSearch';

/** A line of writing on a page, with its strokes and the key its text is cached under. */
export interface PageLine {
  pageId: string;
  key: string;
  line: InkLine;
  strokes: Stroke[];
}

/** What is stored for each recognised line. */
export interface HwrEntry {
  docId: string;
  key: string;
  /** The page it was on when read; library search shows it, the notebook search looks lines up afresh. */
  pageId: string;
  text: string;
}

/**
 * A key for a line's ink: a hash of its points relative to the line's corner, so moving the line
 * keeps its text cached, while any change to the writing (a stroke added, erased, reshaped) reads
 * it again. Two lines written identically share a key, and rightly share their text.
 */
export function inkKey(strokes: readonly Stroke[]): string {
  let minX = Infinity, minY = Infinity;
  for (const s of strokes) for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const mix = (v: number) => {
    h1 = Math.imul(h1 ^ v, 16777619);
    h2 = Math.imul(h2 ^ v, 2246822519) ^ (h2 >>> 13);
  };
  for (const s of strokes) {
    mix(s.points.length);
    for (const p of s.points) {
      mix(Math.round((p.x - minX) * 2));
      mix(Math.round((p.y - minY) * 2));
    }
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + strokes.length.toString(36);
}

// Pages are immutable (ops replace them), so their lines can be cached by identity.
const linesCache = new WeakMap<Page, PageLine[]>();

/**
 * The lines of writing on a page's shown layers, top to bottom. Each layer is read on its own,
 * since ink on different layers isn't one line. Stray marks (a dot, a tick) are left out.
 */
export function pageLines(page: Page): PageLine[] {
  const cached = linesCache.get(page);
  if (cached) return cached;
  const out: PageLine[] = [];
  for (const { strokes } of contentByLayer(page)) {
    const byId = new Map(strokes.map((s) => [s.id, s]));
    for (const line of segmentLines(strokes)) {
      if (line.box.maxX - line.box.minX < line.letter) continue;
      const ls = line.strokeIds.map((id) => byId.get(id)!);
      out.push({ pageId: page.id, key: inkKey(ls), line, strokes: ls });
    }
  }
  linesCache.set(page, out);
  return out;
}

/** Every line in the notebook, page by page. */
export function docLines(doc: NotebookDoc): PageLine[] {
  return doc.pages.flatMap(pageLines);
}

/**
 * The text runs of a recognised line, for matching and highlighting: one per word where the text
 * has as many words as the ink, so a match highlights just its words; otherwise the whole line.
 */
export function lineRuns(line: InkLine, text: string): TextRun[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const box = (b: InkLine['box']) => ({ x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY });
  if (words.length === line.words.length) {
    // Each word ends its run (`eol` adds the space between words without it taking up any of the
    // word's box), so a match is highlighted over just its letters.
    return words.map((str, i) => ({ str, ...box(line.words[i].box), eol: true }));
  }
  return [{ str: words.join(' '), ...box(line.box), eol: true }];
}

export interface HandwritingMatch {
  pageId: string;
  pageIndex: number;
  match: PageMatch;
}

/** Every match of `query` in the notebook's recognised writing, in page order. Lines not yet read are skipped. */
export function findInHandwriting(doc: NotebookDoc, textOf: (key: string) => string | undefined, query: string, limit = Infinity): HandwritingMatch[] {
  const q = normaliseQuery(query);
  if (!q) return [];
  const out: HandwritingMatch[] = [];
  doc.pages.forEach((page, pageIndex) => {
    if (out.length >= limit) return;
    const runs = pageLines(page).flatMap((l) => {
      const text = textOf(l.key);
      return text ? lineRuns(l.line, text) : [];
    });
    for (const match of findInPage(runs, q)) out.push({ pageId: page.id, pageIndex, match });
  });
  return out.slice(0, limit);
}

/** The first match of `query` in stored text, as a snippet with the match at [start, end); null if none. */
export function matchSnippet(texts: readonly string[], query: string): PageMatch | null {
  const q = normaliseQuery(query);
  if (!q) return null;
  for (const t of texts) {
    const [m] = findInPage([{ str: t, x: 0, y: 0, w: 0, h: 0, eol: true }], q);
    if (m) return m;
  }
  return null;
}

/** Lines whose text isn't known yet, the given page first and then onward, wrapping round. */
export function unreadLines(doc: NotebookDoc, known: (key: string) => boolean, fromPage = 0): PageLine[] {
  const n = doc.pages.length;
  const seen = new Set<string>();
  const out: PageLine[] = [];
  for (let k = 0; k < n; k++) {
    for (const l of pageLines(doc.pages[(fromPage + k) % n])) {
      if (known(l.key) || seen.has(l.key)) continue;
      seen.add(l.key);
      out.push(l);
    }
  }
  return out;
}
