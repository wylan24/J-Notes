import { textDocBlobIds } from '../core/textDoc';
import { DOC_KINDS, normalizeDoc, type CardSide, type DocKind, type NotebookDoc, type NotebookMeta, type OutlineEntry, type StudyCard, type StudyDay, type Template } from '../core/model';
import { cardBlobIds, deckSummary } from '../core/study';
import { normaliseLevels } from '../core/outline';
import { newId } from '../core/ids';
import { isCoverDataUrl } from '../core/cover';
import type { StoredBlob } from '../storage/db';

/**
 * Portable single-file notebook format (.jnotes.json).
 * Version 2 added page items and `blobs`: the bytes of images (and later audio)
 * that items refer to, embedded as base64 data URLs keyed by blob id.
 * Version 1 files (strokes only) still import.
 */
export interface NotebookFile {
  format: 'jnotes-notebook';
  version: 1 | 2;
  title: string;
  cover: string;
  /** Custom cover picture (data URL); absent when the notebook has none. */
  coverImage?: string;
  /** A whiteboard or text document; absent for a notebook. */
  kind?: DocKind;
  template: Template;
  doc: NotebookDoc;
  blobs?: Record<string, string>;
}

/** Blob ids referred to by items anywhere in the notebook. */
export function referencedBlobIds(doc: NotebookDoc): string[] {
  const ids = new Set<string>();
  for (const page of doc.pages) {
    for (const it of page.items ?? []) if (it.kind === 'image') ids.add(it.blobId);
    if (page.background) ids.add(page.background.blobId);
  }
  for (const r of doc.recordings ?? []) ids.add(r.blobId);
  for (const id of textDocBlobIds(doc.text)) ids.add(id);
  for (const card of doc.cards ?? []) for (const id of cardBlobIds(card)) ids.add(id);
  return [...ids];
}

/** Build the file. Only blobs the document still refers to are embedded. */
export function toFile(meta: NotebookMeta, doc: NotebookDoc, blobs: Pick<StoredBlob, 'id' | 'type' | 'bytes'>[] = []): NotebookFile {
  const used = new Set(referencedBlobIds(doc));
  const embedded: Record<string, string> = {};
  for (const b of blobs) if (used.has(b.id)) embedded[b.id] = bytesToDataUrl(b.type, b.bytes);
  return {
    format: 'jnotes-notebook',
    version: 2,
    title: meta.title,
    cover: meta.cover,
    ...(meta.coverImage ? { coverImage: meta.coverImage } : {}),
    template: meta.template,
    ...(meta.kind && meta.kind !== 'notebook' ? { kind: meta.kind } : {}),
    doc,
    blobs: embedded,
  };
}

export function fromFile(raw: unknown): { meta: NotebookMeta; doc: NotebookDoc; blobs: StoredBlob[] } {
  const f = raw as NotebookFile;
  if (!f || f.format !== 'jnotes-notebook' || (f.version !== 1 && f.version !== 2) || !Array.isArray(f.doc?.pages)) {
    throw new Error('Not a J Notes notebook file');
  }
  const id = newId(); // imported copies never collide with existing notebooks
  const now = Date.now();
  const blobs: StoredBlob[] = [];
  if (f.blobs && typeof f.blobs === 'object') {
    for (const [blobId, url] of Object.entries(f.blobs)) {
      const parsed = typeof url === 'string' ? dataUrlToBytes(url) : null;
      if (!parsed) throw new Error(`Embedded file ${blobId} is not a base64 data URL`);
      blobs.push({ docId: id, id: blobId, ...parsed });
    }
  }
  return {
    doc: normalizeDoc({
      id,
      pages: f.doc.pages,
      ...(Array.isArray(f.doc.recordings) ? { recordings: f.doc.recordings } : {}),
      ...(Array.isArray(f.doc.bookmarks) && f.doc.bookmarks.length ? { bookmarks: f.doc.bookmarks.filter((b) => typeof b === 'string') } : {}),
      ...outlineFrom(f.doc.outline),
      ...(f.doc.text && typeof f.doc.text === 'object' && f.doc.text.type === 'doc' ? { text: f.doc.text } : {}),
      // The text as Yjs, when it has been edited since collaboration arrived (base64 only).
      ...(typeof f.doc.textState === 'string' && /^[A-Za-z0-9+/]+=*$/.test(f.doc.textState) ? { textState: f.doc.textState } : {}),
      ...cardsFrom(f.doc.cards, f.doc.studyLog),
    }),
    blobs,
    meta: {
      id,
      ...(f.kind && f.kind !== 'notebook' && DOC_KINDS.includes(f.kind) ? { kind: f.kind } : {}),
      ...(f.kind === 'deck' ? { deck: deckSummary(Array.isArray(f.doc.cards) ? cardsFrom(f.doc.cards).cards ?? [] : []) } : {}),
      title: String(f.title || 'Imported notebook'),
      cover: f.cover || '#3d5a80',
      // Only a picture we could have made; anything else is dropped rather than shown.
      ...(isCoverDataUrl(f.coverImage) ? { coverImage: f.coverImage } : {}),
      template: f.template || 'blank',
      createdAt: now,
      updatedAt: now,
      favourite: false,
      trashedAt: null,
      pageCount: f.doc.pages.length,
    },
  };
}

export function bytesToDataUrl(type: string, bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = '';
  // Chunked so String.fromCharCode never gets more arguments than the engine allows.
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return `data:${type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export function dataUrlToBytes(url: string): { type: string; bytes: ArrayBuffer } | null {
  const m = /^data:([^;,]*)(?:;[^;,=]+=[^;,]*)*;base64,([A-Za-z0-9+/=\s]*)$/.exec(url);
  if (!m) return null;
  let bin: string;
  try {
    bin = atob(m[2].replace(/\s+/g, ''));
  } catch {
    return null;
  }
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return { type: m[1] || 'application/octet-stream', bytes: u8.buffer };
}

const isSide = (s: unknown): s is CardSide => !!s && typeof (s as CardSide).text === 'string';

/** A file's flashcards and study history, keeping only well-formed ones. */
function cardsFrom(raw: unknown, rawLog?: unknown): { cards?: StudyCard[]; studyLog?: StudyDay[] } {
  if (!Array.isArray(raw)) return {};
  const cards = raw.filter((c): c is StudyCard => !!c && typeof c.id === 'string' && isSide(c.front) && isSide(c.back) && typeof c.createdAt === 'number');
  const log = Array.isArray(rawLog) ? rawLog.filter((d): d is StudyDay => !!d && typeof d.day === 'string' && typeof d.reviewed === 'number' && typeof d.correct === 'number') : [];
  return { cards, ...(log.length ? { studyLog: log } : {}) };
}

/** A file's outline, keeping only well-formed entries. */
function outlineFrom(raw: unknown): { outline?: OutlineEntry[] } {
  if (!Array.isArray(raw)) return {};
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const entries = raw.filter(
    (e): e is OutlineEntry =>
      !!e &&
      typeof e.id === 'string' &&
      typeof e.title === 'string' &&
      typeof e.pageId === 'string' &&
      num(e.level) &&
      (e.rect === undefined || (num(e.rect?.x) && num(e.rect?.y) && num(e.rect?.w) && num(e.rect?.h))),
  );
  return entries.length ? { outline: normaliseLevels(entries) } : {};
}
