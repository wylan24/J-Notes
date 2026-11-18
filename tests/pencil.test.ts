import { describe, expect, it } from 'vitest';
import { dabsByLevel, PENCIL_LEVELS, pencilAlpha, pencilDabs } from '../src/core/pencil';
import type { InputPoint } from '../src/core/model';

const line = (n: number, step: number, p = 0.5): InputPoint[] => Array.from({ length: n }, (_, i) => ({ x: i * step, y: 0, p }));

describe('pencil', () => {
  it('lays dabs evenly along the stroke, a fraction of the width apart', () => {
    const dabs = pencilDabs(line(11, 10), 4, false); // 100 units long
    const gaps = dabs.slice(1).map((d, i) => d.x - dabs[i].x);
    expect(dabs.length).toBeGreaterThan(70);
    for (const g of gaps) expect(g).toBeCloseTo(1.2, 5);
  });

  it('makes a single dab for a tap, and none for no points', () => {
    expect(pencilDabs([{ x: 5, y: 5, p: 0.5 }], 3, false)).toHaveLength(1);
    expect(pencilDabs([], 3, false)).toEqual([]);
  });

  it('darkens with pressure', () => {
    const light = pencilDabs(line(5, 10, 0.1), 3, false);
    const hard = pencilDabs(line(5, 10, 1), 3, false);
    expect(light[0].level).toBeLessThan(hard[0].level);
    expect(hard[0].level).toBe(PENCIL_LEVELS - 1);
    expect(hard[0].r).toBeGreaterThan(light[0].r);
  });

  it('blends pressure between points', () => {
    const pts: InputPoint[] = [{ x: 0, y: 0, p: 0.1 }, { x: 40, y: 0, p: 1 }];
    const levels = pencilDabs(pts, 3, false).map((d) => d.level);
    expect(levels[0]).toBeLessThan(levels[levels.length - 1]);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels); // never gets lighter along the way
  });

  it('with simulated pressure, fast strokes are lighter than slow ones', () => {
    const slow = pencilDabs(line(20, 1), 3, true);
    const fast = pencilDabs(line(20, 30), 3, true);
    const mean = (d: { level: number }[]) => d.reduce((s, x) => s + x.level, 0) / d.length;
    expect(mean(fast)).toBeLessThan(mean(slow));
  });

  it('groups dabs by level for painting, with opacity rising by level', () => {
    const groups = dabsByLevel(pencilDabs([{ x: 0, y: 0, p: 0.1 }, { x: 60, y: 0, p: 1 }], 3, false));
    expect(groups.size).toBeGreaterThan(3);
    expect(pencilAlpha(0)).toBeGreaterThan(0.1);
    expect(pencilAlpha(PENCIL_LEVELS - 1)).toBeLessThanOrEqual(1);
    expect(pencilAlpha(3)).toBeGreaterThan(pencilAlpha(2));
  });
});
