// Dev-server support for the HWR spike (never part of a build):
//  - `/__hwr/` stores samples and results the iPad sends, in spike/hwr/data/ (git-ignored, since it is
//    someone's handwriting), and hands the samples back to another origin (http → https).
//  - With HWR_HTTPS=1 (`npm run spike`), serves over HTTPS with cross-origin isolation. Safari only
//    offers WebGPU on secure pages, and ONNX Runtime only uses threads when the page is isolated.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const DIR = join(process.cwd(), 'spike/hwr/data');

export function hwrSpike(): Plugin {
  return {
    name: 'hwr-spike',
    apply: 'serve',
    config: () =>
      process.env.HWR_HTTPS
        ? { server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } } }
        : {},
    configureServer(server) {
      server.middlewares.use('/__hwr', (req, res) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (!/^(samples|results-[\w-]+)$/.test(name)) {
          res.statusCode = 404;
          return res.end();
        }
        const file = join(DIR, `${name}.json`);
        if (req.method === 'GET') {
          try {
            res.setHeader('Content-Type', 'application/json');
            return res.end(readFileSync(file));
          } catch {
            res.statusCode = 404;
            return res.end();
          }
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            JSON.parse(body);
            mkdirSync(DIR, { recursive: true });
            writeFileSync(file, body);
            res.end('saved');
          } catch {
            res.statusCode = 400;
            res.end('not JSON');
          }
        });
      });
    },
  };
}
