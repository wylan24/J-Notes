import type { NotebookDoc, NotebookMeta, Template } from '../core/model';
import { newId } from '../core/ids';

/** Portable single-file notebook format (.jnotes.json). */
export interface NotebookFile {
  format: 'jnotes-notebook';
  version: 1;
  title: string;
  cover: string;
  template: Template;
  doc: NotebookDoc;
}

export function toFile(meta: NotebookMeta, doc: NotebookDoc): NotebookFile {
  return { format: 'jnotes-notebook', version: 1, title: meta.title, cover: meta.cover, template: meta.template, doc };
}

export function fromFile(raw: unknown): { meta: NotebookMeta; doc: NotebookDoc } {
  const f = raw as NotebookFile;
  if (!f || f.format !== 'jnotes-notebook' || f.version !== 1 || !Array.isArray(f.doc?.pages)) {
    throw new Error('Not a J Notes notebook file');
  }
  const id = newId(); // imported copies never collide with existing notebooks
  const now = Date.now();
  return {
    doc: { id, pages: f.doc.pages },
    meta: {
      id,
      title: String(f.title || 'Imported notebook'),
      cover: f.cover || '#3d5a80',
      template: f.template || 'blank',
      createdAt: now,
      updatedAt: now,
      favourite: false,
      trashedAt: null,
      pageCount: f.doc.pages.length,
    },
  };
}
