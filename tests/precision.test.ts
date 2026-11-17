import { describe, expect, it } from 'vitest';
import { edgeNear, projectToEdge, rotateRuler, rulerEdges, setRulerAngle, twoFingerRuler, type Ruler } from '../src/core/ruler';
import { advance, clampTarget, defaultTarget, leftMargin, newLine, panelToPage, shouldAdvance, ZOOM_ASPECT, type ZoomTarget } from '../src/core/zoomWindow';
import { PAGE_H, PAGE_W } from '../src/core/model';

const level: Ruler = { cx: 500, cy: 300, angle: 0, length: 800, width: 60 };

describe('ruler', () => {
  it('has two edges either side of its centre line, normals pointing away', () => {
    const [top, bottom] = rulerEdges(level);
    expect(top.p).toEqual({ x: 500, y: 270 });
    expect(top.normal).toEqual({ x: 0, y: -1 });
    expect(bottom.p).toEqual({ x: 500, y: 330 });
    expect(bottom.normal).toEqual({ x: 0, y: 1 });
  });

  it('picks the edge a stroke starts next to, only within reach and along the ruler', () => {
    const edges = rulerEdges(level);
    expect(edgeNear({ x: 400, y: 250 }, edges, 30)?.normal).toEqual({ x: 0, y: -1 });
    expect(edgeNear({ x: 400, y: 345 }, edges, 30)?.normal).toEqual({ x: 0, y: 1 });
    expect(edgeNear({ x: 400, y: 200 }, edges, 30)).toBeNull(); // too far above
    expect(edgeNear({ x: 400, y: 300 }, edges, 30)).toBeNull(); // on the ruler body
    expect(edgeNear({ x: 1000, y: 250 }, edges, 30)).toBeNull(); // beyond its end
  });

  it('projects points onto the edge, offset outward', () => {
    const [top] = rulerEdges(level);
    expect(projectToEdge({ x: 420, y: 255 }, top, 2)).toEqual({ x: 420, y: 268 });
  });

  it('works when rotated', () => {
    const r = { ...level, angle: Math.PI / 2 };
    const [a] = rulerEdges(r);
    expect(a.normal.x).toBeCloseTo(1);
    const p = projectToEdge({ x: 560, y: 100 }, a, 0);
    expect(p.x).toBeCloseTo(530);
    expect(p.y).toBeCloseTo(100);
  });

  it('small steps add up past a snap point instead of sticking to it', () => {
    let r = level;
    for (let i = 0; i < 30; i++) r = rotateRuler(r, Math.PI / 180);
    expect(r.angle).toBeCloseTo(Math.PI / 6);
    // Snapping only changes the shown angle; the raw angle keeps going.
    expect(rotateRuler(level, Math.PI / 180).angle).toBe(0);
    expect(setRulerAngle(level, 0.3).angle).toBeCloseTo(0.3);
  });

  it('rotation snaps to multiples of 45°', () => {
    expect(rotateRuler(level, (44 * Math.PI) / 180).angle).toBeCloseTo(Math.PI / 4);
    expect(rotateRuler(level, (30 * Math.PI) / 180).angle).toBeCloseTo((30 * Math.PI) / 180);
  });

  it('follows two fingers: their midpoint moves it, their turn rotates it', () => {
    const r = twoFingerRuler(level, [{ x: 400, y: 300 }, { x: 600, y: 300 }], [{ x: 410, y: 310 }, { x: 610, y: 410 }]);
    expect(r.cx).toBeCloseTo(510);
    expect(r.cy).toBeCloseTo(360);
    expect(r.angle).toBeCloseTo(Math.atan2(100, 200));
  });
});

describe('zoom window', () => {
  const t: ZoomTarget = { pageId: 'p', x: 100, y: 200, w: 280, h: 280 / ZOOM_ASPECT };

  it('maps panel coordinates onto the target box', () => {
    expect(panelToPage({ x: 0, y: 0 }, t, 980)).toEqual({ x: 100, y: 200 });
    const p = panelToPage({ x: 490, y: 140 }, t, 980);
    expect(p.x).toBeCloseTo(240);
    expect(p.y).toBeCloseTo(240);
  });

  it('advances only after writing near the right end', () => {
    expect(shouldAdvance(700, 980)).toBe(false);
    expect(shouldAdvance(800, 980)).toBe(true);
  });

  it('moves along the line, then wraps to the start of the next', () => {
    const a = advance(t, 'ruled');
    expect(a.x).toBeCloseTo(240);
    expect(a.y).toBe(200);
    const end = advance({ ...t, x: PAGE_W - 300 }, 'ruled');
    expect(end.x).toBe(leftMargin('ruled'));
    expect(end.y).toBe(200 + 96); // the next line: whole rules below
  });

  it('on lined paper, a new line moves by whole line spacings', () => {
    expect(newLine(t, 'ruled').y - t.y).toBe(96); // 80-unit box → three 32-unit rules
    expect(newLine(t, 'grid').y - t.y).toBe(84); // three 28-unit squares
    expect(newLine(t, 'blank').y - t.y).toBeCloseTo(t.h);
  });

  it('new lines stop at the bottom of the page', () => {
    const n = newLine({ ...t, y: PAGE_H - 10 }, 'blank');
    expect(n.y + n.h).toBeLessThanOrEqual(PAGE_H);
  });

  it('starts at the left margin and stays on the page', () => {
    expect(defaultTarget('p', 'ruled').x).toBe(leftMargin('ruled'));
    expect(leftMargin('ruled')).toBeGreaterThan(leftMargin('blank'));
    const c = clampTarget({ ...t, x: -50, y: 5000 });
    expect(c.x).toBe(0);
    expect(c.y + c.h).toBe(PAGE_H);
  });
});
