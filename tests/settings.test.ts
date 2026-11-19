import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storedSettings, storeSettings } from '../src/ui/settingsStore';
import { forPlatform, SHORTCUT_GROUPS, SHORTCUTS_KEY, TOOLS } from '../src/core/shortcuts';
import { DEFAULT_STABILISE } from '../src/core/stabilise';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('settings', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('default to what the editor does with nothing saved', () => {
    expect(storedSettings()).toEqual({
      penOnly: false,
      scribbleErase: true,
      snap: true,
      scroll: 'vertical',
      straightHighlighter: false,
      stabilise: { pen: DEFAULT_STABILISE, highlighter: DEFAULT_STABILISE, shapes: DEFAULT_STABILISE },
    });
  });

  it('save under the keys the editor reads, keeping other ink settings', () => {
    localStorage.setItem('jnotes.ink', JSON.stringify({ pen: { color: '#123456', width: 3, stabilise: 0.5 } }));
    storeSettings({ penOnly: true, scroll: 'horizontal', straightHighlighter: true, stabilise: { pen: 0.8, highlighter: 0.1, shapes: 0 } });
    expect(JSON.parse(localStorage.getItem('jnotes.penOnly')!)).toBe(true);
    expect(JSON.parse(localStorage.getItem('jnotes.scroll')!)).toBe('horizontal');
    const ink = JSON.parse(localStorage.getItem('jnotes.ink')!);
    expect(ink.pen).toEqual({ color: '#123456', width: 3, stabilise: 0.8 });
    expect(ink.highlighter).toEqual({ straight: true, stabilise: 0.1 });
    expect(storedSettings()).toMatchObject({ penOnly: true, scroll: 'horizontal', straightHighlighter: true, stabilise: { pen: 0.8, highlighter: 0.1, shapes: 0 } });
  });
});

describe('shortcuts', () => {
  it('give every tool its own key, and list them all', () => {
    const keys = TOOLS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    // R and W are the ruler and zoom window, so no tool may use them.
    expect(keys).not.toContain('R');
    expect(keys).not.toContain('W');
    const listed = SHORTCUT_GROUPS[0].items.map((i) => i.keys);
    expect(listed).toEqual(keys);
    expect(SHORTCUT_GROUPS.flatMap((g) => g.items).some((i) => i.keys === SHORTCUTS_KEY)).toBe(true);
  });

  it('show Ctrl, Alt and Shift away from the Mac', () => {
    expect(forPlatform('⇧⌘Z', false)).toBe('Shift+Ctrl+Z');
    expect(forPlatform('⌥⌘1', false)).toBe('Alt+Ctrl+1');
    expect(forPlatform('⇧⌘Z', true)).toBe('⇧⌘Z');
  });
});
