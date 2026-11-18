import { describe, expect, it } from 'vitest';
import { dashLengths, dotCentres, dotSpacing, splitDashes } from '../src/core/dash';
import type { InputPoint, Stroke } from '../src/core/model';
import { strokeOutlines, strokeSvgPath } from '../src/render/stroke';

/** A straight line `len` long, sampled every `step`, ending exactly at `len`. */
const line = (len: number, step = 3): InputPoint[] => {
  const pts = Array.from({ length: Math.floor(len / step) + 1 }, (_, i) => ({ x: i * step, y: 0, p: 0.5 }));
  if (pts.at(-1)!.x < len) pts.push({ x: len, y: 0, p: 0.5 });
  return pts;
};
const length = (pts: InputPoint[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

describe('dashed lines', () => {
  it('cuts a line into dashes of the set length with even gaps', () => {
    const dashes = splitDashes(line(100), 10, 5);
    expect(dashes).toHaveLength(7); // 0-10, 15-25, … 90-100
    for (const d of dashes) expect(length(d)).toBeCloseTo(10, 5);
    expect(dashes[1][0].x).toBeCloseTo(15, 5);
    expect(dashes[6].at(-1)!.x).toBeCloseTo(100, 5);
  });

  it('keeps the rhythm round corners, whatever the point spacing', () => {
    const corner: InputPoint[] = [{ x: 0, y: 0, p: 0.5 }, { x: 7, y: 0, p: 0.5 }, { x: 7, y: 23, p: 0.5 }];
    const dashes = splitDashes(corner, 6, 4);
    expect(dashes.map((d) => Math.round(length(d) * 100) / 100)).toEqual([6, 6, 6]);
  });

  it('carries pressure along, interpolated at the cuts', () => {
    const pts: InputPoint[] = [{ x: 0, y: 0, p: 0 }, { x: 100, y: 0, p: 1 }];
    const [, second] = splitDashes(pts, 10, 10);
    expect(second[0].p).toBeCloseTo(0.2, 5);
  });

  it('places dots evenly along the line', () => {
    const dots = dotCentres(line(100, 7), 10);
    expect(dots).toHaveLength(11);
    dots.forEach((d, i) => expect(d.x).toBeCloseTo(i * 10, 5));
  });

  it('scales with the line width', () => {
    expect(dashLengths(4).on).toBeGreaterThan(dashLengths(1).on);
    expect(dotSpacing(6)).toBeGreaterThan(dotSpacing(1));
  });
});

describe('dashed strokes', () => {
  const stroke = (dash?: Stroke['dash']): Stroke => ({ id: 's', tool: 'pen', penStyle: 'ball', color: '#000', width: 3, simulatePressure: false, points: line(200), ...(dash ? { dash } : {}) });

  it('draws one outline when solid, one per dash or dot otherwise', () => {
    expect(strokeOutlines(stroke().points, stroke(), true)).toHaveLength(1);
    expect(strokeOutlines(stroke('dashed').points, stroke('dashed'), true).length).toBeGreaterThan(8);
    expect(strokeOutlines(stroke('dotted').points, stroke('dotted'), true).length).toBe(Math.floor(200 / dotSpacing(3)) + 1);
  });

  it('exports each dash as its own closed shape', () => {
    const d = strokeSvgPath(stroke('dashed'));
    expect(d.match(/M/g)!.length).toBe(strokeOutlines(stroke('dashed').points, stroke('dashed'), true).length);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('ignores dashes on the highlighter', () => {
    const h: Stroke = { ...stroke('dashed'), tool: 'highlighter' };
    expect(strokeOutlines(h.points, h, true)).toHaveLength(1);
  });
});
