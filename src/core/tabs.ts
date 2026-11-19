// Notebook tabs: the notebooks kept open side by side, left to right.

export const MAX_TABS = 10;

/** Open a notebook in a tab: it is added at the end unless already open. Past the limit, the oldest other tab closes. */
export function openTab(tabs: readonly string[], id: string): string[] {
  if (tabs.includes(id)) return [...tabs];
  const next = [...tabs, id];
  return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next;
}

/**
 * Close a tab. If it was the one showing, the tab to show next is its right-hand neighbour, else its
 * left-hand one, else none (back to the library).
 */
export function closeTab(tabs: readonly string[], id: string, active: string | null): { tabs: string[]; next: string | null } {
  const i = tabs.indexOf(id);
  if (i < 0) return { tabs: [...tabs], next: active };
  const rest = tabs.filter((t) => t !== id);
  if (id !== active) return { tabs: rest, next: active };
  return { tabs: rest, next: rest[i] ?? rest[i - 1] ?? null };
}

/** Saved tabs from storage: unique ids only, within the limit. */
export function normalizeTabs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = [...new Set(raw.filter((x): x is string => typeof x === 'string' && /^[a-f0-9]+$/.test(x)))];
  return ids.slice(-MAX_TABS);
}

/** Where a notebook was scrolled to, so its tab comes back to the same place. */
export interface ViewPosition {
  scrollTop: number;
  scrollLeft: number;
}
