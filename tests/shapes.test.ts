import { describe, expect, it } from 'vitest';
import type { InputPoint } from '../src/core/model';
import { recognizeShape, shapePaths, transformShape, type Shape } from '../src/core/shapes';

// Deterministic jitter so "hand-drawn" fixtures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296 - 0.5;
  };
}

type P = [number, number];

/** Densely sample a polyline through the given corners, with optional jitter. */
function polyline(corners: P[], jitter = 0, seed = 1, step = 3): InputPoint[] {
  const rand = rng(seed);
  const out: InputPoint[] = [];
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1];
    const [bx, by] = corners[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: ax + (bx - ax) * t + rand() * jitter, y: ay + (by - ay) * t + rand() * jitter, p: 0.5 });
    }
  }
  return out;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, opts: { rot?: number; jitter?: number; turns?: number; start?: number; seed?: number } = {}): InputPoint[] {
  const { rot = 0, jitter = 0, turns = 1, start = 0, seed = 2 } = opts;
  const rand = rng(seed);
  const n = 120;
  return Array.from({ length: Math.round(n * turns) + 1 }, (_, i) => {
    const t = start + (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    return {
      x: cx + x * Math.cos(rot) - y * Math.sin(rot) + rand() * jitter,
      y: cy + x * Math.sin(rot) + y * Math.cos(rot) + rand() * jitter,
      p: 0.5,
    };
  });
}

const kind = (pts: InputPoint[]) => recognizeShape(pts)?.kind ?? null;

describe('recognizeShape', () => {
  it('recognises straight lines', () => {
    const s = recognizeShape(polyline([[10, 10], [200, 60]], 2));
    expect(s?.kind).toBe('line');
  });

  it('recognises circles and snaps near-circles to a true circle', () => {
    const s = recognizeShape(ellipse(200, 200, 80, 76, { jitter: 4 }));
    expect(s?.kind).toBe('ellipse');
    if (s?.kind !== 'ellipse') return;
    expect(s.cx).toBeCloseTo(200, -1);
    expect(s.cy).toBeCloseTo(200, -1);
    expect(s.rx).toBe(s.ry);
    expect(s.rx).toBeGreaterThan(70);
    expect(s.rx).toBeLessThan(86);
  });

  it('recognises ellipses, including rotated ones and slight overdraw', () => {
    expect(kind(ellipse(300, 200, 150, 60, { jitter: 4 }))).toBe('ellipse');
    expect(kind(ellipse(300, 200, 150, 60, { rot: 0.6, jitter: 3 }))).toBe('ellipse');
    expect(kind(ellipse(300, 200, 120, 70, { turns: 1.12, start: 1 }))).toBe('ellipse');
    // A small gap where the pen didn't quite close the loop.
    expect(kind(ellipse(300, 200, 120, 70, { turns: 0.92 }))).toBe('ellipse');
  });

  it('snaps nearly axis-aligned ellipses to the axes', () => {
    const s = recognizeShape(ellipse(300, 200, 150, 60, { rot: 0.08 }));
    expect(s?.kind).toBe('ellipse');
    if (s?.kind === 'ellipse') expect(s.rotation).toBe(0);
  });

  it('recognises rectangles and squares them up', () => {
    const s = recognizeShape(polyline([[100, 100], [300, 104], [298, 220], [102, 218], [100, 102]], 3));
    expect(s?.kind).toBe('rectangle');
    if (s?.kind !== 'rectangle') return;
    expect(s.points).toHaveLength(4);
    const xs = s.points.map((p) => Math.round(p.x));
    const ys = s.points.map((p) => Math.round(p.y));
    // Axis-aligned: only two distinct x and two distinct y values.
    expect(new Set(xs).size).toBe(2);
    expect(new Set(ys).size).toBe(2);
  });

  it('recognises rotated rectangles starting mid-edge', () => {
    const c = Math.cos(0.5), s = Math.sin(0.5);
    const rot = ([x, y]: P): P => [400 + x * c - y * s, 300 + x * s + y * c];
    const corners: P[] = [[0, -60], [100, -60], [100, 60], [-100, 60], [-100, -60], [0, -60]].map((p) => rot(p as P));
    expect(kind(polyline(corners, 2))).toBe('rectangle');
  });

  it('recognises triangles', () => {
    expect(kind(polyline([[200, 50], [320, 250], [80, 250], [200, 52]], 3))).toBe('triangle');
  });

  it('recognises other polygons', () => {
    const penta: P[] = Array.from({ length: 6 }, (_, i) => [300 + Math.cos((i / 5) * Math.PI * 2 - Math.PI / 2) * 120, 300 + Math.sin((i / 5) * Math.PI * 2 - Math.PI / 2) * 120]);
    const s = recognizeShape(polyline(penta, 2));
    expect(s?.kind).toBe('polygon');
    if (s?.kind === 'polygon') expect(s.points).toHaveLength(5);
  });

  it('recognises arrows drawn as a shaft then a head', () => {
    // Shaft left→right, then the head drawn as tip → upper barb → tip → lower barb.
    const s = recognizeShape(polyline([[50, 200], [300, 200], [270, 180], [300, 200], [270, 222]], 1.5));
    expect(s?.kind).toBe('arrow');
    if (s?.kind !== 'arrow') return;
    expect(s.tip.x).toBeCloseTo(300, -1);
    expect(s.tail.x).toBeCloseTo(50, -1);
  });

  it('recognises arrows in any direction', () => {
    expect(kind(polyline([[60, 300], [60, 80], [40, 110], [60, 80], [82, 108]], 1.5))).toBe('arrow');
  });

  it('recognises arrows drawn head first', () => {
    const s = recognizeShape(polyline([[270, 180], [300, 200], [270, 222], [300, 200], [50, 200]], 1.5));
    expect(s?.kind).toBe('arrow');
    if (s?.kind === 'arrow') expect(s.tip.x).toBeCloseTo(300, -1);
  });

  it('leaves handwriting and scribbles alone', () => {
    // A cursive "e"-like loop with a tail.
    const e = polyline([[0, 40], [60, 30], [50, 0], [20, 5], [10, 40], [40, 60], [90, 50]], 1);
    expect(kind(e)).toBeNull();
    // A zig-zag scribble.
    const zig = polyline([[0, 0], [30, 80], [60, 0], [90, 80], [120, 0], [150, 80]], 1);
    expect(kind(zig)).toBeNull();
    // An open arc (a "C").
    expect(kind(ellipse(200, 200, 80, 80, { turns: 0.6 }))).toBeNull();
    // A spiral.
    const spiral = Array.from({ length: 200 }, (_, i) => ({ x: 200 + Math.cos(i / 10) * i, y: 200 + Math.sin(i / 10) * i, p: 0.5 }));
    expect(kind(spiral)).toBeNull();
  });

  it('ignores tiny strokes', () => {
    expect(kind(ellipse(10, 10, 5, 5))).toBeNull();
    expect(kind([{ x: 0, y: 0, p: 0.5 }])).toBeNull();
  });
});

describe('shapePaths', () => {
  const close = (a: InputPoint, b: InputPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

  it('closes ellipses and polygons and uses constant pressure', () => {
    const shapes: Shape[] = [
      { kind: 'ellipse', cx: 0, cy: 0, rx: 50, ry: 30, rotation: 0 },
      { kind: 'rectangle', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }] },
    ];
    for (const s of shapes) {
      const [path] = shapePaths(s);
      expect(close(path[0], path[path.length - 1])).toBe(true);
      expect(path.every((p) => p.p === 0.5)).toBe(true);
    }
  });

  it('draws an arrow as a shaft and a head', () => {
    const paths = shapePaths({ kind: 'arrow', tail: { x: 0, y: 0 }, tip: { x: 100, y: 0 } });
    expect(paths).toHaveLength(2);
    const head = paths[1];
    expect(head.some((p) => close(p, { x: 100, y: 0, p: 0.5 }))).toBe(true);
    // Barbs sit behind the tip.
    expect(head[0].x).toBeLessThan(100);
    expect(head[head.length - 1].x).toBeLessThan(100);
  });
});

describe('transformShape', () => {
  it('scales closed shapes about their centre', () => {
    const s = transformShape({ kind: 'ellipse', cx: 10, cy: 10, rx: 5, ry: 4, rotation: 0 }, { x: 10, y: 10 }, 2);
    expect(s).toEqual({ kind: 'ellipse', cx: 10, cy: 10, rx: 10, ry: 8, rotation: 0 });
    const r = transformShape({ kind: 'triangle', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }] }, { x: 1, y: 1 }, 3);
    expect(r.kind === 'triangle' && r.points[0]).toEqual({ x: -2, y: -2 });
  });
});
