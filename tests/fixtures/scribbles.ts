// Stroke paths for the scribble detector: deliberate scribbles, and handwriting that reverses
// direction a lot but must never be mistaken for one. Points every ~2 units, with seeded jitter.
import type { Vec } from '../../src/core/geometry';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
}

/** Sample a parametric path t∈[0,1] into points about `step` apart, with ±`jitter` noise. */
function path(f: (t: number) => Vec, samples: number, jitter = 0.6, seed = 1): Vec[] {
  const r = rng(seed);
  return Array.from({ length: samples }, (_, i) => {
    const p = f(i / (samples - 1));
    return { x: p.x + (r() - 0.5) * 2 * jitter, y: p.y + (r() - 0.5) * 2 * jitter };
  });
}

const rotate = (pts: Vec[], deg: number): Vec[] => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
};

/** Back and forth across `width`, `sweeps` times, drifting `drift` across per sweep; `rounded` turns smoothly. */
function backAndForth(width: number, sweeps: number, drift: number, seed: number, opts: { uneven?: number; rounded?: boolean } = {}): Vec[] {
  const r = rng(seed + 99);
  const pts: Vec[] = [];
  for (let k = 0; k < sweeps; k++) {
    const span = width * (1 - (opts.uneven ?? 0) * r());
    const from = k % 2 ? width : 0;
    const to = k % 2 ? width - span : span;
    const n = Math.max(6, Math.round(span / 2));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const e = opts.rounded ? (1 - Math.cos(t * Math.PI)) / 2 : t;
      pts.push({ x: from + (to - from) * e, y: k * drift + (opts.rounded ? Math.sin(t * Math.PI) * drift * 0.8 : drift * t) });
    }
  }
  const jr = rng(seed);
  return pts.map((p) => ({ x: p.x + (jr() - 0.5) * 1.2, y: p.y + (jr() - 0.5) * 1.2 }));
}

export const SCRIBBLES: Record<string, Vec[]> = {
  'across a word': backAndForth(120, 9, 2.5, 1),
  'over a single letter': backAndForth(22, 7, 1.5, 2),
  slanted: rotate(backAndForth(100, 8, 3, 3), -28),
  'up and down along a word': rotate(backAndForth(30, 22, 4.5, 4), 90),
  'messy, uneven sweeps': backAndForth(90, 10, 3, 5, { uneven: 0.25 }),
  'loopy turns': backAndForth(110, 8, 4, 6, { rounded: true }),
};

/** Cursive humps (m, n, w): up-and-down strokes that move steadily along the line. */
const humps = (count: number, width: number, height: number, seed: number, down = false) =>
  path((t) => ({ x: t * count * width + Math.sin(t * count * Math.PI * 2) * width * 0.15, y: (down ? 1 : -1) * Math.abs(Math.sin(t * count * Math.PI)) * height }), count * 18, 0.5, seed);

/** Loops (e, l) progressing along the line. */
const loops = (count: number, width: number, height: number, seed: number) =>
  path((t) => {
    const a = t * count * Math.PI * 2;
    return { x: t * count * width - Math.sin(a) * width * 0.6, y: -(1 - Math.cos(a)) * height * 0.5 };
  }, count * 24, 0.5, seed);

export const HANDWRITING: Record<string, Vec[]> = {
  'cursive mmm': humps(6, 12, 20, 11),
  'tight cursive nnnn': humps(8, 9, 16, 12),
  'cursive www': humps(6, 14, 18, 13, true),
  'zigzag line': path((t) => ({ x: t * 200, y: (Math.abs(((t * 10) % 2) - 1) - 0.5) * 30 }), 140, 0.4, 14),
  'wave underline': path((t) => ({ x: t * 240, y: Math.sin(t * Math.PI * 12) * 4 }), 160, 0.3, 15),
  'eeee loops': loops(6, 10, 14, 16),
  'llll tall loops': loops(5, 8, 34, 17),
  spiral: path((t) => {
    const a = t * Math.PI * 10, r = 40 * (1 - t) + 3;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }, 260, 0.4, 18),
  'big Z': [...path((t) => ({ x: t * 60, y: 0 }), 30, 0.4, 19), ...path((t) => ({ x: 60 - t * 60, y: t * 60 }), 40, 0.4, 20), ...path((t) => ({ x: t * 60, y: 60 }), 30, 0.4, 21)],
  'letter N': [...path((t) => ({ x: 0, y: 50 - t * 50 }), 25, 0.4, 22), ...path((t) => ({ x: t * 35, y: t * 50 }), 30, 0.4, 23), ...path((t) => ({ x: 35, y: 50 - t * 50 }), 25, 0.4, 24)],
  'letter M': [
    ...path((t) => ({ x: 0, y: 50 - t * 50 }), 25, 0.4, 25),
    ...path((t) => ({ x: t * 20, y: t * 35 }), 20, 0.4, 26),
    ...path((t) => ({ x: 20 + t * 20, y: 35 - t * 35 }), 20, 0.4, 27),
    ...path((t) => ({ x: 40, y: t * 50 }), 25, 0.4, 28),
  ],
  'figure 8': path((t) => ({ x: Math.sin(t * Math.PI * 4) * 12, y: -Math.cos(t * Math.PI * 2) * 25 }), 120, 0.4, 29),
  'ooo': path((t) => {
    const a = t * Math.PI * 6;
    return { x: t * 60 + Math.sin(a) * 9, y: -Math.cos(a) * 10 };
  }, 150, 0.4, 30),
  'signature squiggle': path((t) => ({ x: t * 160 + Math.sin(t * 31) * 10, y: Math.sin(t * 17) * 14 + Math.cos(t * 7) * 6 }), 200, 0.6, 31),
};
