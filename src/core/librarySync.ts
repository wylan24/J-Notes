// Syncing the library (notebook titles, covers, folders, trash...), saved elements and settings.
// Pure: what is synced and how changes from several devices are settled.
//
// These are small values, each changed as a whole, so each is an entry ("meta.<doc>.title",
// "folder.<id>", "setting.jnotes.presets"...) and the latest change to an entry wins. Each device
// keeps its own file of the entries it changed, so devices never overwrite each other's files.
//
// Nothing has to report changes: at each sync a device compares what it has with what it last
// synced (its ledger), and whatever differs it changed since.
import type { NotebookMeta } from './model';

/** A value as last set by some device: `t` orders changes (a clock that never goes backwards). */
export interface Entry {
  v: unknown;
  t: number;
  /** The device that set it; breaks ties between equal times. */
  d: string;
}

/** One device's file: the entries it changed. */
export interface LibraryFile {
  device: string;
  entries: Record<string, Entry>;
}

/** Notebook fields that sync. Not: content-derived ones (pages, thumbnail, deck), times, kind. */
export const SYNCED_META_FIELDS = ['title', 'cover', 'coverImage', 'favourite', 'trashedAt', 'folderId', 'lock', 'template'] as const satisfies readonly (keyof NotebookMeta)[];
export type SyncedMetaField = (typeof SYNCED_META_FIELDS)[number];

/**
 * Preferences that follow the person between devices. Choices about the device itself stay put:
 * stylus only, theme, handwriting recognition (a large download), zoom, open tabs, the sidebar.
 */
export const SYNCED_SETTINGS = [
  'jnotes.eraser',
  'jnotes.ink',
  'jnotes.lasso',
  'jnotes.library',
  'jnotes.presets',
  'jnotes.readOnly',
  'jnotes.scribbleErase',
  'jnotes.scroll',
  'jnotes.snap',
  'jnotes.spell.words',
  'jnotes.stickyColor',
  'jnotes.swatches',
  'jnotes.tapeColor',
  'jnotes.text',
  'jnotes.toolbar',
] as const;

export const keys = {
  meta: (docId: string, field: SyncedMetaField) => `meta.${docId}.${field}`,
  folder: (id: string) => `folder.${id}`,
  element: (id: string) => `element.${id}`,
  setting: (key: string) => `setting.${key}`,
};

export type EntryKey =
  | { kind: 'meta'; docId: string; field: SyncedMetaField }
  | { kind: 'folder'; id: string }
  | { kind: 'element'; id: string }
  | { kind: 'setting'; key: string };

export function parseKey(key: string): EntryKey | null {
  const [kind, ...rest] = key.split('.');
  if (kind === 'meta' && rest.length === 2 && (SYNCED_META_FIELDS as readonly string[]).includes(rest[1])) return { kind, docId: rest[0], field: rest[1] as SyncedMetaField };
  if ((kind === 'folder' || kind === 'element') && rest.length === 1 && rest[0]) return { kind, id: rest[0] };
  if (kind === 'setting' && (SYNCED_SETTINGS as readonly string[]).includes(rest.join('.'))) return { kind, key: rest.join('.') };
  return null;
}

/** JSON with object keys sorted and undefined as null, so equal values always compare equal. */
export function canonical(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, (x as Record<string, unknown>)[k] ?? null]),
        )
      : x,
  );
}

const later = (a: Entry, b: Entry) => a.t > b.t || (a.t === b.t && a.d > b.d);

/** The latest change to every entry, across every device's file. */
export function latestEntries(files: readonly LibraryFile[]): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const f of files)
    for (const [k, e] of Object.entries(f.entries)) {
      const cur = out.get(k);
      if (!cur || later(e, cur)) out.set(k, e);
    }
  return out;
}

export interface LibraryPlan {
  /** Entries changed on this device since the last sync, to add to its file. */
  changed: Map<string, Entry>;
  /** Values to set on this device (null = remove), changed elsewhere. */
  apply: Map<string, unknown>;
  /** What this device has after both: the new ledger. */
  ledger: Map<string, Entry>;
}

/**
 * Settle this device's values (`local`, by entry key; absent = doesn't exist here) against the
 * latest from every device (`remote`), given what it had after the last sync (`ledger`).
 *
 * - Changed here since the last sync: this device's change, newer than anything it has seen.
 * - Never synced here but known elsewhere: theirs. (A notebook just downloaded, or a device
 *   signing in for the first time, doesn't overwrite what the person set on other devices.)
 * - Otherwise the latest wins, wherever it was made.
 */
export function planLibrary(o: {
  local: ReadonlyMap<string, unknown>;
  ledger: ReadonlyMap<string, Entry>;
  remote: ReadonlyMap<string, Entry>;
  device: string;
  now: number;
  /** Entries to leave alone this time (a notebook's, until it exists here); their ledger is kept. */
  ignore?: (key: string) => boolean;
}): LibraryPlan {
  const { local, ledger, remote, device, ignore } = o;
  let clock = o.now;
  for (const e of remote.values()) clock = Math.max(clock, e.t + 1);
  for (const e of ledger.values()) clock = Math.max(clock, e.t + 1);

  const changed = new Map<string, Entry>();
  const apply = new Map<string, unknown>();
  const result = new Map<string, Entry>();
  const all = new Set([...local.keys(), ...ledger.keys(), ...remote.keys()]);
  for (const key of all) {
    if (ignore?.(key)) {
      const kept = ledger.get(key);
      if (kept) result.set(key, kept);
      continue;
    }
    const here = local.has(key) ? local.get(key) : null;
    const before = ledger.get(key);
    const theirs = remote.get(key);
    const mineChanged = before ? canonical(here) !== canonical(before.v) : !theirs && local.has(key);
    let winner: Entry | undefined;
    if (mineChanged) {
      winner = { v: here ?? null, t: clock, d: device };
      changed.set(key, winner);
    } else winner = theirs && (!before || later(theirs, before)) ? theirs : before;
    if (!winner) continue;
    result.set(key, winner);
    if (canonical(winner.v) !== canonical(here)) apply.set(key, winner.v);
  }
  return { changed, apply, ledger: result };
}
