// Browser side of cut/copy/paste: writing a clip to the system clipboard and reading one back.
import { clipFromData, clipHtml, clipText, encodeClip, CLIPBOARD_MIME, type Clip } from '../core/clipboard';
import type { ElementContent } from '../core/elements';
import { pastedUrl } from '../core/links';
import { renderContentThumbnail } from '../render/page';
import type { ImageResolver } from '../render/items';
import { isImageFile } from '../io/images';

/** The last clip copied in this tab, for pasting when the system clipboard can't be read. */
let lastClip: Clip | null = null;
export const lastCopiedClip = () => lastClip;

/** The clip as a PNG data URL on paper, at 2× and at most 2048 px on its long side. */
function clipPng(content: ElementContent, images: ImageResolver): string | null {
  try {
    // Same padding as the thumbnail renderer, so asking for its padded size keeps proportions.
    const pad = Math.max(content.w, content.h) * 0.08 + 4;
    const w = content.w + pad * 2;
    const h = content.h + pad * 2;
    const k = Math.min(1, 1024 / Math.max(w, h));
    return renderContentThumbnail(content, images, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  } catch {
    return null;
  }
}

interface Formats {
  json: string;
  html: string;
  text: string;
  png: string | null;
}

function formats(clip: Clip, images: ImageResolver): Formats {
  const json = encodeClip(clip);
  const png = clipPng(clip.content, images);
  const text = clipText(clip.content);
  return { json, png, text, html: clipHtml(json, png, text || 'Copied from J Notes') };
}

/** Fill a copy/cut event's clipboard data (synchronous, so it works in every browser). */
export function writeClipToEvent(e: ClipboardEvent, clip: Clip, images: ImageResolver): boolean {
  if (!e.clipboardData) return false;
  const f = formats(clip, images);
  e.preventDefault();
  e.clipboardData.setData(CLIPBOARD_MIME, f.json);
  e.clipboardData.setData('text/html', f.html);
  e.clipboardData.setData('text/plain', f.text);
  lastClip = clip;
  return true;
}

/** Write through the async Clipboard API, which can also hold a real PNG for other apps. */
export async function writeClip(clip: Clip, images: ImageResolver): Promise<boolean> {
  lastClip = clip;
  const f = formats(clip, images);
  try {
    const data: Record<string, Blob> = { 'text/html': new Blob([f.html], { type: 'text/html' }) };
    if (f.text) data['text/plain'] = new Blob([f.text], { type: 'text/plain' });
    if (f.png) data['image/png'] = await (await fetch(f.png)).blob();
    await navigator.clipboard.write([new ClipboardItem(data)]);
    return true;
  } catch {
    // No async clipboard (or permission refused): a copy command still fires a copy event we can fill.
    const onCopy = (e: ClipboardEvent) => writeClipToEvent(e, clip, images);
    document.addEventListener('copy', onCopy, { once: true });
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.removeEventListener('copy', onCopy);
    }
  }
}

export type Pasted = { kind: 'clip'; clip: Clip } | { kind: 'images'; files: File[] } | { kind: 'url'; url: string };

/** What a paste event carries that the notebook can take. */
export function pastedFromEvent(e: ClipboardEvent): Pasted | null {
  const d = e.clipboardData;
  if (!d) return null;
  const clip = clipFromData((t) => d.getData(t));
  if (clip) return { kind: 'clip', clip };
  const files = [...d.files].filter(isImageFile);
  if (files.length) return { kind: 'images', files };
  const url = pastedUrl(d.getData('text/plain'));
  return url ? { kind: 'url', url } : null;
}

/** Read the system clipboard for a Paste button; falls back to the last clip copied here. */
export async function readPasted(): Promise<Pasted | null> {
  try {
    // `unsanitized` keeps the payload attribute in Chrome's HTML; other browsers ignore it.
    const read = navigator.clipboard.read as (opts?: { unsanitized?: string[] }) => Promise<ClipboardItems>;
    const items = await read.call(navigator.clipboard, { unsanitized: ['text/html'] });
    for (const item of items) {
      const text = async (t: string) => (item.types.includes(t) ? (await item.getType(t)).text() : '');
      const html = await text('text/html');
      const clip = clipFromData((t) => (t === 'text/html' ? html : ''));
      if (clip) return { kind: 'clip', clip };
      const image = item.types.find((t) => t.startsWith('image/'));
      if (image) return { kind: 'images', files: [new File([await item.getType(image)], 'pasted', { type: image })] };
      const url = pastedUrl(await text('text/plain'));
      if (url) return { kind: 'url', url };
    }
    return null;
  } catch {
    return lastClip ? { kind: 'clip', clip: lastClip } : null;
  }
}
