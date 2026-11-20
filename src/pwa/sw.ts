// The service worker: caches the whole app on install so it opens and works with no network.
// Built as its own classic script (sw.js); the build prepends `self.__JNOTES_PRECACHE__`.
import { routeFor, type Precache } from './cachePlan';

// Just the parts of the service worker API used here (the DOM lib doesn't describe workers).
interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(r: Response | Promise<Response>): void;
}
interface Worker {
  __JNOTES_PRECACHE__: Precache;
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
}

const sw = self as unknown as Worker;
const { version, base, urls } = sw.__JNOTES_PRECACHE__;
const CACHE = `jnotes-${version}`;
const precached = new Set(urls);

sw.addEventListener('install', (e) => {
  // Everything or nothing: a half-cached app would fail offline in confusing ways.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(urls)));
});

sw.addEventListener('message', (e) => {
  // The page asks a waiting update to take over when the person chooses to reload.
  if (e.data === 'skip-waiting') void sw.skipWaiting();
});

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('jnotes-') && key !== CACHE) await caches.delete(key);
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (e) => {
  const route = routeFor(e.request, sw.location.origin, precached, base);
  if (route === 'pass') return;
  if (route === 'shell') {
    e.respondWith(caches.match(`${base}index.html`, { cacheName: CACHE }).then((r) => r ?? fetch(e.request)));
  } else if (route === 'cache-first') {
    e.respondWith(caches.match(e.request, { cacheName: CACHE }).then((r) => r ?? fetch(e.request)));
  } else {
    e.respondWith(fetch(e.request).catch(async () => (await caches.match(e.request)) ?? Response.error()));
  }
});
