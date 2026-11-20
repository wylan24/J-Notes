// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRIVE_SCOPE } from '../src/core/account';

const CLIENT = '123-abc.apps.googleusercontent.com';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Storage that lasts across "reloads" within a test (Node 25+ has its own empty localStorage). */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

/** A fresh copy of the module, as after a page load. */
async function load() {
  vi.resetModules();
  return import('../src/auth/google');
}

/** Pretend to be Google: read the sign-in request and send the person back with tokens. */
function googleRedirectFor(authUrl: string): string {
  const q = new URL(authUrl).searchParams;
  const idToken = `${b64url({ alg: 'RS256' })}.${b64url({
    iss: 'https://accounts.google.com',
    aud: q.get('client_id'),
    sub: '42',
    email: 'ada@example.com',
    name: 'Ada',
    nonce: q.get('nonce'),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.sig`;
  return `#${new URLSearchParams({ state: q.get('state')!, access_token: 'ya29.tok', expires_in: '3599', scope: `openid email profile ${DRIVE_SCOPE}`, id_token: idToken })}`;
}

describe('signing in and out', () => {
  let assigned: string | null;

  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    history.replaceState(null, '', '/#/n/abc123');
    assigned = null;
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, hash: window.location.hash, assign: (u: string) => (assigned = u) } as Location);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response())));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Start sign-in, then come back from Google into a freshly loaded app. */
  async function signInRoundTrip() {
    const first = await load();
    first.signIn();
    expect(assigned).toMatch(/^https:\/\/accounts\.google\.com\//);
    vi.restoreAllMocks();
    history.replaceState(null, '', `/${googleRedirectFor(assigned!)}`);
    const back = await load();
    back.completeSignIn();
    return back;
  }

  it('signs in, takes the tokens out of the address, and goes back to the notebook', async () => {
    const g = await signInRoundTrip();
    expect(location.hash).toBe('#/n/abc123');
    expect(location.href).not.toContain('ya29');
    expect(g.accessToken()?.token).toBe('ya29.tok');
    // The useAccount hook's snapshot, read without React.
    expect(localStorage.getItem('jnotes.account')).toContain('ada@example.com');
    expect(localStorage.getItem('jnotes.account')).not.toContain('ya29');
  });

  it('is still signed in after a reload', async () => {
    await signInRoundTrip();
    const reloaded = await load();
    reloaded.completeSignIn(); // nothing to do: an ordinary route
    expect(JSON.parse(localStorage.getItem('jnotes.account')!).email).toBe('ada@example.com');
    expect(reloaded.accessToken()?.token).toBe('ya29.tok');
  });

  it('signing out forgets the account and token but leaves everything else', async () => {
    localStorage.setItem('jnotes.penOnly', 'true');
    const g = await signInRoundTrip();
    g.signOut();
    expect(localStorage.getItem('jnotes.account')).toBeNull();
    expect(sessionStorage.getItem('jnotes.googleToken')).toBeNull();
    expect(g.accessToken()).toBeNull();
    expect(localStorage.getItem('jnotes.penOnly')).toBe('true');
    const reloaded = await load();
    expect(reloaded.accessToken()).toBeNull();
  });

  it('ignores a forged redirect that this browser did not start', async () => {
    vi.restoreAllMocks(); // the real location, so the forged address is seen
    const g = await load();
    history.replaceState(null, '', `/${googleRedirectFor(`https://accounts.google.com/?client_id=${CLIENT}&state=forged&nonce=x`)}`);
    g.completeSignIn();
    expect(location.hash).toBe('#/');
    expect(localStorage.getItem('jnotes.account')).toBeNull();
    expect(g.accessToken()).toBeNull();
  });
});
