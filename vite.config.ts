/// <reference types="vitest" />
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { precacheUrls, precacheVersion } from './src/pwa/cachePlan';
import { hwrSpike } from './spike/hwr/vitePlugin';

/** Every file under a directory, relative to it. */
function filesIn(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? filesIn(full).map((f) => join(name, f)) : [name];
    });
  } catch {
    return [];
  }
}

/**
 * Builds the service worker: once the bundle is known, sw.js is given the list of every file to
 * cache (and a version from it), so a new build always installs fresh and the app works offline.
 */
function serviceWorker(): Plugin {
  let publicDir = 'public';
  return {
    name: 'jnotes-service-worker',
    apply: 'build',
    configResolved(c) {
      publicDir = c.publicDir;
    },
    generateBundle(_opts, bundle) {
      const sw = bundle['sw.js'];
      if (!sw || sw.type !== 'chunk') return;
      const urls = precacheUrls(
        Object.keys(bundle),
        filesIn(publicDir).map((f) => relative('.', f)),
      );
      sw.code = `self.__JNOTES_PRECACHE__=${JSON.stringify({ version: precacheVersion(urls), urls })};\n${sw.code}`;
    },
  };
}

/**
 * Leaves out ONNX Runtime's own copy of its WASM (27 MB). Handwriting recognition fetches the
 * runtime from jsDelivr when it is first turned on and keeps it in the browser cache
 * (Transformers.js sets `wasmPaths`), so the bundled copy is never loaded. Left in, the service
 * worker would precache it for everyone, and it is over Cloudflare Pages' 25 MiB file limit.
 */
function dropOrtWasm(): Plugin {
  return {
    name: 'jnotes-drop-ort-wasm',
    apply: 'build',
    generateBundle(_opts, bundle) {
      for (const name of Object.keys(bundle)) if (/(^|\/)ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name];
    },
  };
}

export default defineConfig({
  // `npm run spike` serves over HTTPS (a self-signed certificate) for the handwriting spike.
  plugins: [react(), dropOrtWasm(), serviceWorker(), hwrSpike(), ...(process.env.HWR_HTTPS ? [basicSsl()] : [])],
  // The handwriting worker loads its model code on demand, so it is built as a module (Safari 15+).
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: { main: 'index.html', sw: 'src/pwa/sw.ts' },
      // The worker keeps a fixed name at the root, so it can control the whole app and be found again.
      output: { entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
    },
  },
  test: { environment: 'node', globals: true },
});
