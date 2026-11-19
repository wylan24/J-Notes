import { describe, expect, it } from 'vitest';
import { closeTab, MAX_TABS, normalizeTabs, openTab } from '../src/core/tabs';

describe('notebook tabs', () => {
  it('opens a notebook at the end, once', () => {
    expect(openTab(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(openTab(['a', 'b'], 'a')).toEqual(['a', 'b']);
  });

  it('closes the oldest tab beyond the limit', () => {
    const many = Array.from({ length: MAX_TABS }, (_, i) => `t${i}`);
    const next = openTab(many, 'new');
    expect(next).toHaveLength(MAX_TABS);
    expect(next[0]).toBe('t1');
    expect(next.at(-1)).toBe('new');
  });

  it('after closing the shown tab, shows its right neighbour, else its left, else the library', () => {
    expect(closeTab(['a', 'b', 'c'], 'b', 'b')).toEqual({ tabs: ['a', 'c'], next: 'c' });
    expect(closeTab(['a', 'b', 'c'], 'c', 'c')).toEqual({ tabs: ['a', 'b'], next: 'b' });
    expect(closeTab(['a'], 'a', 'a')).toEqual({ tabs: [], next: null });
  });

  it('closing another tab keeps the shown one', () => {
    expect(closeTab(['a', 'b', 'c'], 'a', 'c')).toEqual({ tabs: ['b', 'c'], next: 'c' });
    expect(closeTab(['a'], 'zz', 'a')).toEqual({ tabs: ['a'], next: 'a' });
  });

  it('reads saved tabs, dropping duplicates and junk', () => {
    expect(normalizeTabs(['a1', 'a1', 'b2', 3, '../x'])).toEqual(['a1', 'b2']);
    expect(normalizeTabs('nope')).toEqual([]);
  });
});
