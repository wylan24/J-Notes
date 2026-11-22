// Editing a notebook together, live. Collaborators' edits arrive over the relay in whatever order
// the network delivers them; this keeps the notebook in the order Drive sync uses (core/sync:
// clock, then device, then seq), so live editing and sync always agree.
//
// Usually an edit sorts after everything already applied, and is simply applied. When one
// arrives late (it sorts earlier), the notebook is rebuilt from where the session started. A
// device's edits are only applied in its own order: one that arrives before an earlier one from
// the same device waits for it.
import { applyOp, type DocEvent } from './ops';
import type { NotebookDoc } from './model';
import { compareEdits, type Ordered, type SyncedEvent, type Vector } from './sync';

export interface LiveEdit extends SyncedEvent {
  device: string;
}

export class LiveDoc {
  /** The notebook with every edit applied so far, in the shared order. */
  doc: NotebookDoc;
  /** Times the notebook had to be rebuilt for a late edit (for tests and diagnostics). */
  rebuilds = 0;
  private log: Ordered[] = [];
  /** The last edit applied from each device: the start's vector, then live edits. */
  private seen: Vector;
  private waiting = new Map<string, Map<number, LiveEdit>>();
  private clock: number;

  /**
   * @param base the notebook when the session starts (after a sync), with how far it reaches into
   *   each device's edits and the highest clock value in it.
   */
  constructor(
    private base: { doc: NotebookDoc; vector: Vector; lc: number },
    readonly device: string,
  ) {
    this.doc = base.doc;
    this.seen = { ...base.vector };
    this.clock = base.lc;
  }

  /** The highest clock value seen: this device's next edit is numbered above it. */
  get lc(): number {
    return this.clock;
  }

  /**
   * Number this device's own new edits (already applied on screen) and record them. Returns them
   * as they are sent to collaborators.
   */
  local(events: readonly DocEvent[]): LiveEdit[] {
    const out: LiveEdit[] = [];
    for (const e of events) {
      const edit: LiveEdit = { device: this.device, seq: e.seq, lc: ++this.clock, ts: e.ts, op: e.op };
      // Sorts after everything applied, by construction.
      this.doc = applyOp(this.doc, edit.op);
      this.log.push(edit);
      this.seen[this.device] = e.seq;
      out.push(edit);
    }
    return out;
  }

  /** Collaborators' edits, in any order, repeats included. Returns whether the notebook changed. */
  receive(edits: readonly LiveEdit[]): boolean {
    for (const e of edits) {
      if (e.seq <= (this.seen[e.device] ?? 0)) continue; // already applied
      let w = this.waiting.get(e.device);
      if (!w) this.waiting.set(e.device, (w = new Map()));
      w.set(e.seq, e);
    }
    // Everything now ready: each device's edits from the one after its last applied, without gaps.
    const ready: Ordered[] = [];
    for (const [device, w] of this.waiting) {
      for (let seq = (this.seen[device] ?? 0) + 1; w.has(seq); seq++) {
        ready.push(w.get(seq)!);
        w.delete(seq);
        this.seen[device] = seq;
      }
      if (!w.size) this.waiting.delete(device);
    }
    if (!ready.length) return false;
    ready.sort(compareEdits);

    const last = this.log[this.log.length - 1];
    if (!last || compareEdits(ready[0], last) > 0) {
      for (const e of ready) this.doc = applyOp(this.doc, e.op);
      this.log.push(...ready);
    } else {
      // A late edit: put everything in order and start again from the base.
      this.log = [...this.log, ...ready].sort(compareEdits);
      this.doc = this.log.reduce((d, e) => applyOp(d, e.op), this.base.doc);
      this.rebuilds++;
    }
    for (const e of ready) this.clock = Math.max(this.clock, e.lc);
    return true;
  }

  /** Edits received ahead of an earlier one from the same device, still waiting for it. */
  get waitingCount(): number {
    let n = 0;
    for (const w of this.waiting.values()) n += w.size;
    return n;
  }
}
