// The open notebook tabs, shared by the library and editor, remembered in this browser.
import { useSyncExternalStore } from 'react';
import { closeTab as close, normalizeTabs, openTab as open, type ViewPosition } from '../core/tabs';

const KEY = 'jnotes.tabs';
let tabs: string[] = (() => {
  try {
    return normalizeTabs(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

function set(next: string[]): void {
  tabs = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    // Not remembered across reloads, but still works.
  }
  listeners.forEach((l) => l());
}

export const getTabs = () => tabs;
export const isTabOpen = (id: string) => tabs.includes(id);
export const openTab = (id: string) => set(open(tabs, id));

/** Close a tab; returns the notebook to show next if it was the active one (null = the library). */
export function closeTab(id: string, active: string | null): string | null {
  const r = close(tabs, id, active);
  set(r.tabs);
  return r.next;
}

export function useTabs(): string[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getTabs,
  );
}

// Scroll positions per notebook, for this session (a tab comes back where it was left).
const positions = new Map<string, ViewPosition>();
export const savePosition = (id: string, p: ViewPosition) => positions.set(id, p);
export const savedPosition = (id: string) => positions.get(id);

// A page to show when a notebook next opens (e.g. a flashcard's source), for this window only.
let pageJump: { docId: string; pageId: string } | null = null;

export function requestPageJump(docId: string, pageId: string): void {
  pageJump = { docId, pageId };
}

/** The page asked for when `docId` opens, once; null if none. */
export function takePageJump(docId: string): string | null {
  if (pageJump?.docId !== docId) return null;
  const { pageId } = pageJump;
  pageJump = null;
  return pageId;
}
