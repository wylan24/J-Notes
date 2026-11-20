// Installing the app and keeping it up to date: registers the service worker (in production
// builds), reports when a new version is ready, and keeps the browser's install prompt for later.
import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  /** A new version is installed and waiting; calling this switches to it and reloads. */
  update: (() => void) | null;
  /** The browser offered to install the app; calling this shows its prompt. */
  install: (() => Promise<void>) | null;
}

let state: PwaState = { update: null, install: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

/** Running as an installed app (from the home screen or dock) rather than in a browser tab. */
export const isStandalone = (): boolean =>
  !!window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** iPad and iPhone install from Safari's Share menu; there is no prompt to show. */
export const isIos = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function setUpPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const ev = e as InstallPromptEvent;
    set({
      install: async () => {
        await ev.prompt();
        await ev.userChoice;
        set({ install: null });
      },
    });
  });
  window.addEventListener('appinstalled', () => set({ install: null }));

  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only after the person chose to update: the first install takes control without a reload.
    if (reloading) location.reload();
  });
  const offer = (worker: ServiceWorker) =>
    set({
      update: () => {
        reloading = true;
        worker.postMessage('skip-waiting');
      },
    });
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    // Look for a new version whenever the app comes back to the front.
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void reg.update().catch(() => {}));
  });
}
