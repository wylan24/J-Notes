import { describe, expect, it } from 'vitest';
import type { Stroke } from '../src/core/model';
import { FULL, layoutOf, neatness, restyle, slantOf } from '../spike/hwr/restyle';
import { segmentLines } from '../src/core/segment';

// Letters shaped like an "n", `h` tall, leaning by `lean` (x per unit of height, top to the right).
let n = 0;
function letter(x: number, y: number, h = 20, lean = 0, color = '#123'): Stroke {
  const at = (px: number, py: number) => ({ x: px + lean * (y + h - py), y: py, p: 0.5 });
  const pts = [at(x, y), at(x, y + h / 2), at(x, y + h), at(x, y + h / 2), at(x, y), at(x + 4, y), at(x + 8, y), at(x + 12, y), at(x + 12, y + h / 2), at(x + 12, y + h)];
  return { id: `s${n++}`, tool: 'pen', color, width: 2, simulatePressure: false, points: pts };
}
/** Words of `counts` letters; `sizes` and `dys` vary each word's height and height on the line. */
function line(counts: number[], { lean = 0, sizes = [] as number[], dys = [] as number[], gaps = [] as number[] } = {}): Stroke[][] {
  let x = 100;
  return counts.map((c, i) => {
    const h = sizes[i] ?? 20;
    const word = [...Array(c)].map((_, k) => letter(x + k * 0.75 * h, 100 + (dys[i] ?? 0) + (20 - h), h, lean));
    x += c * 0.75 * h + (gaps[i] ?? 30);
    return word;
  });
}
const bounds = (ss: Stroke[]) => ({ minX: Math.min(...ss.flatMap((s) => s.points.map((p) => p.x))), maxX: Math.max(...ss.flatMap((s) => s.points.map((p) => p.x))) });

describe('restyle spike', () => {
  it('measures slant: right lean positive, upright near zero', () => {
    expect(slantOf(line([4], { lean: 0.3 }).flat())).toBeCloseTo(0.3, 1);
    expect(Math.abs(slantOf(line([4]).flat()))).toBeLessThan(0.05);
    expect(slantOf(line([4], { lean: -0.2 }).flat())).toBeCloseTo(-0.2, 1);
  });

  it('makes messy writing measurably tidier', () => {
    const messy = line([3, 4, 3, 5], { lean: 0.3, sizes: [20, 26, 17, 21], dys: [0, -6, 5, -3], gaps: [24, 44, 30] }).flat();
    const layout = layoutOf(messy);
    const before = neatness(messy, layout);
    const after = neatness(restyle(messy), layout);
    expect(after.slant).toBeLessThan(before.slant / 3);
    expect(after.wobble).toBeLessThan(before.wobble / 2);
    expect(after.sizeSpread).toBeLessThan(before.sizeSpread);
    expect(after.gapSpread).toBeLessThan(before.gapSpread / 2);
  });

  it('keeps every stroke, its colour, the words and their order', () => {
    const words = line([3, 4, 3], { lean: 0.25, dys: [0, 4, -4] });
    const strokes = words.flat();
    const out = restyle(strokes);
    expect(out.map((s) => s.id)).toEqual(strokes.map((s) => s.id));
    expect(out.every((s) => s.color === '#123')).toBe(true);
    const lines = segmentLines(out);
    expect(lines).toHaveLength(1);
    expect(lines[0].words.map((w) => w.strokeIds.sort())).toEqual(words.map((w) => w.map((s) => s.id).sort()));
    // Words stay in order, left to right, starting about where the line did.
    const xs = words.map((w) => bounds(out.filter((s) => w.some((x) => x.id === s.id))).minX);
    expect(xs).toEqual(xs.slice().sort((a, b) => a - b));
  });

  it('keeps words apart when it makes them bigger', () => {
    // A small word just before a big gap-less neighbour must not run into it.
    const words = line([3, 3, 3], { sizes: [20, 15, 20], gaps: [30, 30] });
    const strokes = words.flat();
    const out = restyle(strokes);
    const byId = new Map(out.map((s) => [s.id, s]));
    const boxes = words.map((w) => bounds(w.map((s) => byId.get(s.id)!)));
    expect(boxes[1].minX).toBeGreaterThan(boxes[0].maxX + 5);
    expect(boxes[2].minX).toBeGreaterThan(boxes[1].maxX + 5);
    expect(segmentLines(out)[0].words).toHaveLength(3);
  });

  it('leaves tidy writing about as it was', () => {
    const tidy = line([3, 4, 3]).flat();
    const out = restyle(tidy, { ...FULL, smooth: 0 });
    for (const [i, s] of out.entries()) for (const [k, p] of s.points.entries()) expect(Math.abs(p.x - tidy[i].points[k].x) + Math.abs(p.y - tidy[i].points[k].y)).toBeLessThan(1.5);
  });
});
