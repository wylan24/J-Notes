// A text document as a Yjs document, for the editor (TipTap Collaboration) and for tests. Loaded
// only with the text document editor.
import { getSchema, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import type { NotebookDoc, TextDocNode } from '../core/model';
import { EMPTY_TEXT_DOC, forStorage } from '../core/textDoc';
import { fromBase64, TEXT_FIELD, toBase64 } from '../core/textSync';

/** Where each image's bytes can be shown from on this device (object URLs), set by the editor. */
let imageUrl: (blobId: string) => string | undefined = () => undefined;
export const setImageUrls = (fn: (blobId: string) => string | undefined): void => void (imageUrl = fn);

/**
 * An image that keeps the blob it came from. Its `src` is worked out on each device from the
 * blob, never stored: object URLs only mean something in the window that made them.
 */
const StoredImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        renderHTML: (attrs: { src?: string | null; blobId?: string | null }) => ({ src: (attrs.blobId && imageUrl(attrs.blobId)) || attrs.src || '' }),
      },
      blobId: { default: null, renderHTML: () => ({}), parseHTML: () => null },
    };
  },
});

/** The editor's extensions, less collaboration (which needs the Yjs document). */
export function textExtensions(): AnyExtension[] {
  return [
    // Undo comes from Collaboration, which undoes only this person's own typing.
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, link: { openOnClick: false, autolink: true }, undoRedo: false }),
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    StoredImage.configure({ inline: false }),
  ];
}

/**
 * The document as Yjs. One that has never been opened this way is converted from its JSON as
 * client 0, the same way on every device: two devices converting the same document make the same
 * Yjs items, which Yjs then keeps once, rather than two copies of the text. Returns the update to
 * log when it converted.
 */
export function openTextYDoc(doc: Pick<NotebookDoc, 'text' | 'textState'>, extensions = textExtensions()): { ydoc: Y.Doc; converted: string | null } {
  const ydoc = new Y.Doc();
  if (doc.textState) {
    Y.applyUpdate(ydoc, fromBase64(doc.textState));
    return { ydoc, converted: null };
  }
  const own = ydoc.clientID;
  ydoc.clientID = 0;
  prosemirrorJSONToYXmlFragment(getSchema(extensions), forStorage(doc.text ?? EMPTY_TEXT_DOC), ydoc.getXmlFragment(TEXT_FIELD));
  ydoc.clientID = own;
  return { ydoc, converted: toBase64(Y.encodeStateAsUpdate(ydoc)) };
}

export type { TextDocNode };
