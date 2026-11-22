import { describe, expect, it } from 'vitest';
import { LiveDoc, type LiveEdit } from '../src/core/live';
import type { DocEvent, DocOp } from '../src/core/ops';
import { mergeNotebook, stampEdits, type Batch } from '../src/core/sync';
import type { NotebookDoc } from '../src/core/model';
import { stroke } from './syncFakes';

const base: NotebookDoc = { id: 'nb', pages: [{ id: 'p1', template: 'blank', strokes: [stroke('base')], items: [] }, { id: 'p2', template: 'blank', strokes: [], items: [] }] };
const start = { doc: base, vector: {}, lc: 0 };

/** A participant: makes edits on its own copy (as the editor does), numbers them, and sends them. */
class Participant {
  live: LiveDoc;
  seq = 0;
  sent: LiveEdit[] = [];
  constructor(readonly id: string) {
    this.live = new LiveDoc(start, id);
  }
  edit(op: DocOp): LiveEdit[] {
    const e: DocEvent = { docId: 'nb', seq: ++this.seq, ts: 0, op };
    const out = this.live.local([e]);
    this.sent.push(...out);
    return out;
  }
}

const ids = (d: NotebookDoc, page = 0) => d.pages[page]?.strokes.map((s) => s.id) ?? [];

describe('live editing', () => {
  it('edits delivered in order are simply applied, never rebuilt', () => {
    const people = ['a', 'b', 'c'].map((id) => new Participant(id));
    for (let i = 0; i < 10; i++) {
      const p = people[i % 3];
      const out = p.edit({ type: 'strokes.added', pageId: 'p1', strokes: [stroke(`${p.id}${i}`)] });
      for (const q of people) if (q !== p) q.live.receive(out);
    }
    for (const p of people) expect(p.live.rebuilds).toBe(0);
    expect(people[1].live.doc).toEqual(people[0].live.doc);
    expect(people[2].live.doc).toEqual(people[0].live.doc);
    expect(ids(people[0].live.doc)).toHaveLength(11);
  });

  it('an edit that overtakes an earlier one from the same device waits for it', () => {
    const a = new Participant('a');
    const b = new Participant('b');
    const [first] = a.edit({ type: 'strokes.added', pageId: 'p1', strokes: [stroke('x')] });
    const [second] = a.edit({ type: 'strokes.translated', pageId: 'p1', ids: ['x'], dx: 5, dy: 0 });
    expect(b.live.receive([second])).toBe(false);
    expect(b.live.waitingCount).toBe(1);
    expect(b.live.receive([first])).toBe(true);
    expect(b.live.waitingCount).toBe(0);
    expect(b.live.doc).toEqual(a.live.doc);
  });

  it('three people with delays, reordering and repeats end identical, and identical to Drive sync', () => {
    let seed = 11;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (let round = 0; round < 25; round++) {
      const people = ['a', 'b', 'c'].map((id) => new Participant(id));
      // Messages in flight to each person, delivered in random order and sometimes twice.
      const inbox = new Map(people.map((p) => [p, [] as LiveEdit[]]));
      for (let step = 0; step < 40; step++) {
        const p = people[rand(3)];
        const action = rand(10);
        if (action < 5) {
          const out = p.edit({ type: 'strokes.added', pageId: rand(2) ? 'p1' : 'p2', strokes: [stroke(`${p.id}-${step}`)] });
          for (const q of people) if (q !== p) inbox.get(q)!.push(...out);
        } else if (action < 6) {
          const mine = p.live.doc.pages[0].strokes.filter((s) => s.id !== 'base');
          if (mine.length) {
            const s = mine[rand(mine.length)];
            const out = p.edit({ type: 'strokes.removed', pageId: 'p1', strokes: [s], indices: [0] });
            for (const q of people) if (q !== p) inbox.get(q)!.push(...out);
          }
        } else if (action < 7) {
          const out = p.edit({ type: 'strokes.translated', pageId: 'p1', ids: ['base'], dx: 1, dy: 0 });
          for (const q of people) if (q !== p) inbox.get(q)!.push(...out);
        } else {
          // Deliver a few of this person's messages, in random order, sometimes repeated.
          const box = inbox.get(p)!;
          const n = rand(box.length + 1);
          const batch: LiveEdit[] = [];
          for (let k = 0; k < n; k++) {
            const i = rand(box.length);
            batch.push(box[i]);
            if (rand(4)) box.splice(i, 1);
          }
          p.live.receive(batch);
        }
      }
      for (const p of people) p.live.receive(inbox.get(p)!.reverse());

      const [x, y, z] = people.map((p) => p.live.doc);
      expect(y).toEqual(x);
      expect(z).toEqual(x);
      for (const p of people) expect(p.live.waitingCount).toBe(0);

      // Drive sync, given the same edits with the numbers they were made with, agrees.
      const batches: Batch[] = people.map((p) => ({
        device: p.id,
        events: stampEdits(
          p.sent.map((e) => ({ docId: 'nb', seq: e.seq, ts: e.ts, op: e.op, lc: e.lc })),
          0,
        ),
      }));
      const merged = mergeNotebook([{ device: 'a', vector: {}, lc: 0, doc: base }], batches)!;
      expect(merged.doc).toEqual(x);
    }
  });

  it("an edit made after seeing someone else's comes after it everywhere", () => {
    const a = new Participant('a');
    const b = new Participant('b');
    const c = new Participant('c');
    const made = a.edit({ type: 'strokes.added', pageId: 'p1', strokes: [stroke('x')] });
    b.live.receive(made);
    const moved = b.edit({ type: 'strokes.translated', pageId: 'p1', ids: ['x'], dx: 10, dy: 0 });
    // C hears about the move first: it waits for nothing (another device), but sorts after the add.
    c.live.receive(moved);
    c.live.receive(made);
    expect(c.live.doc).toEqual(b.live.doc);
    expect(c.live.doc.pages[0].strokes.find((s) => s.id === 'x')!.points[0].x).toBe(11);
  });

  it('Drive sync keeps the numbers edits were made with', () => {
    const e = (seq: number, lc?: number): DocEvent => ({ docId: 'nb', seq, ts: 0, op: { type: 'strokes.added', pageId: 'p1', strokes: [stroke(`s${seq}`)] }, lc });
    expect(stampEdits([e(1, 7), e(2, 9)], 20).map((x) => x.lc)).toEqual([7, 9]);
    expect(stampEdits([e(1), e(2)], 20).map((x) => x.lc)).toEqual([21, 22]);
    // Never out of the device's own order.
    expect(stampEdits([e(1, 7), e(2, 3), e(3)], 4).map((x) => x.lc)).toEqual([7, 8, 9]);
  });
});
