import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, clipFromData, clipHtml, clipText, CLIPBOARD_MIME, decodeClip, encodeClip, jsonFromHtml, type Clip } from '../src/core/clipboard';
import { makeElementContent, placeElement } from '../src/core/elements';
import type { Page, PageItem } from '../src/core/model';

const page: Page = {
  id: 'p',
  template: 'blank',
  strokes: [{ id: 's', tool: 'pen', color: '#000', width: 2, simulatePressure: false, points: [{ x: 100, y: 100, p: 0.5, t: 3 }, { x: 140, y: 120, p: 0.5, t: 9 }], rec: 'r1' }],
  items: [
    { id: 'i', kind: 'image', x: 150, y: 90, w: 40, h: 30, blobId: 'blob1' } as PageItem,
    { id: 't', kind: 'text', x: 100, y: 130, w: 80, h: 20, text: 'Café ✓ notes', font: 'sans', size: 12, color: '#000' },
    { id: 'l', kind: 'link', x: 100, y: 60, w: 50, h: 20, target: { kind: 'url', url: 'https://example.com' }, label: 'example.com' } as PageItem,
  ],
};
const sel = { pageId: 'p', strokeIds: ['s'], itemIds: ['i', 't', 'l'] };
const bytes = new Uint8Array([0, 1, 2, 250, 255]).buffer;
const clip: Clip = { content: makeElementContent(page, sel)!, blobs: [{ id: 'blob1', type: 'image/png', bytes }] };

describe('clipboard payload', () => {
  it('round-trips content and photo bytes', () => {
    const back = decodeClip(encodeClip(clip))!;
    expect(back.content).toEqual(clip.content);
    expect(back.blobs).toHaveLength(1);
    expect(new Uint8Array(back.blobs[0].bytes)).toEqual(new Uint8Array(bytes));
  });

  it('base64 survives large binary data', () => {
    const big = new Uint8Array(100_000).map((_, i) => i * 7);
    expect(new Uint8Array(base64ToBytes(bytesToBase64(big.buffer)))).toEqual(big);
  });

  it('rejects anything that is not ours or is malformed', () => {
    expect(decodeClip('not json')).toBeNull();
    expect(decodeClip(JSON.stringify({ hello: 1 }))).toBeNull();
    const good = JSON.parse(encodeClip(clip));
    expect(decodeClip(JSON.stringify({ ...good, v: 2 }))).toBeNull();
    expect(decodeClip(JSON.stringify({ ...good, content: { ...good.content, items: [{ id: 'x', kind: 'bomb', x: 0, y: 0, w: 1, h: 1 }] } }))).toBeNull();
    expect(decodeClip(JSON.stringify({ ...good, content: { ...good.content, strokes: [{ id: 'x', points: [{ x: 'a', y: 0 }] }] } }))).toBeNull();
    expect(decodeClip(JSON.stringify({ ...good, content: { strokes: [], items: [], w: 0, h: 0 } }))).toBeNull();
  });

  it('carries the payload inside HTML, with non-Latin text intact', () => {
    const json = encodeClip(clip);
    const html = clipHtml(json, 'data:image/png;base64,AAAA', 'a "quoted" <alt>');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('alt="a &quot;quoted&quot; &lt;alt>"');
    expect(jsonFromHtml(`<meta charset="utf-8">${html}`)).toBe(json);
    expect(jsonFromHtml('<p>hello</p>')).toBeNull();
  });

  it('reads the custom type first, then the HTML copy', () => {
    const json = encodeClip(clip);
    const fromCustom = clipFromData((t) => (t === CLIPBOARD_MIME ? json : ''));
    const fromHtml = clipFromData((t) => (t === 'text/html' ? clipHtml(json, null, '') : ''));
    expect(fromCustom?.content).toEqual(clip.content);
    expect(fromHtml?.content).toEqual(clip.content);
    expect(clipFromData(() => '')).toBeNull();
  });

  it('gives other apps the text and web addresses, top to bottom', () => {
    expect(clipText(clip.content)).toBe('https://example.com\n\nCafé ✓ notes');
  });

  it('pasting into another notebook gives fresh ids and keeps the photo reference, without audio links', () => {
    const back = decodeClip(encodeClip(clip))!;
    const placed = placeElement(back.content, 'other', { x: 300, y: 300 });
    const added: { id: string }[] = placed.ops.flatMap((op): { id: string }[] => (op.type === 'strokes.added' ? op.strokes : op.type === 'items.added' ? op.items : []));
    expect(added.map((x) => x.id)).not.toContain('s');
    expect(added.some((x) => 'blobId' in x && x.blobId === 'blob1')).toBe(true);
    const stroke = placed.ops.find((op) => op.type === 'strokes.added');
    expect(stroke && stroke.type === 'strokes.added' && stroke.strokes[0].rec).toBeUndefined();
  });
});
