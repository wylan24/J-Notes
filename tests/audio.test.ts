import { describe, expect, it } from 'vitest';
import type { NotebookDoc, Recording, Stroke } from '../src/core/model';
import { applyOp, inverseOp } from '../src/core/ops';
import { DocumentStore } from '../src/core/store';
import { playbackState, seekTimeFor, stampShape, strokeAtForSeek, strokeStartTime } from '../src/core/audio';
import { referencedBlobIds } from '../src/io/notebookFile';
import { makeElementContent } from '../src/core/elements';

const rec: Recording = { id: 'r1', blobId: 'b1', name: 'Recording 1', createdAt: 1, durationMs: 60_000, mimeType: 'audio/webm' };
const stroke = (id: string, t: number | null, recId = 'r1'): Stroke => ({
  id,
  tool: 'pen',
  color: '#000',
  width: 2,
  simulatePressure: false,
  ...(t === null ? {} : { rec: recId }),
  points: [
    { x: 10, y: 10, p: 0.5, ...(t === null ? {} : { t }) },
    { x: 50, y: 10, p: 0.5, ...(t === null ? {} : { t: t + 400 }) },
  ],
});
const doc = (): NotebookDoc => ({ id: 'd', pages: [{ id: 'p', template: 'blank', strokes: [stroke('a', 1000), stroke('b', 5000), stroke('c', null)], items: [] }] });

describe('recording ops', () => {
  it('add and remove are each undone by their inverse, keeping list order', () => {
    const d = { ...doc(), recordings: [rec] };
    const r2 = { ...rec, id: 'r2', blobId: 'b2' };
    const add = { type: 'recording.added' as const, recording: r2 };
    const after = applyOp(d, add);
    expect(after.recordings!.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(applyOp(after, inverseOp(add))).toEqual(d);
    const remove = { type: 'recording.removed' as const, recording: rec, index: 0 };
    const removed = applyOp(after, remove);
    expect(removed.recordings!.map((r) => r.id)).toEqual(['r2']);
    expect(applyOp(removed, inverseOp(remove)).recordings!.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('works on notebooks saved before recordings existed', () => {
    const store = new DocumentStore(doc());
    store.dispatch([{ type: 'recording.added', recording: rec }]);
    expect(store.doc.recordings).toEqual([rec]);
    store.undo();
    expect(store.doc.recordings).toEqual([]);
  });
});

describe('sync', () => {
  it('a stroke starts at its first timestamp', () => {
    expect(strokeStartTime(stroke('a', 1000))).toBe(1000);
    expect(strokeStartTime(stroke('c', null))).toBeNull();
  });

  it('during playback, ink not yet reached is "ahead"; other ink is unaffected', () => {
    expect(playbackState(stroke('a', 1000), 'r1', 3000)).toBe('played');
    expect(playbackState(stroke('b', 5000), 'r1', 3000)).toBe('ahead');
    expect(playbackState(stroke('c', null), 'r1', 3000)).toBeNull();
    expect(playbackState(stroke('x', 5000, 'r2'), 'r1', 3000)).toBeNull();
  });

  it('seeking starts a little before the ink, never before zero', () => {
    expect(seekTimeFor(stroke('b', 5000))).toBe(4000);
    expect(seekTimeFor(stroke('a', 300))).toBe(0);
  });

  it('finds the recorded stroke under a tap', () => {
    const page = doc().pages[0];
    expect(strokeAtForSeek(page.strokes, { x: 30, y: 12 }, 6)?.id).toBe('b'); // topmost recorded stroke
    expect(strokeAtForSeek([stroke('c', null)], { x: 30, y: 12 }, 6)).toBeNull();
    expect(strokeAtForSeek(page.strokes, { x: 300, y: 300 }, 6)).toBeNull();
  });

  it('shapes made from recorded ink keep the recording time', () => {
    const pts = [{ x: 0, y: 0, p: 0.5 }, { x: 5, y: 5, p: 0.5 }];
    expect(stampShape(pts, 2500).every((p) => p.t === 2500)).toBe(true);
    expect(stampShape(pts, undefined)).toBe(pts);
  });
});

describe('recordings travel with the notebook', () => {
  it('export includes the audio blobs', () => {
    expect(referencedBlobIds({ ...doc(), recordings: [rec] })).toEqual(['b1']);
  });

  it('elements drop the link to a recording', () => {
    const c = makeElementContent(doc().pages[0], { pageId: 'p', strokeIds: ['a'], itemIds: [] })!;
    expect(c.strokes[0].rec).toBeUndefined();
    expect(c.strokes[0].points[0].t).toBeUndefined();
  });
});
