import { describe, expect, it } from 'vitest';
import { precacheUrls, precacheVersion, routeFor } from '../src/pwa/cachePlan';

describe('the offline cache', () => {
  const bundle = ['index.html', 'sw.js', 'assets/main-ab.js', 'assets/main-ab.js.map', 'assets/TextDocument-cd.js', 'assets/pdf.worker.min-ef.mjs', 'assets/main-12.css'];
  const pub = ['favicon.svg', 'manifest.webmanifest', 'icons/icon-192.png', '.DS_Store', 'icons\\maskable-512.png'];

  it('holds the page, every bundle (lazy ones too) and the public files, but not maps or the worker', () => {
    const urls = precacheUrls(bundle, pub);
    expect(urls).toEqual([
      '/',
      '/assets/TextDocument-cd.js',
      '/assets/main-12.css',
      '/assets/main-ab.js',
      '/assets/pdf.worker.min-ef.mjs',
      '/favicon.svg',
      '/icons/icon-192.png',
      '/icons/maskable-512.png',
      '/index.html',
      '/manifest.webmanifest',
    ]);
  });

  it('puts every file under the base path when the app is served from a subfolder', () => {
    const urls = precacheUrls(bundle, pub, '/J-Notes/');
    expect(urls[0]).toBe('/J-Notes/');
    expect(urls).toContain('/J-Notes/index.html');
    expect(urls).toContain('/J-Notes/assets/main-ab.js');
    expect(urls).toContain('/J-Notes/icons/maskable-512.png');
    expect(urls.every((u) => u.startsWith('/J-Notes/'))).toBe(true);
  });

  it('gets a new version whenever a file changes', () => {
    const a = precacheUrls(bundle, pub);
    const b = precacheUrls(bundle.map((f) => f.replace('main-ab', 'main-zz')), pub);
    expect(precacheVersion(a)).toBe(precacheVersion([...a]));
    expect(precacheVersion(a)).not.toBe(precacheVersion(b));
  });

  it('answers pages from the shell, its files from the cache, and leaves other sites alone', () => {
    const origin = 'https://notes.example';
    const cached = new Set(['/assets/main-ab.js']);
    expect(routeFor({ method: 'GET', url: `${origin}/#/n/abc`, mode: 'navigate' }, origin, cached)).toBe('shell');
    expect(routeFor({ method: 'GET', url: `${origin}/assets/main-ab.js` }, origin, cached)).toBe('cache-first');
    expect(routeFor({ method: 'GET', url: `${origin}/other.json` }, origin, cached)).toBe('network-first');
    expect(routeFor({ method: 'GET', url: 'https://fonts.example/x.woff2' }, origin, cached)).toBe('pass');
    expect(routeFor({ method: 'POST', url: `${origin}/assets/main-ab.js` }, origin, cached)).toBe('pass');
  });

  it('only answers requests inside its own folder when served from one', () => {
    const origin = 'https://someone.github.io';
    const cached = new Set(['/J-Notes/assets/main-ab.js']);
    const base = '/J-Notes/';
    expect(routeFor({ method: 'GET', url: `${origin}/J-Notes/#/n/abc`, mode: 'navigate' }, origin, cached, base)).toBe('shell');
    expect(routeFor({ method: 'GET', url: `${origin}/J-Notes/assets/main-ab.js` }, origin, cached, base)).toBe('cache-first');
    expect(routeFor({ method: 'GET', url: `${origin}/J-Notes/other.json` }, origin, cached, base)).toBe('network-first');
    // Another site on the same github.io origin is none of its business.
    expect(routeFor({ method: 'GET', url: `${origin}/other-app/`, mode: 'navigate' }, origin, cached, base)).toBe('pass');
    expect(routeFor({ method: 'GET', url: `${origin}/other-app/main.js` }, origin, cached, base)).toBe('pass');
  });
});
