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

export default defineConfig({
  // `npm run spike` serves over HTTPS (a self-signed certificate) for the handwriting spike.
  plugins: [react(), serviceWorker(), hwrSpike(), ...(process.env.HWR_HTTPS ? [basicSsl()] : [])],
  build: {
    rollupOptions: {
      input: { main: 'index.html', sw: 'src/pwa/sw.ts' },
      // The worker keeps a fixed name at the root, so it can control the whole app and be found again.
      output: { entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
    },
  },
  test: { environment: 'node', globals: true },
});
