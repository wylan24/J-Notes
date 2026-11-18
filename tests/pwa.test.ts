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
});
