// Restyle spike (task 10.5): tidy a person's own handwriting with geometry alone, no model. Each line
// is levelled (words settled onto one straight baseline), its letters stood upright, its words
// brought to one size and spaced evenly, and its ink smoothed. The words, their order, the layout
// and the colour stay as written, which is what Goodnotes' Restyle promises; the strokes stay the
// person's own.
//
// Lines and words are found once, from the writing as it is, and every step works on those same
// words: re-finding them midway would let a word that grew run into its neighbour.
// Pure (core types only), so it is unit-tested and runs in the spike page.
import type { Stroke } from '../../src/core/model';
import { segmentLines } from '../../src/core/segment';
import { multiply, rotateAbout, transformStroke, translate, type Matrix } from '../../src/core/transform';
import { streamlinePoints } from '../../src/core/stabilise';

export interface RestyleOptions {
  level: boolean;
  upright: boolean;
  size: boolean;
  spacing: boolean;
  /** Extra steadying of the points, 0..1 (0 for none). */
  smooth: number;
}

export const FULL: RestyleOptions = { level: true, upright: true, size: true, spacing: true, smooth: 0.3 };

/** Lines of words, each word its strokes' ids, left to right. */
export type Layout = string[][][];

/** The lines and words of the writing. */
export const layoutOf = (strokes: readonly Stroke[]): Layout => segmentLines(strokes).map((l) => l.words.map((w) => w.strokeIds));

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
const boxOf = (strokes: readonly Stroke[]): Box => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of strokes) for (const p of s.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
};

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
}

/**
 * A word's letter height: the median height of its strokes at least a third as tall as its
 * tallest, so dots and crossings don't count.
 */
export function letterHeight(strokes: readonly Stroke[]): number {
  const hs = strokes.map((s) => boxOf([s])).map((b) => b.maxY - b.minY);
  const tall = Math.max(...hs);
  return median(hs.filter((h) => h >= 0.35 * tall));
}

/**
 * Where a word sits: the median bottom of its letter-sized strokes. Most letters end on the
 * baseline; descenders (g, p, y) and marks are the minority.
 */
export function wordBaseline(strokes: readonly Stroke[]): number {
  const boxes = strokes.map((s) => boxOf([s]));
  const tall = Math.max(...boxes.map((b) => b.maxY - b.minY));
  return median(boxes.filter((b) => b.maxY - b.minY >= 0.35 * tall).map((b) => b.maxY));
}

/**
 * The writing's slant: how far x moves per unit y along its near-vertical strokes (the down
 * strokes of letters), weighted by their length. Positive leans right (top to the right).
 */
export function slantOf(strokes: readonly Stroke[]): number {
  let sx = 0, sy = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.points.length; i++) {
      const dx = s.points[i].x - s.points[i - 1].x;
      const dy = s.points[i].y - s.points[i - 1].y;
      // Within 40° of vertical.
      if (Math.abs(dy) < 0.5 || Math.abs(dx) > Math.abs(dy) * Math.tan((40 * Math.PI) / 180)) continue;
      // Going up the page (dy < 0) to the right is a right lean, as is going down to the left.
      sx += -dx * Math.sign(dy);
      sy += Math.abs(dy);
    }
  }
  return sy ? sx / sy : 0;
}

/** Least-squares line through points: y at x. */
function linearFit(pts: { x: number; y: number }[]): { at: (x: number) => number; slope: number } {
  if (pts.length < 2) return { at: () => pts[0]?.y ?? 0, slope: 0 };
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let num = 0, den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const slope = den ? num / den : 0;
  return { at: (x) => my + slope * (x - mx), slope };
}

/** Shear about the baseline y = b so letters stand upright: x' = x + k·(y − b). */
const shear = (k: number, b: number): Matrix => [1, 0, k, 1, -k * b, 0];
/** Scale by `f` about a point. */
const scaleAt = (f: number, x: number, y: number): Matrix => [f, 0, 0, f, x * (1 - f), y * (1 - f)];

/** Tidy writing. Strokes that aren't on a line of writing (drawings, highlighter) are left alone. */
export function restyle(input: readonly Stroke[], o: RestyleOptions = FULL, layout: Layout = layoutOf(input)): Stroke[] {
  const byId = new Map(input.map((s) => [s.id, s]));
  const onLines = new Set(layout.flat(2));
  const get = (ids: string[]) => ids.map((id) => byId.get(id)!);
  const move = (ids: string[], m: Matrix) => {
    for (const id of ids) byId.set(id, transformStroke(byId.get(id)!, m));
  };

  // Smoothing first, so every later step measures the ink as it will be drawn.
  if (o.smooth > 0) {
    for (const id of onLines) {
      const s = byId.get(id)!;
      if (s.points.length > 2) byId.set(id, { ...s, points: streamlinePoints(s.points, o.smooth) });
    }
  }

  for (const words of layout) {
    const all = words.flat();
    const letter = median(words.map((w) => letterHeight(get(w))));

    // Level: a straight line through the words' baselines is turned level, and each word settles
    // onto it, by at most a third of a letter height (more would be a misjudged baseline, not a
    // bounce).
    if (o.level) {
      const pts = words.map((w) => {
        const b = boxOf(get(w));
        return { x: (b.minX + b.maxX) / 2, y: wordBaseline(get(w)) };
      });
      const fit = linearFit(pts);
      const line = boxOf(get(all));
      const level = fit.at((line.minX + line.maxX) / 2);
      const theta = -Math.atan(Math.max(-0.5, Math.min(0.5, fit.slope)));
      words.forEach((w, i) => {
        const bounce = Math.max(-letter / 3, Math.min(letter / 3, fit.at(pts[i].x) - pts[i].y));
        move(w, multiply(translate(0, level - fit.at(pts[i].x) + bounce), rotateAbout(theta, pts[i])));
      });
    }

    // Upright: shear about the baseline so the lean goes (a right lean moves the tops left).
    if (o.upright) {
      const k = slantOf(get(all));
      if (Math.abs(k) >= 0.03) move(all, shear(k, median(words.map((w) => wordBaseline(get(w))))));
    }

    // Size: each word scaled towards the line's letter height about the left end of its baseline,
    // by at most a quarter either way so a capital or a short word isn't distorted.
    if (o.size) {
      for (const w of words) {
        const f = Math.max(0.8, Math.min(1.25, letter / Math.max(1, letterHeight(get(w)))));
        if (Math.abs(f - 1) >= 0.08) move(w, scaleAt(f, boxOf(get(w)).minX, wordBaseline(get(w))));
      }
    }

    // Spacing: the words re-laid from where the line starts, with the line's median gap between them.
    if (o.spacing && words.length > 1) {
      const boxes = words.map((w) => boxOf(get(w)));
      const gaps = boxes.slice(1).map((b, i) => b.minX - boxes[i].maxX).filter((g) => g > 0);
      const gap = gaps.length ? median(gaps) : 0.6 * letter;
      let x = boxes[0].minX;
      words.forEach((w, i) => {
        move(w, translate(x - boxes[i].minX, 0));
        x += boxes[i].maxX - boxes[i].minX + gap;
      });
    }
  }
  return input.map((s) => byId.get(s.id)!);
}

/** How tidy writing is. Lower is tidier for every measure. */
export interface Neatness {
  /** Spread of the words' baselines about a straight line, in letter heights (bouncing words). */
  wobble: number;
  /** Lean of the letters from upright, in degrees. */
  slant: number;
  /** Spread of the words' letter heights, as a fraction of their median. */
  sizeSpread: number;
  /** Spread of the gaps between words, as a fraction of their median. */
  gapSpread: number;
}

const spread = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/**
 * Neatness of writing, averaged over its lines, measured on the given lines and words (pass the
 * layout found before tidying, so before and after are measured on the same words).
 */
export function neatness(strokes: readonly Stroke[], layout: Layout = layoutOf(strokes)): Neatness {
  const byId = new Map(strokes.map((s) => [s.id, s]));
  const get = (ids: string[]) => ids.map((id) => byId.get(id)!);
  const per = layout.map((words) => {
    const letter = Math.max(1, median(words.map((w) => letterHeight(get(w)))));
    const boxes = words.map((w) => boxOf(get(w)));
    const bases = words.map((w, i) => ({ x: (boxes[i].minX + boxes[i].maxX) / 2, y: wordBaseline(get(w)) }));
    const fit = linearFit(bases);
    const heights = words.map((w) => letterHeight(get(w)));
    const gaps = boxes.slice(1).map((b, i) => b.minX - boxes[i].maxX);
    return {
      wobble: spread(bases.map((c) => c.y - fit.at(c.x))) / letter,
      slant: Math.abs((Math.atan(slantOf(get(words.flat()))) * 180) / Math.PI),
      sizeSpread: spread(heights) / Math.max(1, median(heights)),
      gapSpread: gaps.length > 1 ? spread(gaps) / Math.max(1, Math.abs(median(gaps))) : 0,
    };
  });
  const avg = (k: keyof Neatness) => (per.length ? per.reduce((a, p) => a + p[k], 0) / per.length : 0);
  return { wobble: avg('wobble'), slant: avg('slant'), sizeSpread: avg('sizeSpread'), gapSpread: avg('gapSpread') };
}
