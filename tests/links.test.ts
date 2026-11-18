import { describe, expect, it } from 'vitest';
import { linkAt, linkLabel, MAX_BACK, newLink, normaliseUrl, pastedUrl, pushBack } from '../src/core/links';
import type { NotebookDoc, NotebookMeta, Page } from '../src/core/model';
import { applyOp, inverseOp, updateItemOp } from '../src/core/ops';
import { fromFile, toFile } from '../src/io/notebookFile';

describe('web addresses', () => {
  it('accepts http(s) and mailto, adding https:// to bare domains', () => {
    expect(normaliseUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(normaliseUrl('  example.com/notes ')).toBe('https://example.com/notes');
    expect(normaliseUrl('www.bbc.co.uk')).toBe('https://www.bbc.co.uk/');
    expect(normaliseUrl('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(normaliseUrl('http://localhost:5173/x')).toBe('http://localhost:5173/x');
  });

  it('refuses unsafe schemes and things that are not addresses', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>', 'file:///etc/passwd', 'notes', 'two words.com', '', 'mailto:nobody', 'https://nodot']) {
      expect(normaliseUrl(bad), bad).toBeNull();
    }
  });

  it('turns only a lone pasted http(s) address into a link', () => {
    expect(pastedUrl(' https://example.com/x \n')).toBe('https://example.com/x');
    expect(pastedUrl('see https://example.com')).toBeNull();
    expect(pastedUrl('example.com')).toBeNull();
  });

  it('labels links without the scheme, shortened', () => {
    expect(linkLabel('https://example.com/')).toBe('example.com');
    expect(linkLabel('mailto:me@x.org')).toBe('me@x.org');
    expect(linkLabel(`https://example.com/${'a'.repeat(80)}`)).toHaveLength(48);
  });
});

describe('links on a page', () => {
  const link = newLink({ x: 100, y: 100, w: 50, h: 20 }, { kind: 'page', pageId: 'p2' });
  const page: Page = { id: 'p1', template: 'blank', strokes: [], items: [link] };

  it('finds the link under a point, with a little slack', () => {
    expect(linkAt(page, { x: 120, y: 110 })).toBe(link);
    expect(linkAt(page, { x: 97, y: 110 })).toBe(link);
    expect(linkAt(page, { x: 90, y: 110 })).toBeNull();
  });

  it('retargets a link as one undoable step', () => {
    const doc: NotebookDoc = { id: 'd', pages: [page] };
    const op = updateItemOp(page, link.id, { target: { kind: 'url', url: 'https://example.com/' } })!;
    const after = applyOp(doc, op);
    expect(after.pages[0].items[0]).toMatchObject({ target: { kind: 'url', url: 'https://example.com/' } });
    expect(applyOp(after, inverseOp(op))).toEqual(doc);
  });

  it('survives export and import', () => {
    const meta: NotebookMeta = { id: 'd', title: 'T', cover: '#000', template: 'blank', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 1 };
    const doc: NotebookDoc = { id: 'd', pages: [page] };
    expect(fromFile(JSON.parse(JSON.stringify(toFile(meta, doc)))).doc.pages[0].items).toEqual([link]);
  });
});

describe('Back', () => {
  it('keeps the most recent places, newest last', () => {
    let stack: ReturnType<typeof pushBack> = [];
    for (let i = 0; i < MAX_BACK + 5; i++) stack = pushBack(stack, { scrollTop: i, scrollLeft: 0, pageIndex: i });
    expect(stack).toHaveLength(MAX_BACK);
    expect(stack[stack.length - 1].pageIndex).toBe(MAX_BACK + 4);
  });
});
