// Text documents: typed documents with headings, lists, checklists, tables and images, edited
// with TipTap. The content is stored as the editor's JSON; these helpers read it without the editor.
import type { TextDocNode } from './model';

export const EMPTY_TEXT_DOC: TextDocNode = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Visit every node, depth first. */
function walk(node: TextDocNode, fn: (n: TextDocNode) => void): void {
  fn(node);
  for (const c of node.content ?? []) walk(c, fn);
}

/** Map every node, depth first (children before their parent). */
function mapNodes(node: TextDocNode, fn: (n: TextDocNode) => TextDocNode): TextDocNode {
  const content = node.content?.map((c) => mapNodes(c, fn));
  return fn(content ? { ...node, content } : node);
}

/** Blob ids of the images in a document. */
export function textDocBlobIds(doc: TextDocNode | undefined): string[] {
  const ids = new Set<string>();
  if (doc) walk(doc, (n) => n.type === 'image' && typeof n.attrs?.blobId === 'string' && ids.add(n.attrs.blobId));
  return [...ids];
}

/**
 * The document as stored: images keep their `blobId` but not their `src`, which is an object URL
 * that only means something in the window that made it.
 */
export function forStorage(doc: TextDocNode): TextDocNode {
  return mapNodes(doc, (n) => {
    if (n.type !== 'image' || typeof n.attrs?.blobId !== 'string') return n;
    const { src: _src, ...attrs } = n.attrs;
    return { ...n, attrs };
  });
}

/** The document ready for the editor: each stored image gets a `src` to show it from. */
export function withImageSources(doc: TextDocNode, src: (blobId: string) => string | undefined): TextDocNode {
  return mapNodes(doc, (n) => {
    if (n.type !== 'image' || typeof n.attrs?.blobId !== 'string') return n;
    const url = src(n.attrs.blobId);
    return url ? { ...n, attrs: { ...n.attrs, src: url } } : n;
  });
}

export interface TextLine {
  text: string;
  /** 1–3 for headings, 0 for body text. */
  heading: number;
}

const BLOCKS = new Set(['paragraph', 'heading', 'tableCell', 'tableHeader']);

/** The document's text as lines (one per paragraph, heading or table cell), for previews and search. */
export function textDocLines(doc: TextDocNode | undefined, max = Infinity): TextLine[] {
  const out: TextLine[] = [];
  const visit = (n: TextDocNode, prefix: string) => {
    if (out.length >= max) return;
    if (BLOCKS.has(n.type) && !n.content?.some((c) => BLOCKS.has(c.type) || c.type === 'paragraph')) {
      let text = '';
      walk(n, (c) => {
        if (c.type === 'text') text += c.text ?? '';
        else if (c.type === 'hardBreak') text += ' ';
      });
      out.push({ text: prefix + text, heading: n.type === 'heading' ? Number(n.attrs?.level) || 1 : 0 });
      return;
    }
    const mark = n.type === 'taskItem' ? (n.attrs?.checked ? '☑ ' : '☐ ') : n.type === 'listItem' ? '• ' : '';
    (n.content ?? []).forEach((c, i) => visit(c, i === 0 ? prefix + mark : prefix.replace(/./g, ' ')));
  };
  if (doc) visit(doc, '');
  return out;
}

/** The document's text, one line per block. */
export const textDocPlain = (doc: TextDocNode | undefined): string =>
  textDocLines(doc)
    .map((l) => l.text)
    .join('\n');
