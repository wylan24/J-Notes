// Split one written line into words by the horizontal gaps between strokes. No model: a word model
// (SimpleHTR) needs it, and task 10.1 builds the full version (lines as well as words).
//
// Tuned on 50 handwritten lines from the spike (2026-11-19): splitting at gaps wider than one letter
// height, and joining small marks to the word before them, matched the word count on 43/50 lines
// (the first version, at 0.55 letter heights with no marks rule, matched 10). Results were flat from
// 0.8 to 1.2 letter heights, so the numbers are not tuned to the last decimal.
import type { InputPoint } from '../../src/core/model';

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function boxOf(points: readonly Pick<InputPoint, 'x' | 'y'>[]): Box {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

const union = (a: Box, b: Box): Box => ({ minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY) });

/**
 * The typical letter height: the median height of the strokes at least a third as tall as the
 * tallest, so i-dots, t-crossings and commas don't drag it down.
 */
export function letterHeight(boxes: readonly Box[]): number {
  const heights = boxes.map((b) => b.maxY - b.minY).sort((a, b) => a - b);
  if (!heights.length) return 0;
  const tall = heights.filter((x) => x >= 0.35 * heights[heights.length - 1]);
  return Math.max(4, tall[tall.length >> 1]);
}

/**
 * Group strokes (by index) into words, left to right. Strokes join a cluster while the gap to it is
 * at most `gapRatio` letter heights; a cluster smaller than `markRatio` letter heights both ways (a
 * comma, colon or full stop written apart) joins the word before it.
 */
export function splitWords(strokes: readonly (readonly Pick<InputPoint, 'x' | 'y'>[])[], gapRatio = 1, markRatio = 0.7): number[][] {
  const boxes = strokes.map((s, i) => ({ i, b: boxOf(s) })).filter(({ b }) => Number.isFinite(b.minX));
  if (!boxes.length) return [];
  const letter = letterHeight(boxes.map(({ b }) => b));
  boxes.sort((a, b) => a.b.minX - b.b.minX);
  const clusters: { ids: number[]; b: Box }[] = [];
  for (const { i, b } of boxes) {
    const last = clusters[clusters.length - 1];
    if (last && b.minX - last.b.maxX <= gapRatio * letter) {
      last.ids.push(i);
      last.b = union(last.b, b);
    } else {
      clusters.push({ ids: [i], b });
    }
  }
  const words: { ids: number[]; b: Box }[] = [];
  for (const c of clusters) {
    const mark = c.b.maxX - c.b.minX < markRatio * letter && c.b.maxY - c.b.minY < markRatio * letter;
    const prev = words[words.length - 1];
    if (prev && mark) {
      prev.ids.push(...c.ids);
      prev.b = union(prev.b, c.b);
    } else {
      words.push({ ids: [...c.ids], b: c.b });
    }
  }
  return words.map((w) => w.ids.sort((a, b) => a - b));
}
