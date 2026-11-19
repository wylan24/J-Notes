import { describe, expect, it } from 'vitest';
import type { NotebookDoc, Page, Stroke } from '../src/core/model';
import { docLines, findInHandwriting, inkKey, lineRuns, matchSnippet, pageLines, unreadLines } from '../src/core/handwriting';
import { applyOp } from '../src/core/ops';

const H = 20;
let n = 0;
const letter = (x: number, y: number, extra: Partial<Stroke> = {}): Stroke => ({
  id: `s${n++}`,
  tool: 'pen',
  color: '#000',
  width: 2,
  simulatePressure: false,
  points: [
    { x, y: y + H, p: 0.5 },
    { x: x + 4, y, p: 0.5 },
    { x: x + 8, y: y + H, p: 0.5 },
    { x: x + 12, y, p: 0.5 },
  ],
  ...extra,
});
/** A line of words (letter counts) at (x, y). */
const line = (x: number, y: number, words: number[], extra: Partial<Stroke> = {}): Stroke[] => {
  const out: Stroke[] = [];
  let at = x;
  for (const count of words) {
    for (let i = 0; i < count; i++, at += 15) out.push(letter(at, y, extra));
    at += 30;
  }
  return out;
};
const page = (id: string, strokes: Stroke[], extra: Partial<Page> = {}): Page => ({ id, template: 'blank', strokes, items: [], ...extra });

describe('handwriting lines and keys', () => {
  it('keys a line by its ink, not where it is', () => {
    const a = line(100, 100, [3, 2]);
    const moved = a.map((s) => ({ ...s, id: `${s.id}m`, points: s.points.map((p) => ({ ...p, x: p.x + 50, y: p.y + 300 })) }));
    expect(inkKey(moved)).toBe(inkKey(a));
    const changed = [...a.slice(0, -1), letter(200, 100)];
    expect(inkKey(changed)).not.toBe(inkKey(a));
  });

  it('finds lines per shown layer and skips stray marks', () => {
    const base = line(100, 100, [3, 2]);
    const upper = line(100, 100, [2], { layerId: 'L2' });
    const hidden = line(100, 300, [2], { layerId: 'L3' });
    const dot: Stroke = { ...letter(400, 600), points: [{ x: 400, y: 600, p: 0.5 }, { x: 401, y: 601, p: 0.5 }] };
    const p = page('p', [...base, ...upper, ...hidden, dot], {
      layers: [{ id: 'base', name: 'Layer 1' }, { id: 'L2', name: 'Layer 2' }, { id: 'L3', name: 'Layer 3', hidden: true }],
    });
    const lines = pageLines(p);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.strokes.length).sort()).toEqual([2, 5]);
    // Cached by page identity.
    expect(pageLines(p)).toBe(lines);
  });

  it('lists lines still to read, starting from the page in view, each ink once', () => {
    const p1 = page('p1', line(100, 100, [3]));
    const p2 = page('p2', [...line(100, 100, [2, 2]), ...line(100, 200, [3])]);
    const doc: NotebookDoc = { id: 'd', pages: [p1, p2] };
    const known = new Set([pageLines(p2)[1].key]);
    // p2's second line has the same ink as p1's line, so it is known too.
    expect(pageLines(p2)[1].key).toBe(pageLines(p1)[0].key);
    const todo = unreadLines(doc, (k) => known.has(k), 1);
    expect(todo.map((l) => l.pageId)).toEqual(['p2']);
    expect(docLines(doc)).toHaveLength(3);
  });
});

describe('handwriting search', () => {
  const p1 = page('p1', [...line(100, 100, [3, 2]), ...line(100, 200, [4])]);
  const p2 = page('p2', line(100, 100, [2, 3, 2]));
  const doc: NotebookDoc = { id: 'd', pages: [p1, p2] };
  const texts = new Map([
    [pageLines(p1)[0].key, 'buy milk'],
    [pageLines(p1)[1].key, 'eggs'],
    [pageLines(p2)[0].key, 'Milk and bread'],
  ]);

  it('highlights matched words when the text has as many words as the ink', () => {
    const [l] = pageLines(p1);
    const runs = lineRuns(l.line, 'buy milk');
    expect(runs.map((r) => r.str)).toEqual(['buy', 'milk']);
    expect(runs[1].x).toBeCloseTo(l.line.words[1].box.minX);
    // Otherwise the whole line.
    expect(lineRuns(l.line, 'buymilk')).toEqual([expect.objectContaining({ str: 'buymilk', x: l.line.box.minX })]);
    expect(lineRuns(l.line, '  ')).toEqual([]);
  });

  it('finds a word in every page, ignoring case, in page order', () => {
    const hits = findInHandwriting(doc, (k) => texts.get(k), 'MILK');
    expect(hits.map((h) => h.pageIndex)).toEqual([0, 1]);
    const [first] = hits;
    expect(first.match.snippet.slice(first.match.start, first.match.end)).toBe('milk');
    expect(first.match.rects).toHaveLength(1);
    // The whole word's box: the match covers every letter of it.
    const word = pageLines(p1)[0].line.words[1].box;
    expect(first.match.rects[0]).toEqual({ x: word.minX, y: word.minY, w: word.maxX - word.minX, h: word.maxY - word.minY });
  });

  it('matches a phrase across words, and nothing for an empty query or unread lines', () => {
    expect(findInHandwriting(doc, (k) => texts.get(k), 'milk and')).toHaveLength(1);
    expect(findInHandwriting(doc, (k) => texts.get(k), '  ')).toEqual([]);
    expect(findInHandwriting(doc, () => undefined, 'milk')).toEqual([]);
  });

  it('forgets text when the writing changes', () => {
    const erased = applyOp(doc, { type: 'strokes.removed', pageId: 'p1', strokes: [p1.strokes[0]], indices: [0] });
    expect(findInHandwriting(erased, (k) => texts.get(k), 'buy')).toEqual([]);
  });

  it('gives a snippet for the library', () => {
    const m = matchSnippet(['eggs', 'Buy milk today'], 'milk')!;
    expect(m.snippet.slice(m.start, m.end)).toBe('milk');
    expect(matchSnippet(['eggs'], 'milk')).toBeNull();
  });
});
