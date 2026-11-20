// When to sync, and how it is going. Syncs when the app starts or comes back to the front, when it
// comes back online, when a notebook is opened or closed, and a little while after edits. Only
// while signed in with Drive access; signed out, nothing here runs.
import { useSyncExternalStore } from 'react';
import { canUseDrive } from '../core/account';
import { newId } from '../core/ids';
import { accessToken, currentAccount, onAccountChange } from '../auth/google';
import { clearSync } from '../storage/db';
import { setPersisterHooks } from '../storage/persister';
import { DriveAuthError, DriveError, GoogleDrive } from './drive';
import { syncNotebooks } from './engine';
import { localLibrary, localNotebooks } from './local';
import { syncLibrary } from './library';

export type SyncState =
  /** Signed out. */
  | 'off'
  | 'idle'
  | 'syncing'
  | 'offline'
  /** Drive access has expired (it lasts an hour): the person needs to reconnect. */
  | 'reconnect'
  /** Signed in, but Drive access was not allowed on Google's consent screen. */
  | 'no-drive'
  | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSynced: number | null;
  error: string | null;
}

/** Fired on window with the ids of notebooks that sync changed, added or removed here. */
export const SYNCED_EVENT = 'jnotes:synced';

/** Wait after the last save before sending edits. */
const AFTER_EDITS_MS = 15_000;

let status: SyncStatus = { state: 'off', lastSynced: null, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
};

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => status,
  );
}

/** This browser's id among the person's devices, made once. */
function deviceId(): string {
  try {
    let id = localStorage.getItem('jnotes.deviceId');
    if (!id) localStorage.setItem('jnotes.deviceId', (id = newId()));
    return id;
  } catch {
    return (memoryId ??= newId());
  }
}
let memoryId: string | undefined;

let running = false;
/** Asked for while a sync was running: undefined = nothing, null = everything, else one notebook. */
let again: string | null | undefined;
let editTimer: ReturnType<typeof setTimeout> | undefined;

/** Sync now: one notebook, or every notebook. Coalesces with a sync already running. */
export function syncNow(docId?: string): void {
  if (running) {
    again = again === undefined ? (docId ?? null) : again === docId ? again : null;
    return;
  }
  void run(docId);
}

async function run(only?: string): Promise<void> {
  if (!currentAccount()) return set({ state: 'off', error: null });
  if (!navigator.onLine) return set({ state: 'offline', error: null });
  const token = accessToken();
  if (!token) return set({ state: 'reconnect', error: null });
  if (!canUseDrive(token)) return set({ state: 'no-drive', error: null });

  running = true;
  set({ state: 'syncing', error: null });
  try {
    const drive = new GoogleDrive(() => accessToken()?.token ?? null);
    const device = deviceId();
    // One listing for both: the notebook sync doesn't touch the library's files.
    const files = await drive.list();
    const result = await syncNotebooks({ drive, local: localNotebooks, device, only, files });
    // Then titles, folders, elements and settings: after notebooks, so new ones exist here first.
    const libraryChanged = await syncLibrary({ drive, local: localLibrary, device, files });
    if (result.changed.length || libraryChanged) window.dispatchEvent(new CustomEvent(SYNCED_EVENT, { detail: result.changed }));
    set(
      result.failed.length
        ? { state: 'error', error: `${result.failed.length === 1 ? 'A notebook' : `${result.failed.length} notebooks`} could not sync: ${result.failed[0].error}` }
        : { state: 'idle', lastSynced: Date.now(), error: null },
    );
  } catch (e) {
    if (e instanceof DriveAuthError) set({ state: 'reconnect' });
    else if (!navigator.onLine || (e instanceof TypeError && !(e instanceof DriveError))) set({ state: 'offline' });
    else set({ state: 'error', error: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
  }
  if (again !== undefined) {
    const next = again;
    again = undefined;
    void run(next ?? undefined);
  }
}

export function setUpSync(): void {
  setPersisterHooks({
    opened: (id) => syncNow(id),
    closed: (id) => syncNow(id),
    saved: (id) => {
      clearTimeout(editTimer);
      editTimer = setTimeout(() => syncNow(id), AFTER_EDITS_MS);
    },
  });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => status.state !== 'off' && set({ state: 'offline' }));

  let signedIn = !!currentAccount();
  onAccountChange(() => {
    const now = !!currentAccount();
    if (now === signedIn) return;
    signedIn = now;
    if (now) syncNow();
    else {
      // Signed out: notebooks stay; what sync knew is forgotten, so signing in again starts afresh.
      clearTimeout(editTimer);
      set({ state: 'off', lastSynced: null, error: null });
      void clearSync();
    }
  });
  syncNow();
}
