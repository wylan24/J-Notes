import { describe, expect, it } from 'vitest';
import { DEFAULT_STABILISE, normaliseStabilise, stabiliseOptions, streamlinePoints } from '../src/core/stabilise';
import type { InputPoint, Stroke } from '../src/core/model';
import { strokeOutline } from '../src/render/stroke';

// A shaky horizontal line: alternating ±3 off the axis.
const shaky: InputPoint[] = Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: i % 2 ? 3 : -3, p: 0.5 }));
const wobble = (pts: { y: number }[]) => pts.slice(1, -1).reduce((s, p) => s + Math.abs(p.y), 0) / (pts.length - 2);

describe('stabilisation', () => {
  it('maps 0–100% onto the stroke engine, more meaning steadier', () => {
    const low = stabiliseOptions(0);
    const high = stabiliseOptions(1);
    expect(low.streamline).toBeLessThan(high.streamline);
    expect(low.smoothing).toBeLessThan(high.smoothing);
    expect(high.streamline).toBeLessThan(1); // never stops following the pen
  });

  it('defaults to roughly the steadiness pens had before the setting', () => {
    expect(stabiliseOptions(DEFAULT_STABILISE).streamline).toBeCloseTo(0.34, 2); // fountain pens used 0.35
  });

  it('reads saved values, clamped', () => {
    expect(normaliseStabilise(2)).toBe(1);
    expect(normaliseStabilise(-1)).toBe(0);
    expect(normaliseStabilise('x')).toBe(DEFAULT_STABILISE);
  });

  it('steadies raw points more as it goes up, keeping both ends', () => {
    const none = streamlinePoints(shaky, 0);
    const some = streamlinePoints(shaky, 0.5);
    const lots = streamlinePoints(shaky, 1);
    expect(none).toEqual(shaky);
    expect(wobble(lots)).toBeLessThan(wobble(some));
    expect(wobble(some)).toBeLessThan(wobble(shaky));
    expect(lots[0]).toEqual(shaky[0]);
    expect(lots.at(-1)).toEqual(shaky.at(-1));
  });

  it('changes how a stroke is drawn, but not strokes written before the setting', () => {
    const base: Stroke = { id: 's', tool: 'pen', penStyle: 'ball', color: '#000', width: 3, simulatePressure: false, points: shaky };
    const old = strokeOutline(shaky, base, true);
    const steady = strokeOutline(shaky, { ...base, stabilise: 1 }, true);
    const raw = strokeOutline(shaky, { ...base, stabilise: 0 }, true);
    expect(steady).not.toEqual(raw);
    expect(strokeOutline(shaky, base, true)).toEqual(old); // unchanged without the field
    // How much the outline zigzags: total up-and-down travel along it.
    const jagged = (o: number[][]) => o.slice(1).reduce((t, p, i) => t + Math.abs(p[1] - o[i][1]), 0);
    expect(jagged(steady)).toBeLessThan(jagged(raw) * 0.6);
  });
});
