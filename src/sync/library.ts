// One round of syncing the library, saved elements and settings (core/librarySync decides what
// wins). Runs after notebooks sync, so a notebook made elsewhere exists here before its title,
// folder and so on are set.
import type { SavedElement } from '../core/elements';
import { canonical, latestEntries, parseKey, planLibrary, type Entry, type LibraryFile } from '../core/librarySync';
import { jsonBlob, readJson, type Drive, type DriveFile } from './drive';

/** The device's library, settings and elements, as the library sync needs them. */
export interface LocalLibrary {
  /** Every synced value here, by entry key (see core/librarySync `keys`). */
  values(): Promise<Map<string, unknown>>;
  /** Set a value changed elsewhere (null = remove it). Not for an element new to this device. */
  set(key: string, value: unknown): Promise<void>;
  ledger(): Promise<Map<string, Entry>>;
  setLedger(ledger: Map<string, Entry>): Promise<void>;
  element(id: string): Promise<SavedElement | undefined>;
  addElement(el: SavedElement): Promise<void>;
  cached<T>(name: string, version: string): Promise<T | undefined>;
  cache(name: string, version: string, value: unknown): Promise<void>;
}

const libraryFile = (device: string) => `lib.${device}.json`;
const elementFile = (id: string) => `el.${id}.json`;
const LIBRARY_FILE = /^lib\.([a-z0-9]+)\.json$/;

/** An element as stored in Drive: photo bytes as base64, since it is JSON. */
type ElementFile = Omit<SavedElement, 'blobs'> & { blobs: { id: string; type: string; base64: string }[] };

const toBase64 = (bytes: ArrayBuffer): string => {
  let s = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s: string): ArrayBuffer => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

/** Returns whether anything here changed. */
export async function syncLibrary(o: { drive: Drive; local: LocalLibrary; device: string; files?: DriveFile[]; now?: number }): Promise<boolean> {
  const { drive, local, device } = o;
  const files = o.files ?? (await drive.list());
  const json = async <T>(f: DriveFile): Promise<T> => {
    const hit = await local.cached<T>(f.name, f.modifiedTime);
    if (hit !== undefined) return hit;
    const v = await readJson<T>(drive, f.id);
    await local.cache(f.name, f.modifiedTime, v);
    return v;
  };

  const libFiles = files.filter((f) => LIBRARY_FILE.test(f.name));
  const ownFile = libFiles.find((f) => f.name === libraryFile(device));
  const remoteFiles = await Promise.all(libFiles.map((f) => json<LibraryFile>(f)));
  const own = remoteFiles.find((f) => f.device === device);
  const elementFiles = new Map(files.filter((f) => /^el\.[a-z0-9]+\.json$/.test(f.name)).map((f) => [f.name, f]));

  const values = await local.values();
  const notebooks = new Set<string>();
  for (const k of values.keys()) {
    const p = parseKey(k);
    if (p?.kind === 'meta') notebooks.add(p.docId);
  }
  const ledger = await local.ledger();
  const plan = planLibrary({
    local: values,
    ledger,
    remote: latestEntries(remoteFiles),
    device,
    now: o.now ?? Date.now(),
    // A notebook's entries wait until it exists here.
    ignore: (k) => {
      const p = parseKey(k);
      return !p || (p.kind === 'meta' && !notebooks.has(p.docId));
    },
  });

  // Upload first: if that fails, nothing here changes and the next sync tries again.
  for (const [key, e] of plan.changed) {
    const p = parseKey(key);
    if (p?.kind !== 'element' || e.v === null || elementFiles.has(elementFile(p.id))) continue;
    const el = await local.element(p.id);
    if (el) await drive.create(elementFile(p.id), jsonBlob({ ...el, blobs: el.blobs.map((b) => ({ id: b.id, type: b.type, base64: toBase64(b.bytes) })) } satisfies ElementFile));
  }
  if (plan.changed.size) {
    const file: LibraryFile = { device, entries: { ...(own?.entries ?? {}), ...Object.fromEntries(plan.changed) } };
    const f = ownFile ? await drive.update(ownFile.id, jsonBlob(file)) : await drive.create(libraryFile(device), jsonBlob(file));
    await local.cache(f.name, f.modifiedTime, file);
  }

  // Then bring in what changed elsewhere.
  let changedHere = false;
  for (const [key, v] of plan.apply) {
    const p = parseKey(key)!;
    if (p.kind === 'element' && v !== null && !values.has(key)) {
      // An element new here: fetch it, if it has been uploaded yet.
      const f = elementFiles.get(elementFile(p.id));
      if (!f) {
        // Not yet: forget the entry, so it is fetched next time rather than taken as deleted here.
        const before = ledger.get(key);
        if (before && canonical(before.v) !== 'null') plan.ledger.set(key, before);
        else plan.ledger.delete(key);
        continue;
      }
      const el = await json<ElementFile>(f);
      await local.addElement({ ...el, ...(v as Partial<SavedElement>), blobs: el.blobs.map((b) => ({ id: b.id, type: b.type, bytes: fromBase64(b.base64) })) });
    } else await local.set(key, v);
    changedHere = true;
  }
  await local.setLedger(plan.ledger);
  return changedHere;
}
