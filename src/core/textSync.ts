// Text documents' content as a Yjs document, so typing on several devices (or by several people)
// merges instead of one version replacing another. The state travels as base64 in `text.yjs`
// edits; Yjs updates merge in any order and applying one twice changes nothing, which is exactly
// what the edit log (core/sync, core/live) needs.
import * as Y from 'yjs';

/** The Yjs fragment holding the document (TipTap Collaboration's default). */
export const TEXT_FIELD = 'default';

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const fromBase64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The document's state with an update merged in (either may be empty). */
export function mergeTextState(state: string | undefined, update: string): string {
  if (!update) return state ?? '';
  if (!state) return update;
  return toBase64(Y.mergeUpdates([fromBase64(state), fromBase64(update)]));
}
