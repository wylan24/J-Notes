import { describe, expect, it } from 'vitest';
import { findInPage, type TextRun } from '../src/core/pdfSearch';

// Runs 10 units per character, one line per run unless noted.
const run = (str: string, x: number, y: number, eol = true): TextRun => ({ str, x, y, w: str.length * 10, h: 12, eol });

describe('PDF text search', () => {
  const page = [run('Photosynthesis converts light', 50, 100), run('into chemical energy.', 50, 120), run('Light ', 50, 140, false), run('reactions', 110, 140)];

  it('finds every match, ignoring case', () => {
    const m = findInPage(page, 'LIGHT');
    expect(m).toHaveLength(2);
    expect(m[0].rects).toEqual([{ x: 50 + 24 * 10, y: 100, w: 50, h: 12 }]);
    expect(m[1].rects).toEqual([{ x: 50, y: 140, w: 50, h: 12 }]);
  });

  it('matches a phrase across a line break, with one box per line', () => {
    const [m] = findInPage(page, 'light into chemical');
    expect(m.rects).toEqual([
      { x: 50 + 24 * 10, y: 100, w: 50, h: 12 },
      { x: 50, y: 120, w: 130, h: 12 },
    ]);
  });

  it('matches across runs split mid-line and collapses repeated spaces', () => {
    expect(findInPage(page, 'light   reactions')).toHaveLength(1);
    expect(findInPage(page, 'light reactions')[0].rects).toHaveLength(2);
  });

  it('gives a snippet in the original case with the match marked', () => {
    const [m] = findInPage(page, 'chemical');
    expect(m.snippet.slice(m.start, m.end)).toBe('chemical');
    expect(m.snippet).toBe('…tosynthesis converts light into chemical energy. Light reactions');
  });

  it('shortens long context with ellipses', () => {
    const long = [run('a'.repeat(100) + ' needle ' + 'b'.repeat(100), 0, 0)];
    const [m] = findInPage(long, 'needle');
    expect(m.snippet.startsWith('…')).toBe(true);
    expect(m.snippet.endsWith('…')).toBe(true);
    expect(m.snippet.slice(m.start, m.end)).toBe('needle');
  });

  it('finds nothing for a blank query or absent text', () => {
    expect(findInPage(page, '   ')).toEqual([]);
    expect(findInPage(page, 'mitochondria')).toEqual([]);
    expect(findInPage([], 'light')).toEqual([]);
  });
});
