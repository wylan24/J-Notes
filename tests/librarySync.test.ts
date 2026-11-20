import { describe, expect, it } from 'vitest';
import { canonical, keys, latestEntries, parseKey, planLibrary, type Entry } from '../src/core/librarySync';
import { FakeDrive, Library } from './syncFakes';

const e = (v: unknown, t: number, d = 'x'): Entry => ({ v, t, d });

describe('library entries', () => {
  it('reads back only the entries that sync', () => {
    expect(parseKey(keys.meta('ab', 'title'))).toEqual({ kind: 'meta', docId: 'ab', field: 'title' });
    expect(parseKey('meta.ab.thumbnail')).toBeNull();
    expect(parseKey(keys.folder('f1'))).toEqual({ kind: 'folder', id: 'f1' });
    expect(parseKey(keys.setting('jnotes.presets'))).toEqual({ kind: 'setting', key: 'jnotes.presets' });
    expect(parseKey(keys.setting('jnotes.penOnly'))).toBeNull();
    expect(parseKey(keys.setting('jnotes.googleToken'))).toBeNull();
  });

  it('compares values whatever order their fields are in', () => {
    expect(canonical({ a: 1, b: { d: 2, c: undefined } })).toBe(canonical({ b: { c: null, d: 2 }, a: 1 }));
  });

  it('the latest change wins, ties broken by device', () => {
    const m = latestEntries([
      { device: 'a', entries: { k: e('A', 5, 'a'), j: e('A', 1, 'a') } },
      { device: 'b', entries: { k: e('B', 5, 'b'), j: e('B', 2, 'b') } },
    ]);
    expect(m.get('k')!.v).toBe('B');
    expect(m.get('j')!.v).toBe('B');
  });

  it("a value never synced here takes other devices' value instead of overwriting it", () => {
    const plan = planLibrary({ local: new Map([['k', 'Untitled']]), ledger: new Map(), remote: new Map([['k', e('Biology', 50)]]), device: 'me', now: 10 });
    expect(plan.changed.size).toBe(0);
    expect(plan.apply.get('k')).toBe('Biology');
  });

  it('a change here is newer than anything seen, even with a slow clock', () => {
    const plan = planLibrary({ local: new Map([['k', 'Mine']]), ledger: new Map([['k', e('Old', 90)]]), remote: new Map([['k', e('Old', 90)]]), device: 'me', now: 10 });
    expect(plan.changed.get('k')).toEqual({ v: 'Mine', t: 91, d: 'me' });
    expect(plan.apply.size).toBe(0);
  });
});

describe('syncing the library between devices', () => {
  function two() {
    const drive = new FakeDrive();
    const a = new Library('deva', drive);
    const b = new Library('devb', drive);
    for (const lib of [a, b]) lib.addNotebook('nb');
    return { drive, a, b };
  }

  it('a rename on one device and a favourite on the other both arrive', async () => {
    const { a, b } = two();
    await a.sync();
    await b.sync();
    a.metas.get('nb')!.title = 'Biology';
    b.metas.get('nb')!.favourite = true;
    await a.sync();
    await b.sync();
    await a.sync();
    for (const lib of [a, b]) expect(lib.metas.get('nb')).toMatchObject({ title: 'Biology', favourite: true });
  });

  it('when both rename, the later rename wins on both', async () => {
    const { a, b } = two();
    await a.sync();
    await b.sync();
    a.metas.get('nb')!.title = 'First';
    await a.sync();
    b.metas.get('nb')!.title = 'Second';
    await b.sync();
    await a.sync();
    expect(a.metas.get('nb')!.title).toBe('Second');
    expect(b.metas.get('nb')!.title).toBe('Second');
  });

  it('a notebook arriving later gets the title set elsewhere, not its original one', async () => {
    const { a } = two();
    a.metas.get('nb')!.title = 'Biology';
    await a.sync();
    const c = new Library('devc', a.drive);
    await c.sync(); // the notebook isn't here yet: its entries wait
    c.addNotebook('nb', { title: 'Untitled' }); // downloaded with its first title
    await c.sync();
    expect(c.metas.get('nb')!.title).toBe('Biology');
    await a.sync();
    expect(a.metas.get('nb')!.title).toBe('Biology');
  });

  it('moving to trash, into a folder and back out travels too (fields removed included)', async () => {
    const { a, b } = two();
    a.folders.set('f1', { id: 'f1', name: 'School', color: '#123456', parentId: null, createdAt: 1 });
    a.metas.get('nb')!.folderId = 'f1';
    await a.sync();
    await b.sync();
    expect(b.folders.get('f1')!.name).toBe('School');
    expect(b.metas.get('nb')!.folderId).toBe('f1');
    delete a.metas.get('nb')!.folderId;
    a.metas.get('nb')!.trashedAt = 123;
    await a.sync();
    await b.sync();
    expect(b.metas.get('nb')!.folderId).toBeUndefined();
    expect(b.metas.get('nb')!.trashedAt).toBe(123);
  });

  it('folders: made, renamed and deleted', async () => {
    const { a, b } = two();
    b.folders.set('f1', { id: 'f1', name: 'Work', color: '#000000', parentId: null, createdAt: 1 });
    await b.sync();
    await a.sync();
    a.folders.set('f1', { ...a.folders.get('f1')!, name: 'Job' });
    await a.sync();
    await b.sync();
    expect(b.folders.get('f1')!.name).toBe('Job');
    b.folders.delete('f1');
    await b.sync();
    await a.sync();
    expect(a.folders.has('f1')).toBe(false);
  });

  it('saved elements arrive with their photos, and renames and deletes follow', async () => {
    const { a, b } = two();
    a.elements.set('e1', { id: 'e1', name: 'Star', createdAt: 5, thumbnail: 'data:,', strokes: [], items: [], blobs: [{ id: 'img', type: 'image/png', bytes: new Uint8Array([9, 8, 7]).buffer }] } as never);
    await a.sync();
    await b.sync();
    const got = b.elements.get('e1')!;
    expect(got.name).toBe('Star');
    expect(new Uint8Array(got.blobs[0].bytes)).toEqual(new Uint8Array([9, 8, 7]));
    b.elements.set('e1', { ...got, name: 'Gold star' });
    await b.sync();
    await a.sync();
    expect(a.elements.get('e1')!.name).toBe('Gold star');
    a.elements.delete('e1');
    await a.sync();
    await b.sync();
    expect(b.elements.has('e1')).toBe(false);
  });

  it('preferences follow the person; device choices are not uploaded', async () => {
    const { a, b } = two();
    a.settings.set('jnotes.presets', [{ id: 'p', color: '#f00' }]);
    a.settings.set('jnotes.penOnly', true);
    await a.sync();
    await b.sync();
    expect(b.settings.get('jnotes.presets')).toEqual([{ id: 'p', color: '#f00' }]);
    expect(b.settings.has('jnotes.penOnly')).toBe(false);
  });

  it('writes nothing when nothing changed', async () => {
    const { drive, a, b } = two();
    a.metas.get('nb')!.title = 'X';
    await a.sync();
    await b.sync();
    await a.sync();
    const before = { ...drive.calls };
    await a.sync();
    await b.sync();
    expect(drive.calls.create).toBe(before.create);
    expect(drive.calls.update).toBe(before.update);
  });
});
