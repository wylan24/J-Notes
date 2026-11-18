// Converting formatted text between the stored blocks and the editor's document (ProseMirror JSON,
// as TipTap reads and writes it). Stored text is a flat list of paragraphs; the editor nests lists.
import type { RichBlock, RichRun } from './model';
import { HIGHLIGHT, normalizeBlocks } from './richText';

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const LISTS: Record<string, RichBlock['list']> = { bulletList: 'bullet', orderedList: 'ordered' };

function runsOf(p: DocNode): RichRun[] {
  const out: RichRun[] = [];
  for (const c of p.content ?? []) {
    if (c.type === 'hardBreak') out.push({ text: '\n' });
    else if (c.type === 'text' && c.text) {
      const marks = c.marks ?? [];
      const hl = marks.find((m) => m.type === 'highlight');
      out.push({
        text: c.text,
        ...(marks.some((m) => m.type === 'bold') ? { b: true as const } : {}),
        ...(marks.some((m) => m.type === 'italic') ? { i: true as const } : {}),
        ...(hl ? { hl: typeof hl.attrs?.color === 'string' ? hl.attrs.color : HIGHLIGHT } : {}),
      });
    }
  }
  return out;
}

/** The editor's document as stored blocks. */
export function blocksFromDoc(doc: DocNode): RichBlock[] {
  const out: RichBlock[] = [];
  const list = (node: DocNode, depth: number) => {
    const kind = LISTS[node.type];
    for (const item of node.content ?? []) {
      (item.content ?? []).forEach((child, k) => {
        if (child.type === 'paragraph') {
          // A list item's first paragraph carries the marker; any more line up with its text.
          out.push(k === 0 ? { runs: runsOf(child), list: kind, indent: depth } : { runs: runsOf(child), indent: depth + 1 });
        } else if (LISTS[child.type]) list(child, depth + 1);
      });
    }
  };
  for (const node of doc.content ?? []) {
    if (node.type === 'paragraph') out.push({ runs: runsOf(node), indent: Number(node.attrs?.indent) || 0 });
    else if (LISTS[node.type]) list(node, 0);
  }
  return normalizeBlocks(out.length ? out : [{ runs: [] }]);
}

function paragraph(b: RichBlock, indent: boolean): DocNode {
  const content: DocNode[] = [];
  for (const r of b.runs) {
    const marks = [...(r.b ? [{ type: 'bold' }] : []), ...(r.i ? [{ type: 'italic' }] : []), ...(r.hl ? [{ type: 'highlight', attrs: { color: r.hl } }] : [])];
    r.text.split('\n').forEach((t, i) => {
      if (i) content.push({ type: 'hardBreak' });
      if (t) content.push({ type: 'text', text: t, ...(marks.length ? { marks } : {}) });
    });
  }
  return { type: 'paragraph', ...(indent && b.indent ? { attrs: { indent: b.indent } } : {}), ...(content.length ? { content } : {}) };
}

/** Stored blocks as the editor's document, with list items nested by their indent. */
export function docFromBlocks(blocks: readonly RichBlock[]): DocNode {
  const content: DocNode[] = [];
  // The open list at each depth, and the item that deeper lists nest in.
  let stack: { kind: RichBlock['list']; node: DocNode; item: DocNode | null }[] = [];
  for (const b of blocks) {
    if (!b.list) {
      stack = [];
      content.push(paragraph(b, true));
      continue;
    }
    const want = b.indent ?? 0;
    while (stack.length > want + 1) stack.pop();
    if (stack.length === want + 1 && stack[want].kind !== b.list) stack.pop();
    if (stack.length < want + 1) {
      // A list can only nest one level deeper than the one around it, and only inside an item.
      const node: DocNode = { type: b.list === 'bullet' ? 'bulletList' : 'orderedList', content: [] };
      const parent = stack[stack.length - 1];
      if (parent?.item) parent.item.content!.push(node);
      else {
        stack = [];
        content.push(node);
      }
      stack.push({ kind: b.list, node, item: null });
    }
    const top = stack[stack.length - 1];
    const item: DocNode = { type: 'listItem', content: [paragraph(b, false)] };
    top.node.content!.push(item);
    top.item = item;
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
