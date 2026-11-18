import { describe, expect, it } from 'vitest';
import type { NotebookDoc, NotebookMeta, OutlineEntry } from '../src/core/model';
import { applyOp, inverseOp } from '../src/core/ops';
import { addOutlineEntry, normaliseLevels, removeOutlineEntry, renameOutlineEntry, shiftOutlineEntry, visibleOutline } from '../src/core/outline';
import { fromFile, toFile } from '../src/io/notebookFile';

const pages = ['p1', 'p2', 'p3'].map((id) => ({ id, template: 'blank' as const, strokes: [], items: [] }));
const doc = (outline?: OutlineEntry[]): NotebookDoc => ({ id: 'd', pages, ...(outline ? { outline } : {}) });
const e = (id: string, pageId: string, level: number, y?: number): OutlineEntry => ({ id, title: id, pageId, level, ...(y !== undefined ? { rect: { x: 0, y, w: 10, h: 10 } } : {}) });
const shape = (d: NotebookDoc) => (d.outline ?? []).map((x) => `${'  '.repeat(x.level)}${x.title}`);

describe('outlines', () => {
  it('adds entries in reading order, joining the section they fall in', () => {
    let d = doc();
    const add = (pageId: string, title: string, y?: number) => {
      d = applyOp(d, addOutlineEntry(d, { pageId, ...(y !== undefined ? { rect: { x: 0, y, w: 5, h: 5 } } : {}) }, title)!.op);
    };
    add('p3', 'Results');
    add('p1', 'Intro');
    add('p2', 'Method', 400);
    add('p2', 'Setup', 100);
    expect(shape(d)).toEqual(['Intro', 'Setup', 'Method', 'Results']);
    d = applyOp(d, shiftOutlineEntry(d, d.outline![2].id, 1)!); // Method under Setup
    add('p2', 'Detail', 500); // falls after Method, so joins its level
    expect(shape(d)).toEqual(['Intro', 'Setup', '  Method', '  Detail', 'Results']);
  });

  it('indents and outdents an entry with everything nested under it', () => {
    const d = doc([e('A', 'p1', 0), e('B', 'p1', 0), e('C', 'p2', 1), e('D', 'p3', 0)]);
    const indented = applyOp(d, shiftOutlineEntry(d, 'B', 1)!);
    expect(shape(indented)).toEqual(['A', '  B', '    C', 'D']);
    expect(shape(applyOp(indented, shiftOutlineEntry(indented, 'B', -1)!))).toEqual(['A', 'B', '  C', 'D']);
    // The first entry can't go deeper than the top level.
    expect(shiftOutlineEntry(d, 'A', 1)).toBeNull();
  });

  it('removes an entry, moving its children up rather than losing them', () => {
    const d = doc([e('A', 'p1', 0), e('B', 'p1', 1), e('C', 'p2', 2), e('D', 'p3', 0)]);
    expect(shape(applyOp(d, removeOutlineEntry(d, 'B')!))).toEqual(['A', '  C', 'D']);
    // Removing the last entry leaves no outline at all.
    const one = doc([e('A', 'p1', 0)]);
    expect('outline' in applyOp(one, removeOutlineEntry(one, 'A')!)).toBe(false);
  });

  it('renames, ignoring blank titles', () => {
    const d = doc([e('A', 'p1', 0)]);
    expect(applyOp(d, renameOutlineEntry(d, 'A', '  Chapter 1 ')!).outline![0].title).toBe('Chapter 1');
    expect(renameOutlineEntry(d, 'A', '   ')).toBeNull();
  });

  it('makes every change one undoable step', () => {
    const d = doc([e('A', 'p1', 0), e('B', 'p2', 0)]);
    for (const op of [shiftOutlineEntry(d, 'B', 1)!, removeOutlineEntry(d, 'A')!, renameOutlineEntry(d, 'B', 'x')!, addOutlineEntry(d, { pageId: 'p3' }, 'C')!.op]) {
      expect(applyOp(applyOp(d, op), inverseOp(op))).toEqual(d);
    }
  });

  it('keeps levels consistent', () => {
    expect(normaliseLevels([e('A', 'p1', 2), e('B', 'p1', 4), e('C', 'p1', 1)]).map((x) => x.level)).toEqual([0, 1, 1]);
  });

  it('shows entries for existing pages, hiding those under a collapsed entry', () => {
    const d = { ...doc([e('A', 'p1', 0), e('B', 'p2', 1), e('C', 'gone', 1), e('D', 'p3', 0)]) };
    expect(visibleOutline(d, new Set()).map((r) => r.entry.id)).toEqual(['A', 'B', 'D']);
    expect(visibleOutline(d, new Set(['A'])).map((r) => r.entry.id)).toEqual(['A', 'D']);
    expect(visibleOutline(d, new Set()).map((r) => r.pageIndex)).toEqual([0, 1, 2]);
  });

  it('survives export and import, dropping malformed entries', () => {
    const meta: NotebookMeta = { id: 'd', title: 'T', cover: '#000', template: 'blank', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 3 };
    const outline = [e('A', 'p1', 0), e('B', 'p2', 1, 120)];
    const file = JSON.parse(JSON.stringify(toFile(meta, doc(outline))));
    expect(fromFile(file).doc.outline).toEqual(outline);
    file.doc.outline.push({ id: 'bad', title: 3, pageId: 'p1', level: 0 });
    expect(fromFile(file).doc.outline).toEqual(outline);
  });
});
