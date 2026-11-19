// What the service worker caches and how it answers requests. Pure, so it is tested in Node and
// bundled into sw.js, and the build plugin uses it to list the files to precache.

/** The build's files, and a version that changes whenever any of them does. */
export interface Precache {
  version: string;
  /** Absolute paths, e.g. "/assets/index-ab12.js". */
  urls: string[];
}

/** Files never worth caching: source maps, and the worker itself (the browser fetches it fresh). */
const SKIP = /(\.map$|^sw\.js$|^\.|\/\.)/;

/**
 * Every file the app needs to run offline: the page, every bundle (lazy chunks included, so
 * pdf.js, the text editors and the rest work offline too) and the public files (icons, manifest).
 */
export function precacheUrls(bundleFiles: readonly string[], publicFiles: readonly string[], base = '/'): string[] {
  const out = new Set<string>([base, `${base}index.html`]);
  for (const f of [...bundleFiles, ...publicFiles]) {
    const rel = f.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || SKIP.test(rel)) continue;
    out.add(base + rel);
  }
  return [...out].sort();
}

/** A short hash of the file list. Bundles have content hashes in their names, so it changes with any edit. */
export function precacheVersion(urls: readonly string[], salt = ''): string {
  let h = 2166136261;
  for (const ch of salt + urls.join('\n')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export type Route = 'shell' | 'cache-first' | 'network-first' | 'pass';

/**
 * How to answer a request. Pages (the app uses hash routing, so there is only one) come from the
 * cached shell; precached files from the cache; other same-origin GETs from the network, falling
 * back to the cache; anything else (other sites, uploads) is left alone.
 */
export function routeFor(req: { method: string; url: string; mode?: string }, origin: string, precached: ReadonlySet<string>): Route {
  if (req.method !== 'GET') return 'pass';
  let u: URL;
  try {
    u = new URL(req.url);
  } catch {
    return 'pass';
  }
  if (u.origin !== origin) return 'pass';
  if (req.mode === 'navigate') return 'shell';
  if (precached.has(u.pathname)) return 'cache-first';
  return 'network-first';
}
