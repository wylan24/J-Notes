import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { openTextYDoc } from '../src/text/yText';
import { fromBase64, mergeTextState, TEXT_FIELD, toBase64 } from '../src/core/textSync';
import { textDocLines, textDocPlain } from '../src/core/textDoc';
import { applyOp } from '../src/core/ops';
import type { NotebookDoc, TextDocNode } from '../src/core/model';
import { Device, FakeDrive } from './syncFakes';
import { fromFile, toFile } from '../src/io/notebookFile';

const para = (text: string): TextDocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const old: TextDocNode = {
  type: 'doc',
  content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Notes' }] }, para('The quick fox.'), { type: 'bulletList', content: [{ type: 'listItem', content: [para('one')] }] }],
};
const textOf = (state: string) => {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, fromBase64(state));
  return textDocPlain(yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(TEXT_FIELD)) as TextDocNode);
};

/** The Yjs text of the document's nth top-level block (what the editor binding types into). */
const blockText = (ydoc: Y.Doc, n: number) => (ydoc.getXmlFragment(TEXT_FIELD).get(n) as Y.XmlElement).get(0) as Y.XmlText;

/** Open the document on a device and type into it, logging the update as the editor does. */
function type(device: Device, docId: string, fn: (ydoc: Y.Doc) => void) {
  const doc = device.doc(docId);
  const { ydoc, converted } = openTextYDoc(doc);
  if (converted) device.edit(docId, { type: 'text.yjs', update: converted });
  const updates: Uint8Array[] = [];
  ydoc.on('update', (u: Uint8Array) => updates.push(u));
  fn(ydoc);
  device.edit(docId, { type: 'text.yjs', update: toBase64(Y.mergeUpdates(updates)) });
}

describe('text documents on Yjs', () => {
  it('an existing document opens with the same content', () => {
    const { ydoc, converted } = openTextYDoc({ text: old });
    expect(converted).toBeTruthy();
    const back = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(TEXT_FIELD)) as TextDocNode;
    expect(textDocLines(back)).toEqual(textDocLines(old));
    // Opened again from its state, nothing is converted twice.
    expect(openTextYDoc({ text: old, textState: converted! }).converted).toBeNull();
  });

  it('two devices converting the same document make the same thing, kept once', () => {
    const a = openTextYDoc({ text: old }).converted!;
    const b = openTextYDoc({ text: old }).converted!;
    expect(a).toBe(b);
    expect(textOf(mergeTextState(a, b))).toBe(textDocPlain(old));
  });

  it('a text.yjs edit merges into the state and keeps the copy for search', () => {
    const { converted } = openTextYDoc({ text: old });
    const doc: NotebookDoc = { id: 'd', pages: [], text: old };
    const next = applyOp(doc, { type: 'text.yjs', update: converted!, text: old });
    expect(next.textState).toBe(converted);
    expect(applyOp(next, { type: 'text.yjs', update: converted! }).textState && textOf(applyOp(next, { type: 'text.yjs', update: converted! }).textState!)).toBe(textDocPlain(old));
  });

  it('two devices typing offline in the same paragraph both keep their text after Drive sync', async () => {
    const drive = new FakeDrive();
    const a = new Device('deva', drive);
    const b = new Device('devb', drive);
    a.newNotebook('td', { pages: [], text: old });
    type(a, 'td', () => {}); // opened once: converted
    await a.sync();
    await b.sync();

    drive.online = false;
    type(a, 'td', (y) => blockText(y, 1).insert(4, 'brown '));
    type(b, 'td', (y) => blockText(y, 1).insert(14, ' It jumps.'));
    drive.online = true;
    await a.sync();
    await b.sync();
    await a.sync();

    expect(a.doc('td').textState).toBeTruthy();
    expect(textOf(a.doc('td').textState!)).toBe(textOf(b.doc('td').textState!));
    expect(textOf(a.doc('td').textState!).split('\n')[1]).toBe('The brown quick fox. It jumps.');
  });

  it('two devices each converting an old document offline, then typing, still end with one copy', async () => {
    const drive = new FakeDrive();
    const a = new Device('deva', drive);
    const b = new Device('devb', drive);
    a.newNotebook('td', { pages: [], text: old });
    await a.sync();
    await b.sync(); // b has the old document too, not yet converted anywhere
    type(a, 'td', (y) => blockText(y, 0).insert(5, ' (A)'));
    type(b, 'td', (y) => blockText(y, 0).insert(5, ' (B)'));
    await a.sync();
    await b.sync();
    await a.sync();
    const lines = textOf(a.doc('td').textState!).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Notes \((A|B)\) \((A|B)\)$/);
    expect(textOf(b.doc('td').textState!)).toBe(textOf(a.doc('td').textState!));
  });

  it('export and import keep the Yjs content', () => {
    const state = openTextYDoc({ text: old }).converted!;
    const meta = { id: 'td', kind: 'text' as const, title: 'T', cover: '#000', template: 'blank' as const, createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 0 };
    const back = fromFile(JSON.parse(JSON.stringify(toFile(meta, { id: 'td', pages: [], text: old, textState: state }))));
    expect(back.doc.textState).toBe(state);
    expect(fromFile(JSON.parse(JSON.stringify(toFile(meta, { id: 'td', pages: [], text: old, textState: 'not base64!' })))).doc.textState).toBeUndefined();
  });
});
