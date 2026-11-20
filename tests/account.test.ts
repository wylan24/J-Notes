import { describe, expect, it } from 'vitest';
import {
  authUrl,
  canUseDrive,
  DRIVE_SCOPE,
  isAuthRedirect,
  jwtClaims,
  normaliseAccount,
  normalisePending,
  normaliseToken,
  readRedirect,
  tokenValid,
  type PendingSignIn,
} from '../src/core/account';

const CLIENT = '123-abc.apps.googleusercontent.com';
const NOW = 1_800_000_000_000;
const pending: PendingSignIn = { state: 'st8', nonce: 'n0nce', returnTo: '#/n/abc', startedAt: NOW - 30_000 };

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`;
const claims = {
  iss: 'https://accounts.google.com',
  aud: CLIENT,
  sub: '1099',
  email: 'ada@example.com',
  name: 'Adá Lovelace',
  picture: 'https://lh3.googleusercontent.com/a/x',
  nonce: 'n0nce',
  exp: NOW / 1000 + 3600,
};
const redirect = (over: Record<string, string> = {}, c: Record<string, unknown> = claims) =>
  '#' +
  new URLSearchParams({
    state: 'st8',
    access_token: 'ya29.tok',
    token_type: 'Bearer',
    expires_in: '3599',
    scope: `email profile openid ${DRIVE_SCOPE}`,
    id_token: jwt(c),
    ...over,
  });

describe('Google sign-in', () => {
  it('asks for sign-in, email, profile and the app data folder only', () => {
    const u = new URL(authUrl({ clientId: CLIENT, redirectUri: 'https://x.github.io/J-Notes/', state: 's', nonce: 'n' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual(['email', 'openid', 'profile', DRIVE_SCOPE].sort());
    expect(u.searchParams.get('response_type')).toBe('token id_token');
    expect(u.searchParams.get('redirect_uri')).toBe('https://x.github.io/J-Notes/');
    expect(u.searchParams.has('prompt')).toBe(false);
    const silent = new URL(authUrl({ clientId: CLIENT, redirectUri: 'r', state: 's', nonce: 'n', silent: true, loginHint: 'ada@example.com' }));
    expect(silent.searchParams.get('prompt')).toBe('none');
    expect(silent.searchParams.get('login_hint')).toBe('ada@example.com');
  });

  it('tells a redirect from an app route', () => {
    expect(isAuthRedirect(redirect())).toBe(true);
    expect(isAuthRedirect('#state=s&error=access_denied')).toBe(true);
    expect(isAuthRedirect('#/n/abc')).toBe(false);
    expect(isAuthRedirect('#/present/abc')).toBe(false);
    expect(isAuthRedirect('')).toBe(false);
  });

  it('reads the account and token, and goes back where sign-in started', () => {
    const r = readRedirect(redirect(), pending, CLIENT, NOW);
    expect(r).toEqual({
      kind: 'signed-in',
      account: { id: '1099', email: 'ada@example.com', name: 'Adá Lovelace', picture: 'https://lh3.googleusercontent.com/a/x' },
      token: { token: 'ya29.tok', expiresAt: NOW + 3_599_000, scopes: ['email', 'profile', 'openid', DRIVE_SCOPE] },
      returnTo: '#/n/abc',
    });
  });

  it('decodes UTF-8 names in the ID token', () => {
    expect(jwtClaims(jwt({ name: 'Adá 李' }))?.name).toBe('Adá 李');
    expect(jwtClaims('not-a-jwt')).toBeNull();
  });

  it('refuses a redirect this browser did not start, or started too long ago', () => {
    expect(readRedirect(redirect(), null, CLIENT, NOW).kind).toBe('error');
    expect(readRedirect(redirect({ state: 'other' }), pending, CLIENT, NOW).kind).toBe('error');
    expect(readRedirect(redirect(), { ...pending, startedAt: NOW - 11 * 60_000 }, CLIENT, NOW).kind).toBe('error');
  });

  it('refuses an ID token for another app, another sign-in, or past its expiry', () => {
    for (const bad of [{ aud: 'someone-else' }, { nonce: 'replayed' }, { iss: 'https://evil.example' }, { exp: NOW / 1000 - 1 }, { sub: undefined }]) {
      const r = readRedirect(redirect({}, { ...claims, ...bad }), pending, CLIENT, NOW);
      expect(r.kind).toBe('error');
    }
    expect(readRedirect(redirect({ id_token: 'garbage' }), pending, CLIENT, NOW).kind).toBe('error');
    expect(readRedirect(redirect({ expires_in: '0' }), pending, CLIENT, NOW).kind).toBe('error');
  });

  it('explains a cancelled sign-in and still goes back', () => {
    const r = readRedirect('#state=st8&error=access_denied', pending, CLIENT, NOW);
    expect(r).toEqual({ kind: 'error', message: 'Sign-in was cancelled.', returnTo: '#/n/abc' });
  });

  it('falls back to the email when there is no name, and drops non-HTTPS pictures', () => {
    const r = readRedirect(redirect({}, { ...claims, name: '', picture: 'http://x/p.png' }), pending, CLIENT, NOW);
    expect(r.kind === 'signed-in' && r.account).toEqual({ id: '1099', email: 'ada@example.com', name: 'ada@example.com' });
  });

  it('knows when the token needs renewing and whether Drive was allowed', () => {
    const t = { token: 't', expiresAt: NOW + 30 * 60_000, scopes: ['openid', DRIVE_SCOPE] };
    expect(tokenValid(t, NOW)).toBe(true);
    expect(tokenValid({ ...t, expiresAt: NOW + 30_000 }, NOW)).toBe(false);
    expect(tokenValid(null, NOW)).toBe(false);
    expect(canUseDrive(t)).toBe(true);
    expect(canUseDrive({ ...t, scopes: ['openid', 'email'] })).toBe(false);
  });

  it('reads back only well-formed stored values', () => {
    expect(normaliseAccount({ id: '1', email: 'a@b.c', name: '' })).toEqual({ id: '1', email: 'a@b.c', name: 'a@b.c' });
    expect(normaliseAccount({ email: 'a@b.c' })).toBeNull();
    expect(normaliseAccount('x')).toBeNull();
    expect(normaliseToken({ token: 't', expiresAt: 1, scopes: ['a', 2] })).toEqual({ token: 't', expiresAt: 1, scopes: ['a'] });
    expect(normaliseToken({ token: 't' })).toBeNull();
    expect(normalisePending({ state: 's', nonce: 'n', startedAt: 1, returnTo: 'https://evil.example' })?.returnTo).toBe('#/');
    expect(normalisePending({ state: 's' })).toBeNull();
  });
});
