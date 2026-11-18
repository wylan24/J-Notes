import { describe, expect, it } from 'vitest';
import type { Page } from '../src/core/model';
import { docKind } from '../src/core/model';
import { contentBounds, cropToContent, fitView, isLargePage, WHITEBOARD_SIZE, whiteboardPage } from '../src/core/whiteboard';
import { templateLayout, templateLayoutIn } from '../src/core/templates';
import { strokeBounds } from '../src/core/geometry';

const stroke = (pts: [number, number][]) => ({ id: 's' + pts[0][0], tool: 'pen' as const, color: '#000', width: 2, simulatePressure: false, points: pts.map(([x, y]) => ({ x, y, p: 0.5 })) });

describe('whiteboards', () => {
  it('are one large page that is drawn in tiles; notebooks are not', () => {
    const p = whiteboardPage('p');
    expect(p.size).toEqual(WHITEBOARD_SIZE);
    expect(isLargePage(WHITEBOARD_SIZE)).toBe(true);
    expect(isLargePage({ w: 794, h: 1123 })).toBe(false);
    expect(docKind({})).toBe('notebook');
    expect(docKind({ kind: 'whiteboard' })).toBe('whiteboard');
  });

  it('find the box around their content', () => {
    const page: Page = { ...whiteboardPage('p'), strokes: [stroke([[100, 100], [200, 150]])], items: [{ id: 't', kind: 'tape', x: 500, y: 50, w: 40, h: 20, color: '#000' }] };
    expect(contentBounds(page)).toEqual({ minX: 99, minY: 50, maxX: 540, maxY: 151 });
    expect(contentBounds(whiteboardPage('e'))).toBeNull();
  });

  it('fit content in the window, never zooming in past 1x', () => {
    const lim = { min: 0.1, max: 4 };
    const v = fitView({ minX: 1000, minY: 1000, maxX: 3000, maxY: 2000 }, WHITEBOARD_SIZE, { w: 1000, h: 800 }, lim, 0);
    expect(v).toEqual({ zoom: 0.5, cx: 2000, cy: 1500 });
    expect(fitView({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, WHITEBOARD_SIZE, { w: 1000, h: 800 }, lim).zoom).toBe(1);
    expect(fitView({ minX: 0, minY: 0, maxX: 1e6, maxY: 10 }, WHITEBOARD_SIZE, { w: 1000, h: 800 }, lim).zoom).toBe(0.1);
    expect(fitView(null, WHITEBOARD_SIZE, { w: 1000, h: 800 }, lim)).toEqual({ zoom: 1, cx: 8000, cy: 8000 });
  });

  it('export just their content, moved to the corner', () => {
    const page: Page = { ...whiteboardPage('p'), strokes: [stroke([[5000, 6000], [5100, 6050]])] };
    const out = cropToContent(page, 10);
    const b = strokeBounds(out.strokes[0]);
    expect(b.minX).toBeCloseTo(10);
    expect(b.minY).toBeCloseTo(10);
    expect(out.size).toEqual({ w: Math.ceil(102 + 20), h: Math.ceil(52 + 20) });
  });
});

describe('templates for one tile', () => {
  const size = { w: 2000, h: 2000 };
  const region = { minX: 300, minY: 500, maxX: 812, maxY: 1012 };
  it('match the full layout inside the tile', () => {
    for (const t of ['grid', 'dotted'] as const) {
      const full = templateLayout(t, size);
      const tile = templateLayoutIn(t, size, region);
      const inside = (x: number, y: number) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
      expect(tile.dots.filter((d) => inside(d.x, d.y))).toEqual(full.dots.filter((d) => inside(d.x, d.y)));
      const xs = (ls: typeof full.lines) => ls.filter((l) => l.x1 === l.x2 && l.x1 >= region.minX && l.x1 <= region.maxX).map((l) => l.x1);
      expect(xs(tile.lines)).toEqual(xs(full.lines));
    }
  });
  it('stay small on a huge page', () => {
    expect(templateLayoutIn('dotted', WHITEBOARD_SIZE, region).dots.length).toBeLessThan(400);
  });
});
