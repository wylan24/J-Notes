import { describe, expect, it } from 'vitest';
import { coverFit, isCoverDataUrl } from '../src/core/cover';
import type { NotebookMeta } from '../src/core/model';
import { fromFile, toFile } from '../src/io/notebookFile';

const meta: NotebookMeta = { id: 'n', title: 'Trip', cover: '#123', template: 'ruled', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 1 };
const doc = { id: 'n', pages: [{ id: 'p', template: 'ruled' as const, strokes: [], items: [] }] };
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

describe('custom covers', () => {
  it('scales big pictures down to cover size, keeping proportions, and never scales up', () => {
    expect(coverFit(4000, 3000)).toEqual({ w: 480, h: 360 });
    expect(coverFit(1000, 4000)).toEqual({ w: 170, h: 680 });
    expect(coverFit(200, 300)).toEqual({ w: 200, h: 300 });
  });

  it('accepts only image data URLs of a sensible size', () => {
    expect(isCoverDataUrl(jpeg)).toBe(true);
    expect(isCoverDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isCoverDataUrl('https://example.com/cover.jpg')).toBe(false);
    expect(isCoverDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isCoverDataUrl('data:text/html;base64,PGI+')).toBe(false);
    expect(isCoverDataUrl(`data:image/jpeg;base64,${'A'.repeat(2_000_000)}`)).toBe(false);
    expect(isCoverDataUrl(undefined)).toBe(false);
  });

  it('survives export and import', () => {
    const file = JSON.parse(JSON.stringify(toFile({ ...meta, coverImage: jpeg }, doc)));
    expect(file.coverImage).toBe(jpeg);
    expect(fromFile(file).meta.coverImage).toBe(jpeg);
  });

  it('leaves files without a cover picture unchanged, and drops an unsafe one', () => {
    expect('coverImage' in toFile(meta, doc)).toBe(false);
    expect('coverImage' in fromFile(JSON.parse(JSON.stringify(toFile(meta, doc)))).meta).toBe(false);
    const tampered = { ...JSON.parse(JSON.stringify(toFile(meta, doc))), coverImage: 'javascript:alert(1)' };
    expect('coverImage' in fromFile(tampered).meta).toBe(false);
  });
});
