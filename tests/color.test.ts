import { describe, expect, it } from 'vitest';
import { addSwatch, hexToHsv, hsToWheel, hsvToHex, MAX_SWATCHES, normalizeSwatches, pixelToHex, rgbToHex, wheelToHs } from '../src/core/color';

describe('colour picking', () => {
  it('converts HEX to HSV and back', () => {
    for (const c of ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#3d5a80', '#e9c46a', '#808080']) {
      expect(hsvToHex(hexToHsv(c))).toBe(c);
    }
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00ff00').h).toBeCloseTo(120);
  });

  it('maps the wheel: hue round from the right, saturation out from the centre', () => {
    expect(wheelToHs(100, 0, 100)).toEqual({ h: 0, s: 1 });
    expect(wheelToHs(0, -50, 100).h).toBeCloseTo(90); // straight up
    expect(wheelToHs(0, 0, 100).s).toBe(0);
    expect(wheelToHs(500, 0, 100).s).toBe(1); // past the rim picks the rim
    const p = hsToWheel(210, 0.4, 100);
    const back = wheelToHs(p.x, p.y, 100);
    expect(back.h).toBeCloseTo(210);
    expect(back.s).toBeCloseTo(0.4);
  });

  it('reads page pixels, treating transparency as white paper', () => {
    expect(pixelToHex([255, 0, 0, 255])).toBe('#ff0000');
    expect(pixelToHex([0, 0, 0, 0])).toBe('#ffffff');
    expect(rgbToHex(300, -5, 127.6)).toBe('#ff0080');
  });

  it('keeps custom swatches unique, newest last, within the limit', () => {
    let list = addSwatch([], '#ABC');
    list = addSwatch(list, '#112233');
    list = addSwatch(list, '#aabbcc'); // already there: moves to the end
    expect(list).toEqual(['#112233', '#aabbcc']);
    expect(addSwatch(list, 'not a colour')).toEqual(list);
    for (let i = 0; i < MAX_SWATCHES + 2; i++) list = addSwatch(list, rgbToHex(i * 10, 0, 0));
    expect(list).toHaveLength(MAX_SWATCHES);
  });

  it('reads saved swatches, dropping junk and duplicates', () => {
    expect(normalizeSwatches(['#fff', '#FFFFFF', 'x', 3, '#123456'])).toEqual(['#ffffff', '#123456']);
    expect(normalizeSwatches(null)).toEqual([]);
  });
});
