import { describe, expect, it } from 'vitest';
import { MIN_SHOT, screenshotImage, screenshotRect } from '../src/core/screenshot';
import { lassoPolygon, normalizeLassoSettings, rectPolygon } from '../src/core/lasso';

const SIZE = { w: 794, h: 1123 };

describe('region screenshot', () => {
  it('takes the dragged rectangle either way round, kept on the page', () => {
    expect(screenshotRect({ x: 300, y: 200 }, { x: 100, y: 50 }, SIZE)).toEqual({ x: 100, y: 50, w: 200, h: 150 });
    expect(screenshotRect({ x: -40, y: 1000 }, { x: 60, y: 1300 }, SIZE)).toEqual({ x: 0, y: 1000, w: 60, h: 123 });
  });

  it('ignores a tap or a sliver', () => {
    expect(screenshotRect({ x: 10, y: 10 }, { x: 12, y: 300 }, SIZE)).toBeNull();
    expect(screenshotRect({ x: 10, y: 10 }, { x: 10 + MIN_SHOT, y: 10 + MIN_SHOT }, SIZE)).not.toBeNull();
  });

  it('adds the picture at the region size, offset, and kept on the page', () => {
    const img = screenshotImage('b', { x: 100, y: 100, w: 200, h: 80 }, SIZE);
    expect(img).toMatchObject({ kind: 'image', blobId: 'b', x: 124, y: 124, w: 200, h: 80 });
    const edge = screenshotImage('b', { x: 700, y: 1100, w: 94, h: 23 }, SIZE);
    expect([edge.x, edge.y]).toEqual([700, 1100]);
  });

  it('drags a rectangle like the rectangle lasso, and is not remembered', () => {
    const path = [{ x: 0, y: 0 }, { x: 40, y: 10 }, { x: 20, y: 30 }];
    expect(lassoPolygon('screenshot', path)).toEqual(rectPolygon({ x: 0, y: 0 }, { x: 20, y: 30 }));
    expect(normalizeLassoSettings({ shape: 'screenshot' }).shape).toBe('freehand');
  });
});
