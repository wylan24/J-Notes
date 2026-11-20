import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRIVE_SCOPE } from '../src/core/account';

const signOut = vi.fn();
vi.mock('../src/auth/google', () => ({
  currentAccount: () => ({ id: '1', email: 'a@b.c', name: 'A' }),
  accessToken: () => ({ token: 't', expiresAt: Date.now() + 3_600_000, scopes: [DRIVE_SCOPE] }),
  onAccountChange: () => () => {},
  signOut,
}));
const removeSyncedCopies = vi.fn(async () => ({ removed: 0, kept: 0 }));
vi.mock('../src/sync/local', () => ({ localNotebooks: {}, localLibrary: {}, removeSyncedCopies }));

describe('signing out', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    signOut.mockClear();
    removeSyncedCopies.mockClear();
  });

  it('refuses to remove anything when it cannot sync first, and stays signed in', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const { signOutOfSync } = await import('../src/sync');
    const r = await signOutOfSync(true);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("you're offline") });
    expect(removeSyncedCopies).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('keeping notebooks signs out without syncing or removing', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const { signOutOfSync } = await import('../src/sync');
    expect(await signOutOfSync(false)).toEqual({ ok: true, removed: 0, kept: 0 });
    expect(removeSyncedCopies).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledOnce();
  });
});
