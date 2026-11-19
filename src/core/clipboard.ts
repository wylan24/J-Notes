// Cut, copy and paste of a selection through the system clipboard, across pages and notebooks.
// The selection travels as JSON (strokes, items and the photo bytes they use, since photos are
// stored per notebook) under a custom MIME type, and inside the HTML copy as an attribute for
// browsers that drop custom types. Other apps get a PNG and any text.
import type { ElementContent } from './elements';
import type { PageItem } from './model';

export const CLIPBOARD_MIME = 'application/x-jnotes+json';
/** The HTML attribute that carries the payload (base64 of the JSON). */
export const CLIPBOARD_ATTR = 'data-jnotes-clip';

export interface ClipBlob {
  id: string;
  type: string;
  bytes: ArrayBuffer;
}

export interface Clip {
  content: ElementContent;
  blobs: ClipBlob[];
}

interface Payload {
  app: 'jnotes';
  v: 1;
  content: ElementContent;
  blobs: { id: string; type: string; data: string }[];
}

export function bytesToBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

/** Base64 of a string's UTF-8 bytes (`btoa` alone only takes Latin-1). */
const utf8ToBase64 = (s: string) => bytesToBase64(new TextEncoder().encode(s).buffer as ArrayBuffer);
const base64ToUtf8 = (b64: string) => new TextDecoder().decode(base64ToBytes(b64));

export function encodeClip(clip: Clip): string {
  const payload: Payload = {
    app: 'jnotes',
    v: 1,
    content: clip.content,
    blobs: clip.blobs.map((b) => ({ id: b.id, type: b.type, data: bytesToBase64(b.bytes) })),
  };
  return JSON.stringify(payload);
}

const ITEM_KINDS: ReadonlySet<PageItem['kind']> = new Set(['text', 'image', 'sticky', 'link', 'tape', 'shape', 'line']);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

function validStroke(s: unknown): boolean {
  return isObj(s) && typeof s.id === 'string' && Array.isArray(s.points) && s.points.length > 0 && s.points.every((p) => isObj(p) && isNum(p.x) && isNum(p.y));
}

function validItem(it: unknown): boolean {
  if (!isObj(it) || typeof it.id !== 'string' || !ITEM_KINDS.has(it.kind as PageItem['kind'])) return false;
  if (![it.x, it.y, it.w, it.h].every(isNum)) return false;
  return it.kind !== 'image' || typeof it.blobId === 'string';
}

/** The clip in a clipboard JSON string, or null if it isn't one of ours or is malformed. */
export function decodeClip(json: string): Clip | null {
  let p: unknown;
  try {
    p = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(p) || p.app !== 'jnotes' || p.v !== 1 || !isObj(p.content) || !Array.isArray(p.blobs)) return null;
  const c = p.content;
  if (!Array.isArray(c.strokes) || !Array.isArray(c.items) || !isNum(c.w) || !isNum(c.h)) return null;
  if (!c.strokes.every(validStroke) || !c.items.every(validItem)) return null;
  if (!c.strokes.length && !c.items.length) return null;
  const blobs: ClipBlob[] = [];
  for (const b of p.blobs) {
    if (!isObj(b) || typeof b.id !== 'string' || typeof b.type !== 'string' || typeof b.data !== 'string') return null;
    try {
      blobs.push({ id: b.id, type: b.type, bytes: base64ToBytes(b.data) });
    } catch {
      return null;
    }
  }
  return { content: c as unknown as ElementContent, blobs };
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** HTML for the clipboard: the PNG for other apps, carrying the payload for this one. */
export function clipHtml(json: string, pngDataUrl: string | null, alt: string): string {
  const src = pngDataUrl ? ` src="${escapeAttr(pngDataUrl)}"` : '';
  return `<img${src} alt="${escapeAttr(alt)}" ${CLIPBOARD_ATTR}="${utf8ToBase64(json)}">`;
}

/** The payload JSON inside clipboard HTML, if there is one. */
export function jsonFromHtml(html: string): string | null {
  const m = new RegExp(`${CLIPBOARD_ATTR}="([A-Za-z0-9+/=]+)"`).exec(html);
  if (!m) return null;
  try {
    return base64ToUtf8(m[1]);
  } catch {
    return null;
  }
}

/** Plain text for other apps: the text of text boxes and sticky notes, and link addresses, top to bottom. */
export function clipText(content: ElementContent): string {
  return [...content.items]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((it) => (it.kind === 'text' || it.kind === 'sticky' ? it.text.trim() : it.kind === 'link' && it.target.kind === 'url' ? it.target.url : ''))
    .filter(Boolean)
    .join('\n\n');
}

/** A clip from clipboard data: the custom type first, then the HTML copy. */
export function clipFromData(getData: (type: string) => string): Clip | null {
  const custom = getData(CLIPBOARD_MIME);
  if (custom) {
    const clip = decodeClip(custom);
    if (clip) return clip;
  }
  const json = jsonFromHtml(getData('text/html'));
  return json ? decodeClip(json) : null;
}
