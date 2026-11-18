import { describe, expect, it } from 'vitest';
import type { RichBlock, TextItem } from '../src/core/model';
import { blocksFromPlain, INDENT_EM, isPlain, layoutRich, listMarkers, plainText, richPatch } from '../src/core/richText';
import { blocksFromDoc, docFromBlocks } from '../src/core/richDoc';
import { textHeight, textLines, LINE_HEIGHT, TEXT_PAD } from '../src/core/items';

// Monospace-ish: 10 per character, bold 12.
const measure = (s: string, b?: boolean) => s.length * (b ? 12 : 10);

describe('rich text layout', () => {
  it('wraps unformatted text exactly as plain text does', () => {
    const text = 'the quick brown fox jumps over the lazy dog\nand then   rests averyveryverylongwordthatmustbreak';
    const item = { text, w: 160 + 2 * TEXT_PAD };
    const plain = textLines(item, measure);
    const rich = layoutRich(blocksFromPlain(text), 160, 16, measure).map((l) => l.pieces.map((p) => p.text).join(''));
    expect(rich).toEqual(plain);
  });

  it('measures bold words as bold and keeps styles in separate pieces', () => {
    const [line] = layoutRich([{ runs: [{ text: 'ab ' }, { text: 'cd', b: true }, { text: ' e', hl: '#ff0' }] }], 500, 16, measure);
    expect(line.pieces.map((p) => [p.text, p.x, p.w])).toEqual([
      ['ab ', 0, 30],
      ['cd', 30, 24],
      [' e', 54, 20],
    ]);
  });

  it('indents lists and paragraphs, with markers in the gutter', () => {
    const size = 10, step = size * INDENT_EM;
    const lines = layoutRich(
      [
        { runs: [{ text: 'one' }], list: 'bullet' },
        { runs: [{ text: 'two' }], list: 'bullet', indent: 1 },
        { runs: [{ text: 'para' }], indent: 2 },
      ],
      500,
      size,
      measure,
    );
    expect(lines[0].marker).toEqual({ text: '•', x: 0 });
    expect(lines[0].pieces[0].x).toBe(step);
    expect(lines[1].marker).toEqual({ text: '◦', x: step });
    expect(lines[1].pieces[0].x).toBe(2 * step);
    expect(lines[2].marker).toBeUndefined();
    expect(lines[2].pieces[0].x).toBe(2 * step);
  });

  it('numbers ordered lists, restarting after other paragraphs and counting nested lists apart', () => {
    const o = (indent = 0): RichBlock => ({ runs: [{ text: 'x' }], list: 'ordered', indent });
    expect(listMarkers([o(), o(), o(1), o(1), o(), { runs: [] }, o()])).toEqual(['1.', '2.', '1.', '2.', '3.', null, '1.']);
  });

  it('only the first line of a wrapped list item gets its marker; line breaks stay', () => {
    const lines = layoutRich([{ runs: [{ text: 'aaaa bbbb\ncc' }], list: 'bullet' }], 60, 10, measure);
    expect(lines.map((l) => [l.marker?.text ?? '', l.pieces.map((p) => p.text).join('')])).toEqual([
      ['•', 'aaaa'],
      ['', 'bbbb'],
      ['', 'cc'],
    ]);
  });

  it('text box height follows the formatted layout', () => {
    const base: TextItem = { id: 't', kind: 'text', x: 0, y: 0, w: 108, h: 0, text: 'a\nb', font: 'sans', size: 10, color: '#000' };
    const rich = { ...base, rich: [{ runs: [{ text: 'a' }], list: 'bullet' as const }, { runs: [{ text: 'b' }], list: 'bullet' as const }] };
    expect(textHeight(rich, measure)).toBe(2 * 10 * LINE_HEIGHT + 2 * TEXT_PAD);
  });
});

describe('storing edits', () => {
  it('keeps plain text plain, so old notes are unchanged', () => {
    expect(richPatch(blocksFromPlain('hello\nworld'))).toEqual({ text: 'hello\nworld', rich: undefined });
    expect(isPlain([{ runs: [{ text: 'x', i: true }] }])).toBe(false);
  });

  it('mirrors formatted text as plain text and tidies runs', () => {
    const p = richPatch([{ runs: [{ text: 'He', b: true }, { text: 'llo', b: true }, { text: '' }], list: 'bullet' }, { runs: [{ text: 'next' }] }]);
    expect(p.text).toBe('Hello\nnext');
    expect(p.rich).toEqual([{ runs: [{ text: 'Hello', b: true }], list: 'bullet' }, { runs: [{ text: 'next' }] }]);
    expect(plainText(p.rich!)).toBe(p.text);
  });
});

describe('editor documents', () => {
  const blocks: RichBlock[] = [
    { runs: [{ text: 'Title', b: true }] },
    { runs: [{ text: 'first' }], list: 'bullet' },
    { runs: [{ text: 'nested', i: true }], list: 'ordered', indent: 1 },
    { runs: [{ text: 'second ' }, { text: 'marked', hl: '#fde68a' }], list: 'bullet' },
    { runs: [{ text: 'after\nbreak' }], indent: 2 },
    { runs: [] },
  ];

  it('round-trips through the editor document', () => {
    expect(blocksFromDoc(docFromBlocks(blocks))).toEqual(blocks);
  });

  it('nests deeper list items inside the item before them', () => {
    const doc = docFromBlocks(blocks);
    const list = doc.content![1];
    expect(list.type).toBe('bulletList');
    expect(list.content![0].content![1].type).toBe('orderedList');
    expect(doc.content![2].attrs).toEqual({ indent: 2 });
    expect(doc.content![2].content!.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
  });

  it('a list item jumping two levels nests only one deeper', () => {
    const doc = docFromBlocks([
      { runs: [{ text: 'a' }], list: 'bullet' },
      { runs: [{ text: 'b' }], list: 'bullet', indent: 2 },
    ]);
    expect(blocksFromDoc(doc).map((b) => b.indent ?? 0)).toEqual([0, 1]);
  });

  it('reads highlight without a colour as the default highlight', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'highlight' }] }] }] };
    expect(blocksFromDoc(doc)).toEqual([{ runs: [{ text: 'x', hl: '#fde68a' }] }]);
  });
});
