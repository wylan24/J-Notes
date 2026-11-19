// Smart Ink: rearrange handwriting by moving whole words, found by segmentation (./segment).
// Reflow wraps paragraphs to a new width, insert space opens a gap before a word (pushing the
// rest of the line along), straighten levels sloping lines, and align lines them up left, centre
// or right.
// Everything is a list of word moves, turned into ordinary stroke ops (one undo step).
import type { Page, Stroke } from './model';
import type { DocOp } from './ops';
import { isIdentity, multiply, rotateAbout, transformStroke, translate, type Matrix } from './transform';
import { midAt, segment, type InkLine, type InkParagraph, type InkWord } from './segment';

/** Strokes to move together, and how. */
export interface InkMove {
  strokeIds: string[];
  m: Matrix;
}

export type Align = 'left' | 'centre' | 'right';

const cx = (w: InkWord) => (w.box.minX + w.box.maxX) / 2;
const cy = (w: InkWord) => (w.box.minY + w.box.maxY) / 2;

function median(xs: number[], fallback: number): number {
  if (!xs.length) return fallback;
  const s = xs.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** Writing that Smart Ink can work on: the strokes segment into at least one line, and every stroke is on one. */
export function smartInkLayout(strokes: readonly Stroke[]): { lines: InkLine[]; paragraphs: InkParagraph[] } | null {
  if (!strokes.length) return null;
  const s = segment(strokes);
  const covered = s.lines.reduce((n, l) => n + l.strokeIds.length, 0);
  return s.lines.length && covered === strokes.length ? s : null;
}

/** The space between words, from the gaps between neighbouring words on the same line. */
function wordGap(lines: readonly InkLine[]): number {
  const gaps = lines.flatMap((l) => l.words.slice(1).map((w, i) => w.box.minX - l.words[i].box.maxX)).filter((g) => g > 0);
  return median(gaps, 0.7 * median(lines.map((l) => l.letter), 16));
}

/** The distance between one line's midline and the next. */
function linePitch(p: InkParagraph): number {
  const pitches = p.lines.slice(1).map((l, i) => midAt(l, l.box.minX) - midAt(p.lines[i], l.box.minX));
  const letter = Math.max(...p.lines.map((l) => l.letter));
  return median(pitches, Math.max(1.8 * letter, ...p.lines.map((l) => l.box.maxY - l.box.minY + 0.4 * letter)));
}

/** The narrowest width every paragraph can be wrapped to: its widest word. */
export function minReflowWidth(paras: readonly InkParagraph[]): number {
  return Math.max(1, ...paras.flatMap((p) => p.lines.flatMap((l) => l.words.map((w) => w.box.maxX - w.box.minX))));
}

/**
 * Wrap each paragraph's words into lines no wider than `width`, starting at `left`. Words keep
 * their height relative to their line (so descenders stay down) and land on level lines spaced as
 * the paragraph's were. Paragraphs below one that grew or shrank move to keep their spacing.
 * `extraBefore` adds space before particular words (by first stroke id).
 */
export function reflow(paras: readonly InkParagraph[], left: number, width: number, extraBefore: ReadonlyMap<string, number> = new Map()): InkMove[] {
  const moves: InkMove[] = [];
  const lines = paras.flatMap((p) => p.lines);
  const gap = wordGap(lines);
  const right = left + Math.max(width, minReflowWidth(paras));
  let shift = 0;
  for (const p of paras) {
    const pitch = linePitch(p);
    const top = midAt(p.lines[0], p.lines[0].box.minX) + shift;
    let x = left;
    let row = 0;
    let first = true;
    for (const line of p.lines) {
      for (const w of line.words) {
        const ww = w.box.maxX - w.box.minX;
        x += extraBefore.get(w.strokeIds[0]) ?? 0;
        if (!first && x + ww > right + 0.5) {
          row++;
          x = left + (extraBefore.get(w.strokeIds[0]) ?? 0);
        }
        // Keep the word's offset from its line's midline.
        const off = cy(w) - midAt(line, cx(w));
        const dx = x - w.box.minX;
        const dy = top + row * pitch + off - cy(w);
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) moves.push({ strokeIds: w.strokeIds, m: translate(dx, dy) });
        x += ww + gap;
        first = false;
      }
    }
    shift += (row + 1 - p.lines.length) * pitch;
  }
  return moves;
}

/**
 * Open a gap of `space` before the word after `at`, as typing a space would: the rest of that line
 * moves right, and words pushed past `right` go onto a new row below it, starting at `left`, with
 * everything further down moved down a line to make room. Nothing else moves. Null when `at` isn't
 * on a line of writing.
 */
export function insertSpace(paras: readonly InkParagraph[], at: { x: number; y: number }, space: number, left: number, right: number): InkMove[] | null {
  const lines = paras.flatMap((p) => p.lines);
  let line: InkLine | null = null;
  let best = Infinity;
  for (const l of lines) {
    const d = Math.abs(at.y - midAt(l, at.x));
    if (d < best && d <= Math.max(l.letter, (l.box.maxY - l.box.minY) / 2 + 4)) {
      best = d;
      line = l;
    }
  }
  if (!line) return null;
  let from = line.words.findIndex((w) => cx(w) > at.x);
  if (from < 0) {
    // After the last word: the space goes before the first word of the next line in the paragraph.
    const para = paras.find((p) => p.lines.includes(line!))!;
    const next = para.lines[para.lines.indexOf(line) + 1];
    if (!next) return [];
    line = next;
    from = 0;
  }
  const moves: InkMove[] = [];
  const pushed = line.words.slice(from);
  // The first word on a row always stays on it, however far it is pushed.
  const keep = pushed.filter((w, i) => (from === 0 && i === 0) || w.box.maxX + space <= right);
  const wrap = pushed.slice(keep.length);
  for (const w of keep) moves.push({ strokeIds: w.strokeIds, m: translate(space, 0) });
  if (!wrap.length) return moves;
  // A new row under the line, spaced as the paragraph's lines are, for the words that no longer fit.
  const para = paras.find((p) => p.lines.includes(line!))!;
  const pitch = linePitch(para);
  const dx = left - wrap[0].box.minX;
  for (const w of wrap) {
    const off = cy(w) - midAt(line, cx(w));
    const dy = midAt(line, line.box.minX) + pitch + off - cy(w);
    moves.push({ strokeIds: w.strokeIds, m: translate(dx, dy) });
  }
  // Everything below moves down a line.
  const y = midAt(line, line.box.minX);
  for (const l of lines) if (l !== line && midAt(l, line.box.minX) > y) moves.push({ strokeIds: l.strokeIds, m: translate(0, pitch) });
  return moves;
}

/** Level each line about its centre: every word is turned by the line's slope and moved onto a level midline. */
export function straighten(lines: readonly InkLine[]): InkMove[] {
  const moves: InkMove[] = [];
  for (const line of lines) {
    if (Math.abs(line.slope) < 1e-3) continue;
    const target = midAt(line, (line.box.minX + line.box.maxX) / 2);
    const theta = -Math.atan(line.slope);
    for (const w of line.words) {
      const c = { x: cx(w), y: cy(w) };
      const m = multiply(translate(0, target - midAt(line, c.x)), rotateAbout(theta, c));
      moves.push({ strokeIds: w.strokeIds, m });
    }
  }
  return moves;
}

/** Line up the lines' left edges, centres or right edges, within `left`..`right`. */
export function align(lines: readonly InkLine[], how: Align, left: number, right: number): InkMove[] {
  const moves: InkMove[] = [];
  for (const line of lines) {
    const dx =
      how === 'left' ? left - line.box.minX : how === 'right' ? right - line.box.maxX : (left + right) / 2 - (line.box.minX + line.box.maxX) / 2;
    if (Math.abs(dx) > 0.01) moves.push({ strokeIds: line.strokeIds, m: translate(dx, 0) });
  }
  return moves;
}

const isTranslation = (m: Matrix) => Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;

/** The ops that make the moves on `page`: one undo step when dispatched together. Moves that are the same translation share an op. */
export function moveOps(page: Pick<Page, 'id'>, moves: readonly InkMove[]): DocOp[] {
  const ops: DocOp[] = [];
  const byShift = new Map<string, string[]>();
  for (const { strokeIds, m } of moves) {
    if (isIdentity(m)) continue;
    if (isTranslation(m)) {
      const key = `${m[4]},${m[5]}`;
      byShift.set(key, [...(byShift.get(key) ?? []), ...strokeIds]);
    } else {
      ops.push({ type: 'strokes.transformed', pageId: page.id, ids: strokeIds, matrix: m });
    }
  }
  for (const [key, ids] of byShift) {
    const [dx, dy] = key.split(',').map(Number);
    ops.push({ type: 'strokes.translated', pageId: page.id, ids, dx, dy });
  }
  return ops;
}

/** The strokes as they would be after the moves (for a preview while dragging). */
export function movedStrokes(strokes: readonly Stroke[], moves: readonly InkMove[]): Stroke[] {
  const byId = new Map<string, Matrix>();
  for (const { strokeIds, m } of moves) for (const id of strokeIds) byId.set(id, m);
  return strokes.map((s) => {
    const m = byId.get(s.id);
    return m ? transformStroke(s, m) : s;
  });
}
