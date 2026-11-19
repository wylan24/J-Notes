// Connectors: lines whose ends are attached to shapes (or other items) and follow them.
//
// An attachment stores the item's id and a point on its unturned box. Wherever the item goes, the
// end is recomputed from that, so following is a pure function of the page: `followUpOps` runs
// after each change the person makes and appends the connector updates to the same undo step.
import type { Attachment, ItemPatch, LineItem, NotebookDoc, Page, PageItem } from './model';
import type { Vec } from './geometry';
import { distToPolyline, fromBoxPoint, lineEnds, lineGeometry, shapeOutline, toBoxPoint, turnWithShape } from './shapeItems';
import { itemRect, itemRotation } from './items';
import { applyOp, updateItemOp, type DocOp } from './ops';
import { newId } from './ids';

/** Items a connector can attach to: shapes, text boxes, photos and open sticky notes. */
export function canAttach(it: PageItem): boolean {
  return it.kind === 'shape' || it.kind === 'text' || it.kind === 'image' || (it.kind === 'sticky' && !it.collapsed);
}

/** The item's unturned box, and its turn. */
function frame(it: PageItem) {
  const r = itemRect(it);
  return { x: r.minX, y: r.minY, w: r.maxX - r.minX, h: r.maxY - r.minY, rotation: itemRotation(it) };
}

/** The page point an attachment is at, turning with its item. */
export function anchorPoint(it: PageItem, at: Attachment['at']): Vec {
  const f = frame(it);
  return turnWithShape(f, [fromBoxPoint(f, at)])[0];
}

/** The item's outline in its unturned frame: a shape's own outline, otherwise its box. */
function outlineOf(it: PageItem): Vec[] {
  if (it.kind === 'shape') return shapeOutline(it);
  const { x, y, w, h } = frame(it);
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
    { x, y },
  ];
}

/** The nearest point to `p` on a polyline. */
function nearestOn(pts: readonly Vec[], p: Vec): Vec {
  let best = pts[0], bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** Undo an item's turn: a page point into its unturned frame. */
function unturn(it: PageItem, p: Vec): Vec {
  const f = frame(it);
  return f.rotation ? turnWithShape({ ...f, rotation: -f.rotation }, [p])[0] : p;
}

/**
 * Attach to `it` at the point on its edge nearest `p`, so a connector meets the outline wherever it
 * was dropped.
 */
export function attachAt(it: PageItem, p: Vec): Attachment {
  const f = frame(it);
  const onEdge = nearestOn(outlineOf(it), unturn(it, p));
  return { id: it.id, at: toBoxPoint(f, onEdge) };
}

/**
 * What an end dropped at `p` attaches to: the topmost attachable item it is on or within `slop` of
 * the edge of. `skip` leaves out items (the connector itself).
 */
export function attachmentAt(page: Page, p: Vec, slop: number, skip: ReadonlySet<string> = new Set()): Attachment | null {
  for (let i = page.items.length - 1; i >= 0; i--) {
    const it = page.items[i];
    if (skip.has(it.id) || it.locked || !canAttach(it)) continue;
    const local = unturn(it, p);
    const f = frame(it);
    const inside = local.x >= f.x && local.x <= f.x + f.w && local.y >= f.y && local.y <= f.y + f.h;
    if (inside || distToPolyline(local, outlineOf(it)) <= slop) return attachAt(it, p);
  }
  return null;
}

/**
 * Where a line's ends belong now that the items it is attached to may have moved; an attachment to
 * an item that is gone is dropped and that end stays where it is. Returns the patch, or null when
 * nothing changes.
 */
export function followPatch(line: LineItem, byId: ReadonlyMap<string, PageItem>): Partial<LineItem> | null {
  if (!line.from && !line.to) return null;
  const [a0, b0] = lineEnds(line);
  const end = (att: Attachment | undefined, cur: Vec): { p: Vec; keep: boolean } => {
    if (!att) return { p: cur, keep: true };
    const target = byId.get(att.id);
    if (!target || !canAttach(target)) return { p: cur, keep: false };
    return { p: anchorPoint(target, att.at), keep: true };
  };
  const a = end(line.from, a0);
  const b = end(line.to, b0);
  const moved = Math.hypot(a.p.x - a0.x, a.p.y - a0.y) > 1e-6 || Math.hypot(b.p.x - b0.x, b.p.y - b0.y) > 1e-6;
  if (!moved && a.keep && b.keep) return null;
  const patch: Partial<LineItem> = moved ? lineGeometry(a.p, b.p) : {};
  if (!a.keep) patch.from = undefined;
  if (!b.keep) patch.to = undefined;
  return patch;
}

/** The page's connectors re-routed to follow their items, keyed by id (only those that change). */
export function followConnectors(items: readonly PageItem[]): Map<string, LineItem> {
  const byId = new Map(items.map((it) => [it.id, it]));
  const out = new Map<string, LineItem>();
  for (const it of items) {
    if (it.kind !== 'line') continue;
    const patch = followPatch(it, byId);
    if (patch) out.set(it.id, { ...it, ...patch });
  }
  return out;
}

/**
 * A line moved or transformed without the item one of its ends is attached to lets go of it there,
 * rather than being pulled back. The patch drops those attachments (empty when there are none).
 */
export function detachFromUnmoved(it: PageItem, moving: ReadonlySet<string>): ItemPatch {
  if (it.kind !== 'line') return {};
  const patch: ItemPatch = {};
  if (it.from && !moving.has(it.from.id)) patch.from = undefined;
  if (it.to && !moving.has(it.to.id)) patch.to = undefined;
  return patch;
}

/**
 * Attach a newly drawn line's ends to the items they were drawn on the edge of (within `slop`).
 * Ends drawn inside an item stay free, so underlining or dividing a box doesn't fasten to it, and
 * both ends never attach to the same item.
 */
export function attachDrawnLine(page: Page, line: LineItem, slop: number): LineItem {
  const [a, b] = lineEnds(line);
  const onEdge = (p: Vec, not?: string): Attachment | null => {
    for (let i = page.items.length - 1; i >= 0; i--) {
      const it = page.items[i];
      if (it.id === not || it.locked || !canAttach(it)) continue;
      if (distToPolyline(unturn(it, p), outlineOf(it)) <= slop) return attachAt(it, p);
    }
    return null;
  };
  const from = onEdge(a);
  const to = onEdge(b, from?.id);
  if (!from && !to) return line;
  const byId = new Map(page.items.map((it) => [it.id, it]));
  const pa = from ? anchorPoint(byId.get(from.id)!, from.at) : a;
  const pb = to ? anchorPoint(byId.get(to.id)!, to.at) : b;
  return { ...line, ...lineGeometry(pa, pb), ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

const touchesItems = (op: DocOp) => op.type.startsWith('items.') || op.type === 'page.added';

/**
 * After `ops` have been applied to give `doc`, the ops that bring connectors on the pages they
 * touched back onto the items they are attached to.
 */
export function followUpOps(doc: NotebookDoc, ops: readonly DocOp[]): DocOp[] {
  const pageIds = new Set(ops.filter(touchesItems).map((op) => ('pageId' in op ? op.pageId : 'page' in op ? op.page.id : '')));
  const out: DocOp[] = [];
  for (const page of doc.pages) {
    if (!pageIds.has(page.id) || !page.items.some((it) => it.kind === 'line' && (it.from || it.to))) continue;
    const byId = new Map(page.items.map((it) => [it.id, it]));
    for (const it of page.items) {
      const patch = it.kind === 'line' ? followPatch(it, byId) : null;
      const op = patch && updateItemOp(page, it.id, patch as ItemPatch);
      if (op) out.push(op);
    }
  }
  return out;
}

/** Apply ops and their connector follow-ups; returns the doc and every op applied, in order. */
export function applyWithFollowUps(doc: NotebookDoc, ops: readonly DocOp[]): { doc: NotebookDoc; ops: DocOp[] } {
  let next = doc;
  for (const op of ops) next = applyOp(next, op);
  const extra = followUpOps(next, ops);
  for (const op of extra) next = applyOp(next, op);
  return { doc: next, ops: [...ops, ...extra] };
}

/**
 * Copies of items with new ids. Attachments between copied items point at the copies; an
 * attachment to an item that wasn't copied is dropped, so a copy never pulls on the original.
 */
export function reidItems<T extends PageItem>(items: readonly T[]): T[] {
  const ids = new Map(items.map((it) => [it.id, newId()]));
  return items.map((it) => {
    const copy = { ...it, id: ids.get(it.id)! };
    if (copy.kind !== 'line') return copy;
    const remap = (att: Attachment | undefined) => (att && ids.has(att.id) ? { id: ids.get(att.id)!, at: att.at } : undefined);
    const line = copy as LineItem;
    const from = remap(line.from), to = remap(line.to);
    const { from: _f, to: _t, ...rest } = line;
    return { ...rest, ...(from ? { from } : {}), ...(to ? { to } : {}) } as unknown as T;
  });
}

// --- Quick diagramming ------------------------------------------------------------------------

export type Side = 'n' | 'e' | 's' | 'w';
export const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

/** The middle of each side, as a point on the item's box. */
export const SIDE_AT: Record<Side, Attachment['at']> = { n: { x: 0.5, y: 0 }, e: { x: 1, y: 0.5 }, s: { x: 0.5, y: 1 }, w: { x: 0, y: 0.5 } };
const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** Space between a shape and the copy quick diagramming adds beside it, in page units. */
export const QUICK_GAP = 60;

/**
 * Add a copy of a shape beside it on `side` (turned with the shape), joined to it by an arrow from
 * the middle of that side to the middle of the copy's facing side. The copy is kept on the page.
 * Returns the ops (one undo step) and the copy's id, or null if `shapeId` isn't a shape.
 */
export function quickConnectOps(page: Page, shapeId: string, side: Side, size: { w: number; h: number }): { ops: DocOp[]; copyId: string } | null {
  const src = page.items.find((it) => it.id === shapeId);
  if (!src || src.kind !== 'shape') return null;
  const theta = src.rotation ?? 0;
  const c = Math.cos(theta), s = Math.sin(theta);
  // Along the shape's own axes, then turned with it.
  const along = side === 'e' || side === 'w' ? src.w + QUICK_GAP : src.h + QUICK_GAP;
  const sign = side === 'e' || side === 's' ? 1 : -1;
  const [ux, uy] = side === 'e' || side === 'w' ? [c, s] : [-s, c];
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(v, Math.max(0, hi)));
  // Keep the copy's box on the page when there is room for it.
  const x = clamp(src.x + sign * along * ux, size.w - src.w);
  const y = clamp(src.y + sign * along * uy, size.h - src.h);
  const copy: PageItem = { ...src, id: newId(), x, y };
  delete (copy as { locked?: true }).locked;
  const fromAt = SIDE_AT[side], toAt = SIDE_AT[OPPOSITE[side]];
  const a = anchorPoint(src, fromAt), b = anchorPoint(copy, toAt);
  const line: LineItem = {
    id: newId(),
    kind: 'line',
    ...lineGeometry(a, b),
    color: src.color,
    width: src.width,
    arrow: 'end',
    from: { id: src.id, at: fromAt },
    to: { id: copy.id, at: toAt },
  };
  return { ops: [{ type: 'items.added', pageId: page.id, items: [copy, line] }], copyId: copy.id };
}
