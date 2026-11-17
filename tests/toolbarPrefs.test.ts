import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, isDrawingTool, moveItem, normalizePrefs, toggleItem, TOOLBAR_ITEMS, visibleItems } from '../src/core/toolbarPrefs';

describe('toolbar preferences', () => {
  it('defaults to every item, in the standard order', () => {
    expect(visibleItems(DEFAULT_PREFS)).toEqual([...TOOLBAR_ITEMS]);
  });

  it('moves an item to a new position', () => {
    const p = moveItem(DEFAULT_PREFS, 'timer', 0);
    expect(p.order[0]).toBe('timer');
    expect(p.order).toHaveLength(TOOLBAR_ITEMS.length);
    expect(moveItem(DEFAULT_PREFS, 'pen', 999).order.at(-1)).toBe('pen');
    expect(moveItem(DEFAULT_PREFS, 'pen', -5).order[0]).toBe('pen');
  });

  it('hides and shows items, keeping their place in the order', () => {
    const hidden = toggleItem(DEFAULT_PREFS, 'laser');
    expect(visibleItems(hidden)).not.toContain('laser');
    expect(hidden.order).toEqual(DEFAULT_PREFS.order);
    expect(visibleItems(toggleItem(hidden, 'laser'))).toContain('laser');
  });

  it('never hides the last drawing tool', () => {
    let p = DEFAULT_PREFS;
    for (const item of TOOLBAR_ITEMS) p = toggleItem(p, item);
    const shown = visibleItems(p).filter(isDrawingTool);
    expect(shown).toHaveLength(1);
  });

  it('repairs saved preferences: unknown items dropped, duplicates removed, new tools added in place', () => {
    const p = normalizePrefs({ order: ['lasso', 'pen', 'pen', 'teleporter', 'eraser'], hidden: ['eraser', 'nope'] });
    expect(new Set(p.order).size).toBe(TOOLBAR_ITEMS.length);
    // The saved items keep their relative order.
    expect(p.order.indexOf('lasso')).toBeLessThan(p.order.indexOf('pen'));
    expect(p.order.indexOf('pen')).toBeLessThan(p.order.indexOf('eraser'));
    expect(p.hidden).toEqual(['eraser']);
    // 'highlighter' (missing from the saved order) goes back right after its default neighbour 'pen'.
    expect(p.order.indexOf('highlighter')).toBe(p.order.indexOf('pen') + 1);
  });

  it('falls back to the defaults for junk', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ order: 'x' })).toEqual(DEFAULT_PREFS);
  });

  it('a saved state with every drawing tool hidden shows the pen again', () => {
    const p = normalizePrefs({ order: [...TOOLBAR_ITEMS], hidden: TOOLBAR_ITEMS.filter(isDrawingTool) });
    expect(visibleItems(p)).toContain('pen');
  });
});
