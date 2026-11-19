// Split one written line into words by the horizontal gaps between strokes. No model: a word model
// (SimpleHTR) needs it. Task 10.1 moved the rule into the app (src/core/segment.ts).
//
// Tuned on 50 handwritten lines from the spike (2026-11-19): splitting at gaps wider than one letter
// height, and joining small marks to the word before them, matched the word count on 43/50 lines
// (the first version, at 0.55 letter heights with no marks rule, matched 10). Results were flat from
// 0.8 to 1.2 letter heights, so the numbers are not tuned to the last decimal.
import type { InputPoint } from '../../src/core/model';
import { splitWordBoxes } from '../../src/core/segment';

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

/**
 * Group strokes (by index) into words, left to right. The rule now lives in the app
 * (`splitWordBoxes` in src/core/segment.ts); this keeps the spike scoring the same rule.
 */
export function splitWords(strokes: readonly (readonly Pick<InputPoint, 'x' | 'y'>[])[], gapRatio = 1, markRatio = 0.7): number[][] {
  return splitWordBoxes(strokes.map(boxOf), gapRatio, markRatio);
}
