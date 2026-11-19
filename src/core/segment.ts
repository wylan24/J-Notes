// Group handwriting into lines, words and paragraphs, from stroke geometry alone (no model).
// Smart Ink (reflow, straighten, align) moves the words this finds; handwriting recognition reads
// the lines.
//
// Word splitting is the rule tuned in the recognition spike (task 10.0) on 50 handwritten lines:
// a gap wider than one letter height starts a new word, and small marks (commas, full stops)
// join the word before them. That matched the word count on 43/50 lines.
import type { Stroke } from './model';
import type { Bounds } from './geometry';

export interface InkWord {
  /** Its strokes, in page order. */
  strokeIds: string[];
  /** Box of the strokes' points (not widened by the pen width). */
  box: Bounds;
}

export interface InkLine {
  /** Every stroke on the line, in page order. */
  strokeIds: string[];
  /** Left to right. */
  words: InkWord[];
  box: Bounds;
  /** Typical letter height on this line, page units. */
  letter: number;
  /** The line's midline: y = mid + slope × (x − box.minX). */
  mid: number;
  slope: number;
}

export interface InkParagraph {
  /** Top to bottom. */
  lines: InkLine[];
}

/** The y of a line's midline at `x`. */
export const midAt = (line: Pick<InkLine, 'mid' | 'slope' | 'box'>, x: number): number => line.mid + line.slope * (x - line.box.minX);

/** Strokes that can be handwriting: pen ink that isn't a recognised shape. */
export const isWriting = (s: Stroke): boolean => s.tool === 'pen' && !s.shape && s.points.length > 0;

function pointsBox(s: Stroke): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

const union = (a: Bounds, b: Bounds): Bounds => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) });
const height = (b: Bounds) => b.maxY - b.minY;
const width = (b: Bounds) => b.maxX - b.minX;
const cx = (b: Bounds) => (b.minX + b.maxX) / 2;
const cy = (b: Bounds) => (b.minY + b.maxY) / 2;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

/**
 * The typical letter height of one line: the median height of strokes at least a third as tall as
 * the tallest, so i-dots, t-crossings and commas don't drag it down. (The spike's rule.)
 */
export function lineLetterHeight(boxes: readonly Bounds[]): number {
  const heights = boxes.map(height).sort((a, b) => a - b);
  if (!heights.length) return 0;
  const tall = heights.filter((x) => x >= 0.35 * heights[heights.length - 1]);
  return Math.max(4, tall[tall.length >> 1]);
}

/**
 * The typical letter height of a page of writing, where a drawing may be far taller than any
 * letter: the median of the strokes between half and three times the median height.
 */
export function pageLetterHeight(boxes: readonly Bounds[]): number {
  const med = median(boxes.map(height));
  const letters = boxes.map(height).filter((h) => h >= 0.5 * med && h <= 3 * med);
  return Math.max(4, median(letters));
}

interface Item {
  i: number;
  b: Bounds;
}

/**
 * Split one line's strokes into words, left to right: a stroke joins the word on its left while
 * the gap to it is at most `gapRatio` letter heights, and a cluster smaller than `markRatio` letter
 * heights both ways (a comma or full stop written apart) joins the word before it.
 */
export function splitWordBoxes(boxes: readonly Bounds[], gapRatio = 1, markRatio = 0.7): number[][] {
  const items = boxes.map((b, i) => ({ i, b })).filter(({ b }) => Number.isFinite(b.minX));
  if (!items.length) return [];
  const letter = lineLetterHeight(items.map(({ b }) => b));
  items.sort((a, b) => a.b.minX - b.b.minX);
  const clusters: { ids: number[]; b: Bounds }[] = [];
  for (const { i, b } of items) {
    const last = clusters[clusters.length - 1];
    if (last && b.minX - last.b.maxX <= gapRatio * letter) {
      last.ids.push(i);
      last.b = union(last.b, b);
    } else {
      clusters.push({ ids: [i], b });
    }
  }
  const words: { ids: number[]; b: Bounds }[] = [];
  for (const c of clusters) {
    const mark = width(c.b) < markRatio * letter && height(c.b) < markRatio * letter;
    const prev = words[words.length - 1];
    if (prev && mark) {
      prev.ids.push(...c.ids);
      prev.b = union(prev.b, c.b);
    } else {
      words.push({ ids: [...c.ids], b: c.b });
    }
  }
  // A comma or full stop written nearer the next word than its own ("milk ,eggs") still ends the
  // word before: a small mark leading a word, low on the line, moves back.
  for (let k = 1; k < words.length; k++) {
    const w = words[k];
    const order = w.ids.slice().sort((a, b) => boxes[a].minX - boxes[b].minX);
    const first = boxes[order[0]];
    const small = width(first) < markRatio * letter && height(first) < markRatio * letter;
    if (order.length > 1 && small && cy(first) > cy(w.b)) {
      w.ids = order.slice(1);
      w.b = w.ids.map((i) => boxes[i]).reduce(union);
      words[k - 1].ids.push(order[0]);
      words[k - 1].b = union(words[k - 1].b, first);
    }
  }
  return words.map((w) => w.ids.sort((a, b) => a - b));
}

/** Least-squares slope of the points, weighted, clamped to ±0.5 (about 27°). */
function fitSlope(pts: { x: number; y: number; w: number }[]): number {
  let sw = 0, sx = 0, sy = 0;
  for (const p of pts) {
    sw += p.w;
    sx += p.w * p.x;
    sy += p.w * p.y;
  }
  if (!sw) return 0;
  const mx = sx / sw, my = sy / sw;
  let num = 0, den = 0;
  for (const p of pts) {
    num += p.w * (p.x - mx) * (p.y - my);
    den += p.w * (p.x - mx) ** 2;
  }
  return den ? Math.max(-0.5, Math.min(0.5, num / den)) : 0;
}

interface Building {
  items: Item[];
  /** The last few letter-sized strokes, newest last: the band the line is running in. */
  recent: Bounds[];
  maxX: number;
}

/** The vertical band a line in progress occupies, from its last few strokes. */
function band(l: Building): { top: number; bottom: number } {
  return { top: median(l.recent.map((b) => b.minY)), bottom: median(l.recent.map((b) => b.maxY)) };
}

function joinPieces(lines: Building[], letter: number): Building[] {
  const out = lines.slice().sort((a, b) => Math.min(...a.items.map((x) => x.b.minX)) - Math.min(...b.items.map((x) => x.b.minX)));
  const whole = (l: Building) => ({ top: median(l.items.map((x) => x.b.minY)), bottom: median(l.items.map((x) => x.b.maxY)) });
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) {
      for (let j = 0; j < out.length && !changed; j++) {
        const a = out[i], b = out[j];
        if (i === j) continue;
        const bMin = Math.min(...b.items.map((x) => x.b.minX));
        const gap = bMin - a.maxX;
        if (gap < -letter || gap > 6 * letter) continue;
        // The end of a and the start of b, compared band to band.
        const ea = whole({ ...a, items: a.items.slice(-5) });
        const sb = whole({ ...b, items: b.items.slice(0, 5) });
        const overlap = Math.min(ea.bottom, sb.bottom) - Math.max(ea.top, sb.top);
        if (overlap / Math.max(1, Math.min(ea.bottom - ea.top, sb.bottom - sb.top)) < 0.5) continue;
        a.items.push(...b.items);
        a.maxX = Math.max(a.maxX, b.maxX);
        out.splice(j, 1);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * Group strokes into lines of writing, top to bottom. Strokes that aren't writing (highlighter,
 * shapes) and strokes far taller than the writing around them (drawings) are left out.
 */
export function segmentLines(strokes: readonly Stroke[]): InkLine[] {
  const all = strokes.map((s, i) => ({ i, b: pointsBox(s) })).filter(({ i, b }) => isWriting(strokes[i]) && Number.isFinite(b.minX));
  if (!all.length) return [];
  const letter = pageLetterHeight(all.map(({ b }) => b));
  const text = all.filter(({ b }) => height(b) <= 3.5 * letter || width(b) <= 0.6 * letter);
  // Letter-sized strokes find the lines; flat or small marks (dots, commas, dashes, t-crossings)
  // join the nearest line after.
  const isMark = (b: Bounds) => height(b) < 0.4 * letter;
  const seeds = text.filter(({ b }) => !isMark(b)).sort((a, b) => a.b.minX - b.b.minX);
  const marks = text.filter(({ b }) => isMark(b));

  const lines: Building[] = [];
  for (const it of seeds) {
    // Join the line whose band this stroke overlaps most (as a share of the shorter of the two),
    // so a capital or a descender joins the small letters beside it.
    let best: Building | null = null;
    let bestScore = 0;
    for (const l of lines) {
      if (it.b.minX - l.maxX > 6 * letter) continue; // too far right: another column
      const { top, bottom } = band(l);
      const overlap = Math.min(bottom, it.b.maxY) - Math.max(top, it.b.minY);
      const score = overlap / Math.max(1, Math.min(bottom - top, height(it.b)));
      // Between equal overlaps, the nearer centre wins.
      const tie = -Math.abs(cy(it.b) - (top + bottom) / 2) / (100 * letter);
      if (score >= 0.3 && score + tie > bestScore) {
        best = l;
        bestScore = score + tie;
      }
    }
    if (best) {
      best.items.push(it);
      best.recent.push(it.b);
      if (best.recent.length > 5) best.recent.shift();
      best.maxX = Math.max(best.maxX, it.b.maxX);
    } else {
      lines.push({ items: [it], recent: [it.b], maxX: it.b.maxX });
    }
  }

  // A line can break in two where the writing drifts up or down; join pieces that continue each
  // other on the same band.
  const joined = joinPieces(lines, letter);
  // A piece too small to be a line on its own (a comma, the tail of a letter) joins the nearest
  // line as a mark.
  const fragment = (l: Building) => l.items.length <= 2 && l.maxX - Math.min(...l.items.map((x) => x.b.minX)) < 1.5 * letter;
  marks.push(...joined.filter(fragment).flatMap((l) => l.items));
  const kept = joined.filter((l) => !fragment(l));

  // Each line's midline, from its letter-sized strokes.
  const fitted = kept.map((l) => {
    const box = l.items.map((x) => x.b).reduce(union);
    const slope = width(box) < 3 * letter ? 0 : fitSlope(l.items.map(({ b }) => ({ x: cx(b), y: cy(b), w: Math.max(1, width(b)) })));
    // The midline passes through the weighted centre of the strokes.
    let sw = 0, sy = 0;
    for (const { b } of l.items) {
      const w = Math.max(1, width(b));
      sw += w;
      sy += w * (cy(b) - slope * (cx(b) - box.minX));
    }
    return { items: l.items, box, slope, mid: sy / sw, x0: box.minX };
  });

  // Marks join the line whose midline is nearest (an i-dot sits closer to its own line's midline
  // than to the descenders of the line above), if one is near enough and spans them.
  for (const m of marks) {
    let best: (typeof fitted)[number] | null = null;
    let bestD = Infinity;
    for (const l of fitted) {
      if (m.b.maxX < l.box.minX - letter || m.b.minX > l.box.maxX + letter) continue;
      const d = Math.abs(cy(m.b) - (l.mid + l.slope * (cx(m.b) - l.x0)));
      if (d < bestD) {
        best = l;
        bestD = d;
      }
    }
    if (best && bestD <= 1.5 * letter) {
      best.items.push(m);
      best.box = union(best.box, m.b);
    } else {
      fitted.push({ items: [m], box: m.b, slope: 0, mid: cy(m.b), x0: m.b.minX });
    }
  }

  const out = fitted.map((l): InkLine => {
    const items = l.items.slice().sort((a, b) => a.i - b.i);
    const boxes = items.map((x) => x.b);
    const words = splitWordBoxes(boxes).map((idx): InkWord => ({
      strokeIds: idx.map((k) => strokes[items[k].i].id),
      box: idx.map((k) => boxes[k]).reduce(union),
    }));
    // The midline was fitted at x0; the box may have grown left with marks since.
    const mid = l.mid + l.slope * (l.box.minX - l.x0);
    return { strokeIds: items.map((x) => strokes[x.i].id), words, box: l.box, letter: lineLetterHeight(boxes), mid, slope: l.slope };
  });
  return out.sort((a, b) => midAt(a, a.box.minX) - midAt(b, b.box.minX) || a.box.minX - b.box.minX);
}

/** Group lines (top to bottom) into paragraphs. */
export function paragraphs(lines: readonly InkLine[]): InkParagraph[] {
  // A line continues the paragraph above when it is no further below it than the usual spacing
  // between lines here (a blank line starts a new paragraph), sits under it, and is a similar size.
  const follows = (last: InkLine, line: InkLine) => {
    const overlap = Math.min(last.box.maxX, line.box.maxX) - Math.max(last.box.minX, line.box.minX);
    const size = Math.max(last.letter, line.letter) / Math.max(1, Math.min(last.letter, line.letter));
    return overlap > 0 && size < 1.6;
  };
  const pitchOf = (last: InkLine, line: InkLine) => midAt(line, line.box.minX) - midAt(last, line.box.minX);
  // The usual spacing: the lower median of the gaps between lines that follow one another.
  const pitches = lines
    .slice(1)
    .map((l, i) => (follows(lines[i], l) ? pitchOf(lines[i], l) : 0))
    .filter((p) => p > 0)
    .sort((a, b) => a - b);
  const usual = pitches.length ? pitches[(pitches.length - 1) >> 1] : Infinity;
  const paras: InkParagraph[] = [];
  for (const line of lines) {
    const para = paras.find((p) => {
      const last = p.lines[p.lines.length - 1];
      const pitch = pitchOf(last, line);
      const letter = Math.max(last.letter, line.letter);
      return follows(last, line) && pitch > 0 && pitch <= 4 * letter && pitch <= 1.5 * usual;
    });
    if (para) para.lines.push(line);
    else paras.push({ lines: [line] });
  }
  return paras;
}

/** Lines and paragraphs of the writing in `strokes`. */
export function segment(strokes: readonly Stroke[]): { lines: InkLine[]; paragraphs: InkParagraph[] } {
  const lines = segmentLines(strokes);
  return { lines, paragraphs: paragraphs(lines) };
}
