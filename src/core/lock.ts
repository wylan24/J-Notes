// Password locks for notebooks. A lock stores only a salted PBKDF2 hash of the password; checking
// a password re-derives it. This hides a notebook behind a lock screen in the app. It does not
// encrypt anything: the notebook's pages stay readable in the browser's storage.
import type { NotebookLock } from './model';

/** OWASP's 2023 recommendation for PBKDF2-HMAC-SHA256. */
export const LOCK_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 4;

type Subtle = Pick<SubtleCrypto, 'importKey' | 'deriveBits'>;

/** Web Crypto's subtle API, which browsers only provide on secure (https or localhost) pages. */
export function subtleCrypto(): Subtle | null {
  return globalThis.crypto?.subtle ?? null;
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(subtle: Subtle, password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** A new lock for `password`, with a fresh random salt. */
export async function createLock(subtle: Subtle, password: string, hint?: string, iterations = LOCK_ITERATIONS): Promise<NotebookLock> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(subtle, password, salt, iterations);
  const h = hint?.trim();
  return { kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), hash: toB64(hash), ...(h ? { hint: h } : {}) };
}

/** Whether `password` opens the lock. Compares every byte, so timing doesn't reveal how much matched. */
export async function checkPassword(subtle: Subtle, lock: NotebookLock, password: string): Promise<boolean> {
  if (lock.kdf !== 'PBKDF2-SHA256') return false;
  const want = fromB64(lock.hash);
  const got = await derive(subtle, password, fromB64(lock.salt), lock.iterations);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

/** Why a new password can't be used, or null if it can. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return "The passwords don't match.";
  return null;
}

// Notebooks unlocked in this visit to the editor. Going back to the library locks them again.
const unlocked = new Set<string>();
export const isUnlocked = (id: string) => unlocked.has(id);
export const markUnlocked = (id: string) => void unlocked.add(id);
export const relockAll = () => unlocked.clear();
