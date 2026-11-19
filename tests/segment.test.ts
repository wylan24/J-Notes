import { describe, expect, it } from 'vitest';
import type { Page, Stroke } from '../src/core/model';
import { midAt, pageLetterHeight, paragraphs, segmentLines, splitWordBoxes } from '../src/core/segment';
import { align, insertSpace, minReflowWidth, moveOps, movedStrokes, reflow, smartInkLayout, straighten } from '../src/core/smartInk';
import { applyOp } from '../src/core/ops';
import { strokeBounds } from '../src/core/geometry';

// Synthetic handwriting: each letter is one zigzag stroke `H` tall and 0.6·H wide, letters 0.15·H
// apart, words 1.6·H apart. `slope` tilts the line (dy per dx).
const H = 20;
let n = 0;
function letter(x: number, y: number, h = H, extra: Partial<Stroke> = {}): Stroke {
  const w = 0.6 * h;
  return {
    id: `s${n++}`,
    tool: 'pen',
    color: '#000',
    width: 2,
    simulatePressure: false,
    points: [
      { x, y: y + h, p: 0.5 },
      { x: x + w / 3, y, p: 0.5 },
      { x: x + (2 * w) / 3, y: y + h, p: 0.5 },
      { x: x + w, y, p: 0.5 },
    ],
    ...extra,
  };
}
/** A line of words given by letter counts, starting at (x, y) (top of the letters). */
function writeLine(x: number, y: number, words: number[], slope = 0, h = H): Stroke[][] {
  const out: Stroke[][] = [];
  let at = x;
  for (const count of words) {
    const word: Stroke[] = [];
    for (let i = 0; i < count; i++) {
      word.push(letter(at, y + slope * (at - x), h));
      at += 0.75 * h;
    }
    at += 1.6 * h - 0.15 * h;
    out.push(word);
  }
  return out;
}
const dot = (x: number, y: number): Stroke => ({
  id: `d${n++}`,
  tool: 'pen',
  color: '#000',
  width: 2,
  simulatePressure: false,
  points: [
    { x, y, p: 0.5 },
    { x: x + 2, y: y + 2, p: 0.5 },
  ],
});

const ids = (words: Stroke[][]) => words.map((w) => w.map((s) => s.id));

describe('segmentation', () => {
  it('splits a line into words at gaps of more than a letter height', () => {
    const line = writeLine(100, 100, [3, 5, 2]);
    const [found] = segmentLines(line.flat());
    expect(found.words.map((w) => w.strokeIds)).toEqual(ids(line));
    expect(found.letter).toBeCloseTo(H, 0);
    expect(found.slope).toBe(0);
  });

  it('keeps a comma with the word before it', () => {
    const boxes = [
      { minX: 0, maxX: 10, minY: 0, maxY: 20 },
      { minX: 12, maxX: 22, minY: 0, maxY: 20 },
      { minX: 46, maxX: 50, minY: 18, maxY: 24 }, // a comma, well clear of the word
      { minX: 80, maxX: 90, minY: 0, maxY: 20 },
    ];
    expect(splitWordBoxes(boxes)).toEqual([[0, 1, 2], [3]]);
  });

  it('gives a comma written nearer the next word back to the word before', () => {
    const boxes = [
      { minX: 0, maxX: 10, minY: 0, maxY: 20 },
      { minX: 12, maxX: 22, minY: 0, maxY: 20 },
      { minX: 46, maxX: 50, minY: 18, maxY: 24 }, // comma, low, just before the next word
      { minX: 54, maxX: 64, minY: 0, maxY: 20 },
      { minX: 66, maxX: 76, minY: 0, maxY: 20 },
    ];
    expect(splitWordBoxes(boxes)).toEqual([[0, 1, 2], [3, 4]]);
    // A small mark high up (an opening quote) stays with the word it leads.
    const quote = boxes.map((b, i) => (i === 2 ? { minX: 46, maxX: 50, minY: -2, maxY: 4 } : b));
    expect(splitWordBoxes(quote)).toEqual([[0, 1], [2, 3, 4]]);
  });

  it('finds lines top to bottom, and keeps i-dots on their own line', () => {
    const a = writeLine(100, 100, [3, 4]);
    const b = writeLine(100, 140, [2, 2, 2]);
    const iDot = dot(105, 132); // above the first letter of line b, nearer it than line a
    const lines = segmentLines([...b.flat(), iDot, ...a.flat()]);
    expect(lines).toHaveLength(2);
    expect(lines[0].strokeIds.sort()).toEqual(a.flat().map((s) => s.id).sort());
    expect(lines[1].strokeIds).toContain(iDot.id);
    expect(lines[1].words[0].strokeIds).toContain(iDot.id);
  });

  it('follows a sloping line and measures its slope', () => {
    const line = writeLine(100, 100, [4, 4, 4, 4], 0.1);
    const [found, ...rest] = segmentLines(line.flat());
    expect(rest).toHaveLength(0);
    expect(found.slope).toBeCloseTo(0.1, 1);
    expect(found.words).toHaveLength(4);
    // The midline goes through the middle of the letters.
    const last = line[3][3];
    const b = strokeBounds(last);
    expect(midAt(found, (b.minX + b.maxX) / 2)).toBeCloseTo((b.minY + b.maxY) / 2, -1);
  });

  it('leaves out highlighter, shapes and drawings', () => {
    const line = writeLine(100, 100, [3, 3]).flat();
    const hl = { ...letter(100, 100), tool: 'highlighter' as const };
    const shape = letter(100, 300, H, { shape: true });
    const drawing = letter(400, 300, 10 * H);
    const lines = segmentLines([...line, hl, shape, drawing]);
    expect(lines).toHaveLength(1);
    expect(lines[0].strokeIds.sort()).toEqual(line.map((s) => s.id).sort());
  });

  it('judges letter size on a page with a drawing on it', () => {
    const boxes = [...Array(9)].map((_, i) => ({ minX: i * 20, maxX: i * 20 + 12, minY: 0, maxY: 20 }));
    boxes.push({ minX: 0, maxX: 400, minY: 0, maxY: 400 });
    expect(pageLetterHeight(boxes)).toBe(20);
  });

  it('separates columns written side by side', () => {
    const left = writeLine(50, 100, [3, 3]);
    const right = writeLine(600, 100, [3, 3]);
    expect(segmentLines([...left.flat(), ...right.flat()])).toHaveLength(2);
  });

  it('groups close lines into paragraphs and splits at a blank line', () => {
    const lines = segmentLines([
      ...writeLine(100, 100, [3, 3]).flat(),
      ...writeLine(100, 135, [3, 3]).flat(),
      ...writeLine(100, 240, [3]).flat(),
    ]);
    expect(paragraphs(lines).map((p) => p.lines.length)).toEqual([2, 1]);
  });

  it('keeps lines on ruled-paper spacing in one paragraph', () => {
    // About 2.7 letter heights apart, as on 32-unit ruling.
    const lines = segmentLines([0, 1, 2, 3].flatMap((i) => writeLine(100, 100 + i * 54, [3, 2, 4]).flat()));
    expect(paragraphs(lines).map((p) => p.lines.length)).toEqual([4]);
  });

  it('is empty for no writing', () => {
    expect(segmentLines([])).toEqual([]);
  });
});

const page = (strokes: Stroke[]): Page => ({ id: 'p', template: 'blank', strokes, items: [] });

/** Each word's box after the moves, in reading order. */
function boxesAfter(strokes: Stroke[], words: Stroke[][], moves: ReturnType<typeof reflow>) {
  const moved = new Map(movedStrokes(strokes, moves).map((s) => [s.id, s]));
  return words.map((w) => {
    const bs = w.map((s) => strokeBounds(moved.get(s.id)!));
    return { minX: Math.min(...bs.map((b) => b.minX)), maxX: Math.max(...bs.map((b) => b.maxX)), minY: Math.min(...bs.map((b) => b.minY)) };
  });
}

describe('Smart Ink', () => {
  it('only works on writing that segments completely', () => {
    const line = writeLine(100, 100, [3, 3]).flat();
    expect(smartInkLayout(line)).not.toBeNull();
    expect(smartInkLayout([...line, letter(400, 300, 10 * H)])).toBeNull();
    expect(smartInkLayout([])).toBeNull();
  });

  it('reflows a line into a narrower column, keeping word order and spacing between lines', () => {
    const words = writeLine(100, 100, [3, 3, 3, 3]);
    const strokes = words.flat();
    const layout = smartInkLayout(strokes)!;
    const wordW = 2 * 0.75 * H + 0.6 * H;
    // Room for two words a line.
    const moves = reflow(layout.paragraphs, 100, 2 * wordW + 2 * H);
    const after = boxesAfter(strokes, words, moves);
    expect(after.map((b) => Math.round(b.minX))).toEqual([99, Math.round(after[1].minX), 99, Math.round(after[3].minX)]);
    expect(after[1].minX).toBeGreaterThan(after[0].maxX);
    expect(after[2].minY).toBeGreaterThan(after[0].minY + H);
    expect(after[0].minY).toBeCloseTo(after[1].minY, 5);
    // One undo step's worth of ops, applied through the normal reducer.
    const ops = moveOps(page(strokes), moves);
    const result = ops.reduce((d, op) => applyOp(d, op), { id: 'd', pages: [page(strokes)] });
    expect(result.pages[0].strokes).toHaveLength(strokes.length);
  });

  it('reflows back to one line when widened, and never narrower than the widest word', () => {
    const words = [...writeLine(100, 100, [3, 3]), ...writeLine(100, 135, [3, 3])];
    const strokes = words.flat();
    const layout = smartInkLayout(strokes)!;
    expect(layout.paragraphs).toHaveLength(1);
    const after = boxesAfter(strokes, words, reflow(layout.paragraphs, 100, 1000));
    expect(new Set(after.map((b) => Math.round(b.minY))).size).toBe(1);
    const narrow = boxesAfter(strokes, words, reflow(layout.paragraphs, 100, 1));
    expect(narrow.every((b) => Math.round(b.minX) === 99)).toBe(true);
    expect(minReflowWidth(layout.paragraphs)).toBeGreaterThan(H);
  });

  it('moves a later paragraph down when the one above grows', () => {
    const words = [...writeLine(100, 100, [3, 3, 3]), ...writeLine(100, 220, [3])];
    const strokes = words.flat();
    const layout = smartInkLayout(strokes)!;
    expect(layout.paragraphs).toHaveLength(2);
    const after = boxesAfter(strokes, words, reflow(layout.paragraphs, 100, 60));
    expect(after[3].minY).toBeGreaterThan(220 + H);
  });

  it('inserts space before the word after the point, moving only the rest of that line', () => {
    const words = [...writeLine(100, 100, [3, 3, 3]), ...writeLine(100, 135, [2])];
    const strokes = words.flat();
    const layout = smartInkLayout(strokes)!;
    const before = boxesAfter(strokes, words, []);
    const gapX = (before[0].maxX + before[1].minX) / 2;
    const after = boxesAfter(strokes, words, insertSpace(layout.paragraphs, { x: gapX, y: 110 }, 40, 100, 2000)!);
    expect(after[0]).toEqual(before[0]);
    expect(after[1].minX - before[1].minX).toBeCloseTo(40);
    expect(after[2].minX - before[2].minX).toBeCloseTo(40);
    expect(after[3]).toEqual(before[3]);
    expect(insertSpace(layout.paragraphs, { x: gapX, y: 900 }, 40, 100, 2000)).toBeNull();
  });

  it('moves words pushed past the edge to a new row, and the lines below down', () => {
    const words = [...writeLine(100, 100, [3, 3, 3]), ...writeLine(100, 135, [2])];
    const strokes = words.flat();
    const layout = smartInkLayout(strokes)!;
    const before = boxesAfter(strokes, words, []);
    const gapX = (before[0].maxX + before[1].minX) / 2;
    const after = boxesAfter(strokes, words, insertSpace(layout.paragraphs, { x: gapX, y: 110 }, 40, 100, before[2].maxX + 10)!);
    expect(after[1].minX - before[1].minX).toBeCloseTo(40);
    // The last word starts a row of its own at the left edge, where the second line was...
    expect(after[2].minX).toBeCloseTo(100 - 1);
    expect(after[2].minY).toBeCloseTo(before[3].minY, 0);
    // ...and the second line moves down a line.
    expect(after[3].minY).toBeGreaterThan(before[3].minY + H);
  });

  it('straightens a sloping line onto a level midline', () => {
    const words = writeLine(100, 100, [3, 3, 3, 3], 0.2);
    const strokes = words.flat();
    const layout = smartInkLayout(strokes)!;
    const moved = movedStrokes(strokes, straighten(layout.lines));
    const [line] = smartInkLayout(moved)!.lines;
    expect(Math.abs(line.slope)).toBeLessThan(0.02);
  });

  it('aligns lines left, centre and right', () => {
    const a = writeLine(100, 100, [3, 3]);
    const b = writeLine(160, 135, [2]);
    const strokes = [...a, ...b].flat();
    const { lines } = smartInkLayout(strokes)!;
    const left = Math.min(...lines.map((l) => l.box.minX));
    const right = Math.max(...lines.map((l) => l.box.maxX));
    for (const how of ['left', 'centre', 'right'] as const) {
      const after = smartInkLayout(movedStrokes(strokes, align(lines, how, left, right)))!.lines;
      const edge = (l: (typeof after)[number]) => (how === 'left' ? l.box.minX : how === 'right' ? l.box.maxX : (l.box.minX + l.box.maxX) / 2);
      expect(edge(after[0])).toBeCloseTo(edge(after[1]), 5);
    }
  });
});
