import { describe, expect, it } from 'vitest';
import { checkPassword, createLock, LOCK_ITERATIONS, passwordProblem, subtleCrypto } from '../src/core/lock';
import type { NotebookMeta } from '../src/core/model';
import { toFile } from '../src/io/notebookFile';

const subtle = subtleCrypto()!;
const FAST = 1000; // real PBKDF2, fewer rounds so tests run quickly

describe('password locks', () => {
  it('uses the platform crypto, at OWASP strength by default', () => {
    expect(subtle).toBeTruthy();
    expect(LOCK_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('opens with the right password only', async () => {
    const lock = await createLock(subtle, 'correct horse', 'stable', FAST);
    expect(await checkPassword(subtle, lock, 'correct horse')).toBe(true);
    expect(await checkPassword(subtle, lock, 'Correct horse')).toBe(false);
    expect(await checkPassword(subtle, lock, '')).toBe(false);
    expect(lock.hint).toBe('stable');
  });

  it('stores a salted hash, never the password, with a fresh salt each time', async () => {
    const a = await createLock(subtle, 'secret', undefined, FAST);
    const b = await createLock(subtle, 'secret', undefined, FAST);
    expect(JSON.stringify(a)).not.toContain('secret');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(atob(a.hash)).toHaveLength(32);
    expect('hint' in a).toBe(false);
  });

  it('treats differently composed accents as the same password', async () => {
    const lock = await createLock(subtle, 'café', undefined, FAST); // é as one character
    expect(await checkPassword(subtle, lock, 'café')).toBe(true); // e + combining accent
  });

  it('rejects an unknown hash scheme', async () => {
    const lock = await createLock(subtle, 'pw12', undefined, FAST);
    expect(await checkPassword(subtle, { ...lock, kdf: 'MD5' as 'PBKDF2-SHA256' }, 'pw12')).toBe(false);
  });

  it('asks for a usable new password', () => {
    expect(passwordProblem('abc', 'abc')).toMatch(/at least 4/);
    expect(passwordProblem('abcd', 'abce')).toMatch(/match/);
    expect(passwordProblem('abcd', 'abcd')).toBeNull();
  });

  it('is not written into exported notebook files', async () => {
    const lock = await createLock(subtle, 'pw12', undefined, FAST);
    const meta: NotebookMeta = { id: 'n', title: 'Diary', cover: '#000', template: 'blank', createdAt: 1, updatedAt: 1, favourite: false, trashedAt: null, pageCount: 1, lock };
    expect(JSON.stringify(toFile(meta, { id: 'n', pages: [] }))).not.toContain(lock.hash);
  });
});
