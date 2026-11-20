import { describe, expect, it } from 'vitest';
import {
  chooseBase,
  editsAfter,
  fileNames,
  mergeNotebook,
  parseFileName,
  stampEdits,
  type Batch,
  type SnapshotFile,
} from '../src/core/sync';
import type { NotebookDoc } from '../src/core/model';
import { DriveAuthError } from '../src/sync/drive';
import { syncNotebooks } from '../src/sync/engine';
import { Device, ExpiredDrive, FakeDrive, stroke } from './syncFakes';

const doc0: NotebookDoc = { id: 'nb', pages: [{ id: 'p1', template: 'blank', strokes: [], items: [] }] };
const add = (id: string) => ({ type: 'strokes.added' as const, pageId: 'p1', strokes: [stroke(id)] });

describe('sync files', () => {
  it('names files so that one listing describes every notebook', () => {
    expect(parseFileName(fileNames.meta('ab12'))).toEqual({ kind: 'meta', docId: 'ab12' });
    expect(parseFileName(fileNames.snapshot('ab12', 'dev1'))).toEqual({ kind: 'snapshot', docId: 'ab12', device: 'dev1' });
    expect(parseFileName(fileNames.batch('ab12', 'dev1', 4, 9))).toEqual({ kind: 'batch', docId: 'ab12', device: 'dev1', from: 4, to: 9 });
    expect(parseFileName(fileNames.blob('ab12', 'f00d'))).toEqual({ kind: 'blob', docId: 'ab12', blobId: 'f00d' });
    expect(parseFileName(fileNames.deleted('ab12'))).toEqual({ kind: 'deleted', docId: 'ab12' });
    expect(parseFileName('something-else.json')).toBeNull();
  });

  it('starts from the snapshot that includes the most edits, the same one on every device', () => {
    const s = (device: string, vector: Record<string, number>): SnapshotFile => ({ device, vector, lc: 0, doc: doc0 });
    expect(chooseBase([s('b', { a: 3 }), s('a', { a: 2, b: 2 })])?.device).toBe('a');
    expect(chooseBase([s('b', { a: 2 }), s('a', { b: 2 })])?.device).toBe('a');
    expect(chooseBase([])).toBeNull();
  });

  it("applies a device's edits only up to the first missing one", () => {
    const batches: Batch[] = [
      { device: 'a', events: stampEdits([{ docId: 'nb', seq: 1, ts: 0, op: add('1') }], 0) },
      { device: 'a', events: stampEdits([{ docId: 'nb', seq: 3, ts: 0, op: add('3') }], 5) },
    ];
    expect(editsAfter(batches, {}).map((e) => e.seq)).toEqual([1]);
    expect(editsAfter(batches, { a: 2 }).map((e) => e.seq)).toEqual([3]);
  });

  it('works out the same notebook whatever order the files are listed in', () => {
    const snap: SnapshotFile = { device: 'a', vector: { a: 0 }, lc: 0, doc: doc0 };
    const a: Batch = { device: 'a', events: stampEdits([1, 2].map((seq) => ({ docId: 'nb', seq, ts: 0, op: add(`a${seq}`) })), 0) };
    const b: Batch = { device: 'b', events: stampEdits([1, 2].map((seq) => ({ docId: 'nb', seq, ts: 0, op: add(`b${seq}`) })), 0) };
    const one = mergeNotebook([snap], [a, b])!;
    const two = mergeNotebook([snap], [b, a])!;
    expect(one.doc).toEqual(two.doc);
    expect(one.doc.pages[0].strokes.map((s) => s.id)).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(one.vector).toEqual({ a: 2, b: 2 });
  });
});

describe('syncing notebooks between devices', () => {
  function twoDevices() {
    const drive = new FakeDrive();
    const a = new Device('deva', drive);
    const b = new Device('devb', drive);
    return { drive, a, b };
  }

  it('uploads a notebook and downloads it on another device', async () => {
    const { a, b } = twoDevices();
    a.newNotebook('nb');
    a.draw('nb', 'p1', 's1', 's2');
    await a.sync();
    const r = await b.sync();
    expect(r.changed).toEqual(['nb']);
    expect(b.doc('nb')).toEqual(a.doc('nb'));
    expect(b.books.get('nb')!.meta.title).toBe('Notebook nb');
  });

  it('edits made offline on two devices both survive and the devices converge', async () => {
    const { drive, a, b } = twoDevices();
    a.newNotebook('nb');
    a.draw('nb', 'p1', 'base');
    await a.sync();
    await b.sync();

    drive.online = false;
    a.draw('nb', 'p1', 'a1', 'a2');
    a.edit('nb', { type: 'strokes.translated', pageId: 'p1', ids: ['base'], dx: 5, dy: 0 });
    b.draw('nb', 'p1', 'b1');
    b.edit('nb', { type: 'page.added', index: 1, page: { id: 'p2', template: 'blank', strokes: [stroke('b2')], items: [] } });
    await expect(a.sync()).rejects.toThrow('offline');

    drive.online = true;
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.doc('nb')).toEqual(b.doc('nb'));
    expect(a.strokeIds('nb').sort()).toEqual(['a1', 'a2', 'b1', 'base']);
    expect(a.strokeIds('nb', 'p2')).toEqual(['b2']);
    expect(a.doc('nb').pages[0].strokes.find((s) => s.id === 'base')!.points[0].x).toBe(6);
  });

  it('keeps edits made while a sync is in flight, and uploads them next time', async () => {
    const { a, b } = twoDevices();
    a.newNotebook('nb');
    await a.sync();
    await b.sync();
    b.draw('nb', 'p1', 'b1');
    await b.sync();
    a.draw('nb', 'p1', 'a1');
    // An edit lands after A's upload but before it applies the merge.
    const apply = a.apply.bind(a);
    a.apply = async (...args) => {
      a.draw('nb', 'p1', 'during');
      return apply(...args);
    };
    await a.sync();
    a.apply = apply;
    expect(a.strokeIds('nb').sort()).toEqual(['a1', 'b1', 'during']);
    await a.sync();
    await b.sync();
    expect(b.doc('nb')).toEqual(a.doc('nb'));
  });

  it('a page deleted on one device while drawn on in another stays deleted on both', async () => {
    const { a, b } = twoDevices();
    a.newNotebook('nb', { pages: [{ id: 'p1', template: 'blank', strokes: [], items: [] }, { id: 'p2', template: 'blank', strokes: [], items: [] }] });
    await a.sync();
    await b.sync();
    const p2 = a.doc('nb').pages[1];
    a.edit('nb', { type: 'page.removed', page: p2, index: 1 });
    b.draw('nb', 'p2', 'late');
    await b.sync();
    await a.sync();
    await b.sync();
    expect(a.doc('nb')).toEqual(b.doc('nb'));
    expect(a.doc('nb').pages.map((p) => p.id)).toEqual(['p1']);
  });

  it('converges through snapshots, and a third device starting later agrees', async () => {
    const { drive, a, b } = twoDevices();
    a.newNotebook('nb');
    await a.sync();
    await b.sync();
    for (let i = 0; i < 4; i++) {
      a.draw('nb', 'p1', `a${i}`);
      b.draw('nb', 'p1', `b${i}`);
      await a.sync(undefined, 3);
      await b.sync(undefined, 3);
    }
    await a.sync(undefined, 3);
    expect(drive.names().filter((n) => n.includes('.snap.'))).toHaveLength(2);
    const c = new Device('devc', drive);
    await c.sync();
    expect(c.doc('nb')).toEqual(a.doc('nb'));
    expect(b.doc('nb')).toEqual(a.doc('nb'));
    expect(c.strokeIds('nb')).toHaveLength(8);
  });

  it('sends pictures once and fetches them on the other device', async () => {
    const { drive, a, b } = twoDevices();
    a.newNotebook('nb');
    a.books.get('nb')!.blobs.set('img1', { type: 'image/png', bytes: new Uint8Array([1, 2, 3]).buffer });
    await a.sync();
    await b.sync();
    expect(new Uint8Array(b.books.get('nb')!.blobs.get('img1')!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(b.books.get('nb')!.blobs.get('img1')!.type).toBe('image/png');
    const creates = drive.calls.create;
    await a.sync();
    await b.sync();
    expect(drive.calls.create).toBe(creates);
  });

  it('does nothing when nothing changed, and downloads nothing twice', async () => {
    const { drive, a, b } = twoDevices();
    a.newNotebook('nb');
    a.draw('nb', 'p1', 's1');
    await a.sync();
    await b.sync();
    a.draw('nb', 'p1', 's2');
    await a.sync();
    await b.sync();
    const before = { ...drive.calls };
    await a.sync();
    await b.sync();
    expect(drive.calls).toEqual(before);
  });

  it('a notebook deleted on one device is deleted on the other and not uploaded again', async () => {
    const { drive, a, b } = twoDevices();
    a.newNotebook('nb');
    await a.sync();
    await b.sync();
    a.deleteNotebook('nb');
    b.draw('nb', 'p1', 'meanwhile');
    await a.sync();
    expect(drive.names()).toEqual(['n.nb.deleted']);
    const r = await b.sync();
    expect(r.changed).toEqual(['nb']);
    expect(b.books.has('nb')).toBe(false);
    await b.sync();
    await a.sync();
    expect(drive.names()).toEqual(['n.nb.deleted']);
    expect(a.books.has('nb')).toBe(false);
  });

  it('leaves quick notes alone until they are kept', async () => {
    const { drive, a } = twoDevices();
    a.newNotebook('nb');
    a.books.get('nb')!.meta.quicknote = true;
    await a.sync();
    expect(drive.names()).toEqual([]);
  });

  it('stops at once when Drive access has expired', async () => {
    const a = new Device('deva', new ExpiredDrive());
    a.newNotebook('nb');
    await expect(a.sync()).rejects.toBeInstanceOf(DriveAuthError);
  });

  it('three devices editing at random in any sync order end up the same, with every stroke', async () => {
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (let round = 0; round < 20; round++) {
      const drive = new FakeDrive();
      const devices = ['d0', 'd1', 'd2'].map((id) => new Device(id, drive));
      devices[0].newNotebook('nb');
      await devices[0].sync();
      await devices[1].sync();
      await devices[2].sync();
      const drawn = new Set<string>();
      const erased = new Set<string>();
      for (let step = 0; step < 30; step++) {
        const d = devices[rand(3)];
        const action = rand(10);
        if (action < 6) {
          const id = `${d.id}-${step}`;
          d.draw('nb', 'p1', id);
          drawn.add(id);
        } else if (action < 7) {
          // Erase one of this device's own strokes that it can see.
          const mine = d.doc('nb').pages[0].strokes.filter((s) => s.id.startsWith(d.id));
          if (mine.length) {
            const s = mine[rand(mine.length)];
            d.edit('nb', { type: 'strokes.removed', pageId: 'p1', strokes: [s], indices: [0] });
            erased.add(s.id);
          }
        } else {
          await d.sync(undefined, 5);
        }
      }
      for (let pass = 0; pass < 2; pass++) for (const d of devices) await d.sync(undefined, 5);
      const [x, y, z] = devices.map((d) => d.doc('nb'));
      expect(y).toEqual(x);
      expect(z).toEqual(x);
      expect(new Set(devices[0].strokeIds('nb'))).toEqual(new Set([...drawn].filter((id) => !erased.has(id))));
    }
  });

  it('reports progress while a new device downloads every notebook, downloads first', async () => {
    const drive = new FakeDrive();
    const a = new Device('deva', drive);
    for (const id of ['n1', 'n2', 'n3']) a.newNotebook(id);
    const up: number[][] = [];
    await syncNotebooks({ drive, local: a, device: 'deva', onProgress: (p) => up.push([p.done, p.total, p.uploading]) });
    expect(up).toEqual([[0, 3, 3], [1, 3, 3], [2, 3, 3], [3, 3, 3]]);

    const b = new Device('devb', drive);
    b.newNotebook('mine');
    const seen: { done: number; total: number; downloading: number; uploading: number }[] = [];
    const order: string[] = [];
    const create = b.create.bind(b);
    b.create = async (meta, ...rest) => (order.push(meta.id), create(meta, ...rest));
    await syncNotebooks({ drive, local: b, device: 'devb', onProgress: (p) => seen.push({ ...p }) });
    expect(seen[0]).toEqual({ done: 0, total: 4, downloading: 3, uploading: 1 });
    expect(seen.at(-1)!.done).toBe(4);
    expect(order).toEqual(['n1', 'n2', 'n3']);

    // An everyday sync of a few edits shows no progress bar.
    b.draw('n1', 'p1', 'x');
    const quiet: unknown[] = [];
    await syncNotebooks({ drive, local: b, device: 'devb', onProgress: (p) => quiet.push(p) });
    expect(quiet).toEqual([]);
  });
});
