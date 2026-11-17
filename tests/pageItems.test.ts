import { describe, expect, it } from 'vitest';
import type { Page, StickyItem, TextItem } from '../src/core/model';
import { fitImage, itemAt, itemBounds, newSticky, newText, resizeItem, STICKY_ICON, textHeight, wrapLines } from '../src/core/items';

// Monospace stand-in for canvas measureText: every character is 10 units wide.
const measure = (s: string) => s.length * 10;

describe('wrapLines', () => {
  it('wraps on word boundaries and keeps explicit newlines', () => {
    expect(wrapLines('one two three four', 90, measure)).toEqual(['one two', 'three', 'four']);
    expect(wrapLines('a\n\nb', 100, measure)).toEqual(['a', '', 'b']);
  });

  it('breaks words longer than the line', () => {
    expect(wrapLines('abcdefghij', 40, measure)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('gives an empty text one empty line', () => {
    expect(wrapLines('', 100, measure)).toEqual(['']);
  });
});

describe('text items', () => {
  it('height follows the wrapped line count', () => {
    const t = newText({ x: 0, y: 0 }, { font: 'sans', size: 20, color: '#000' });
    const one = textHeight({ ...t, text: 'hi' }, measure);
    const three = textHeight({ ...t, text: 'hi\nthere\nyou' }, measure);
    expect(three - one).toBeCloseTo(2 * 20 * 1.3);
  });
});

describe('itemAt', () => {
  const text: TextItem = { id: 't', kind: 'text', x: 0, y: 0, w: 100, h: 100, text: '', font: 'sans', size: 16, color: '#000' };
  const sticky: StickyItem = { id: 's', kind: 'sticky', x: 50, y: 50, w: 100, h: 100, text: '', color: '#ffe680', collapsed: false };
  const page = (items: Page['items']): Page => ({ id: 'p', template: 'blank', strokes: [], items });

  it('finds the topmost item, with sticky notes above everything else', () => {
    // The text box is later in z-order, but sticky notes are drawn above ink and other items.
    expect(itemAt(page([sticky, { ...text, id: 't2' }]), { x: 75, y: 75 })?.id).toBe('s');
    expect(itemAt(page([text, sticky]), { x: 10, y: 10 })?.id).toBe('t');
    expect(itemAt(page([text]), { x: 500, y: 500 })).toBeNull();
  });

  it('a collapsed sticky note is only its icon', () => {
    const collapsed = { ...sticky, collapsed: true };
    expect(itemBounds(collapsed)).toEqual({ minX: 50, minY: 50, maxX: 50 + STICKY_ICON, maxY: 50 + STICKY_ICON });
    expect(itemAt(page([collapsed]), { x: 140, y: 140 })).toBeNull();
    expect(itemAt(page([collapsed]), { x: 55, y: 55 })?.id).toBe('s');
  });

  it('can be limited to some kinds', () => {
    expect(itemAt(page([text, sticky]), { x: 75, y: 75 }, ['text'])?.id).toBe('t');
  });
});

describe('sizing', () => {
  it('fits large images inside the page and keeps their aspect ratio', () => {
    const r = fitImage(4000, 2000, { x: 400, y: 500 });
    expect(r.w / r.h).toBeCloseTo(2);
    expect(r.w).toBeLessThanOrEqual(794 * 0.7);
    expect(r.x + r.w / 2).toBeCloseTo(400);
    // Small images keep their natural size.
    expect(fitImage(120, 80, { x: 400, y: 500 })).toMatchObject({ w: 120, h: 80 });
  });

  it('keeps sticky notes on the page', () => {
    const s = newSticky({ x: 790, y: 5 }, '#ffe680');
    expect(s.x + s.w).toBeLessThanOrEqual(794);
    expect(s.y).toBeGreaterThanOrEqual(0);
  });

  it('resizes images proportionally and enforces minimum sizes', () => {
    const img = { id: 'i', kind: 'image' as const, x: 0, y: 0, w: 200, h: 100, blobId: 'b' };
    expect(resizeItem(img, 400, 999, measure)).toMatchObject({ w: 400, h: 200 });
    expect(resizeItem(img, 1, 1, measure).w).toBeGreaterThanOrEqual(24);
    const sticky = newSticky({ x: 200, y: 200 }, '#ffe680');
    expect(resizeItem(sticky, 300, 120, measure)).toMatchObject({ w: 300, h: 120 });
    // Text boxes change width; their height follows the text.
    const t = { ...newText({ x: 0, y: 0 }, { font: 'sans', size: 10, color: '#000' }), text: 'aaaa bbbb' };
    const narrow = resizeItem(t, 60, 999, measure);
    expect(narrow.w).toBe(60);
    expect(narrow.h).toBe(textHeight({ ...t, w: 60 }, measure));
  });
});
