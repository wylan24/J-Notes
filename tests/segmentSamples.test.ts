// Segmentation on real handwriting: the 50 lines written with the Pencil for the recognition spike
// (task 10.0). The samples are kept out of git (spike/hwr/data/), so this runs only where they are.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Stroke } from '../src/core/model';
import { segmentLines } from '../src/core/segment';

const FILE = 'spike/hwr/data/samples.json';
type Sample = { prompt: string; strokes: { points: { x: number; y: number; p: number }[] }[] };
const samples: Sample[] = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')).samples : [];

const toStrokes = (s: Sample, tag: string, dx = 0, dy = 0): Stroke[] =>
  s.strokes.map((st, i) => ({ id: `${tag}:${i}`, tool: 'pen', color: '#000', width: 3, simulatePressure: false, points: st.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }));

describe.skipIf(!samples.length)('segmentation on the spike’s handwriting', () => {
  it('finds each written line as one line, and its words as the spike did', () => {
    let oneLine = 0, wordsRight = 0;
    for (const [i, s] of samples.entries()) {
      const lines = segmentLines(toStrokes(s, `${i}`));
      if (lines.length === 1) oneLine++;
      if (lines.reduce((n, l) => n + l.words.length, 0) === s.prompt.split(' ').length) wordsRight++;
    }
    expect(oneLine).toBe(50);
    // The spike's tuned split matched 43/50; the rest have a / - or ? written apart.
    expect(wordsRight).toBeGreaterThanOrEqual(43);
  });

  it('separates lines stacked into pages, when lines are about their own height apart', () => {
    const letter = 17; // the samples' median letter height
    for (let p = 0; p < 5; p++) {
      const strokes = samples.slice(p * 10, p * 10 + 10).flatMap((s, i) => {
        const pts = s.strokes.flatMap((st) => st.points);
        const top = Math.min(...pts.map((q) => q.y)), bottom = Math.max(...pts.map((q) => q.y));
        return toStrokes(s, `${i}`, 40 - Math.min(...pts.map((q) => q.x)), 100 + i * 2.5 * letter - (top + bottom) / 2);
      });
      const lines = segmentLines(strokes);
      expect(lines).toHaveLength(10);
      lines.forEach((l, i) => expect(new Set(l.strokeIds.map((id) => id.split(':')[0]))).toEqual(new Set([`${i}`])));
    }
  });
});
