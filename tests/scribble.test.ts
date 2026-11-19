import { describe, expect, it } from 'vitest';
import type { Stroke } from '../src/core/model';
import { convexHull, isScribble, netTurns, scribbledStrokes } from '../src/core/scribble';
import { HANDWRITING, SCRIBBLES } from './fixtures/scribbles';

describe('scribble detection', () => {
  for (const [name, pts] of Object.entries(SCRIBBLES)) {
    it(`recognises a scribble: ${name}`, () => expect(isScribble(pts)).toBe(true));
  }
  for (const [name, pts] of Object.entries(HANDWRITING)) {
    it(`leaves handwriting alone: ${name}`, () => expect(isScribble(pts)).toBe(false));
  }

  it('tells zigzags (turns cancel out) from loops and spirals (keep turning one way)', () => {
    for (const pts of Object.values(SCRIBBLES)) expect(Math.abs(netTurns(pts))).toBeLessThan(1.5);
    expect(Math.abs(netTurns(HANDWRITING.spiral))).toBeGreaterThan(4);
    expect(Math.abs(netTurns(HANDWRITING['llll tall loops']))).toBeGreaterThan(4);
  });

  it('ignores tiny strokes and dots', () => {
    expect(isScribble([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(isScribble(Array.from({ length: 30 }, (_, i) => ({ x: i % 2 ? 4 : 0, y: i * 0.2 })))).toBe(false); // smaller than a letter
  });
});

describe('what a scribble erases', () => {
  const stroke = (id: string, pts: [number, number][]): Stroke => ({ id, tool: 'pen', color: '#000', width: 2, simulatePressure: false, points: pts.map(([x, y]) => ({ x: x, y, p: 0.5 })) });
  const word = stroke('word', Array.from({ length: 20 }, (_, i) => [10 + i * 5, 10 + (i % 3)] as [number, number]));
  const below = stroke('below', [[10, 60], [100, 62]]);
  const half = stroke('half', [[60, 8], [200, 8]]); // only partly under the scribble

  it('erases strokes that lie mostly under the scribble, and nothing else', () => {
    const scribble = SCRIBBLES['across a word'].map((p) => ({ x: p.x, y: p.y + 2 }));
    expect(scribbledStrokes(scribble, [word, below, half])).toEqual(['word']);
  });

  it('erases nothing over empty paper (the scribble stays as ink)', () => {
    const far = SCRIBBLES['across a word'].map((p) => ({ x: p.x + 500, y: p.y }));
    expect(scribbledStrokes(far, [word, below])).toEqual([]);
  });

  it('builds a convex hull', () => {
    const h = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }]);
    expect(h).toHaveLength(4);
  });
});
