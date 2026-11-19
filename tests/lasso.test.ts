import { describe, expect, it } from 'vitest';
import { DEFAULT_LASSO, lassoAllowsItem, lassoPolygon, normalizeLassoSettings, rectPolygon, selectWithLasso, toggleLassoKind, LASSO_KINDS } from '../src/core/lasso';
import type { Page, PageItem, Stroke } from '../src/core/model';

const stroke = (id: string, x: number, y: number): Stroke => ({
  id,
  tool: 'pen',
  color: '#000',
  width: 2,
  simulatePressure: false,
  points: [
    { x, y, p: 0.5 },
    { x: x + 10, y, p: 0.5 },
  ],
});
const box = { w: 20, h: 20 };
const items: PageItem[] = [
  { id: 'img', kind: 'image', x: 0, y: 40, ...box, blobId: 'b' } as PageItem,
  { id: 'txt', kind: 'text', x: 40, y: 40, ...box, text: 'x', font: 'sans', size: 12, color: '#000' },
  { id: 'note', kind: 'sticky', x: 70, y: 40, ...box, text: '', color: '#ff0', collapsed: false },
  { id: 'tape', kind: 'tape', x: 0, y: 70, ...box, color: '#fc0' },
];
const page: Page = { id: 'p', template: 'blank', strokes: [stroke('ink', 5, 5), stroke('far', 500, 500)], items };
const everything = rectPolygon({ x: -10, y: -10 }, { x: 200, y: 200 });

describe('lasso shape', () => {
  it('a rectangle spans its two corners whichever way it was dragged', () => {
    expect(rectPolygon({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual([
      { x: 0, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ]);
  });

  it('freehand keeps the path; rectangle uses its first and last points', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 50, y: -30 },
      { x: 10, y: 10 },
    ];
    expect(lassoPolygon('freehand', path)).toEqual(path);
    expect(lassoPolygon('rect', path)).toEqual(rectPolygon({ x: 0, y: 0 }, { x: 10, y: 10 }));
  });

  it('a rectangle selects what is inside it and nothing outside', () => {
    const sel = selectWithLasso(page, lassoPolygon('rect', [{ x: 0, y: 0 }, { x: 30, y: 30 }]), LASSO_KINDS);
    expect(sel).toEqual({ pageId: 'p', strokeIds: ['ink'], itemIds: [] });
  });
});

describe('lasso filter', () => {
  it('with every kind on, selects everything enclosed, tape included', () => {
    expect(selectWithLasso(page, everything, LASSO_KINDS)).toEqual({ pageId: 'p', strokeIds: ['ink'], itemIds: ['img', 'txt', 'note', 'tape'] });
  });

  it('handwriting only skips items', () => {
    expect(selectWithLasso(page, everything, ['handwriting'])).toEqual({ pageId: 'p', strokeIds: ['ink'], itemIds: [] });
  });

  it('images only skips ink, text and tape', () => {
    expect(selectWithLasso(page, everything, ['image'])).toEqual({ pageId: 'p', strokeIds: [], itemIds: ['img'] });
  });

  it('text covers text boxes and sticky notes', () => {
    expect(selectWithLasso(page, everything, ['text'])).toEqual({ pageId: 'p', strokeIds: [], itemIds: ['txt', 'note'] });
  });

  it('returns null when the filter leaves nothing', () => {
    expect(selectWithLasso(page, rectPolygon({ x: 0, y: 0 }, { x: 30, y: 30 }), ['image'])).toBeNull();
  });

  it('tape and links pass only when the filter is off', () => {
    expect(lassoAllowsItem(LASSO_KINDS, items[3])).toBe(true);
    expect(lassoAllowsItem(['handwriting', 'image'], items[3])).toBe(false);
  });

  it('the last kind cannot be turned off; turning one on keeps the standard order', () => {
    expect(toggleLassoKind(['image'], 'image')).toEqual(['image']);
    expect(toggleLassoKind(['text'], 'handwriting')).toEqual(['handwriting', 'text']);
    expect(toggleLassoKind(LASSO_KINDS, 'image')).toEqual(['handwriting', 'text']);
  });
});

describe('lasso settings', () => {
  it('falls back to freehand with every kind for missing or bad values', () => {
    expect(normalizeLassoSettings(null)).toEqual(DEFAULT_LASSO);
    expect(normalizeLassoSettings({ shape: 'circle', kinds: ['nope'] })).toEqual(DEFAULT_LASSO);
    expect(normalizeLassoSettings({ shape: 'rect', kinds: ['text', 'image'] })).toEqual({ shape: 'rect', kinds: ['image', 'text'] });
  });
});
