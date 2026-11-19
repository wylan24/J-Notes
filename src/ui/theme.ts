// Light, dark, or follow the system. The choice is kept in this browser and applied as
// `data-theme` on the root element, which the stylesheet's colour tokens follow.
import { useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'jnotes.theme';
const listeners = new Set<() => void>();

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Whether the app is showing dark right now (chosen, or the system's choice). */
export function isDark(theme: Theme = readTheme()): boolean {
  if (theme !== 'system') return theme === 'dark';
  return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(theme: Theme = readTheme()): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  // The browser's own chrome (address bar, installed app title bar) matches.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark(theme) ? '#1b1b1d' : '#f4f2ee');
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Not remembered, but applied for now.
  }
  applyTheme(theme);
  listeners.forEach((l) => l());
}

let current = readTheme();
export function useTheme(): Theme {
  return useSyncExternalStore(
    (fn) => {
      const on = () => {
        current = readTheme();
        fn();
      };
      listeners.add(on);
      return () => listeners.delete(on);
    },
    () => current,
  );
}
