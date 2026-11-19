// HWR spike (task 10.0): write the prompts with the Pencil, then run both candidate models over
// what was written and compare accuracy and speed on this device. Dev-only; not part of the app.
import { PROMPTS } from './prompts';
import { corpusScore, loose, score, tidy, timing, type Score, type Timing } from './metrics';
import { splitWords } from './segment';
import { renderInk, simpleHtrInput, asStroke, type InkStroke } from './render';
import { paintStroke } from '../../src/render/stroke';
import type { Device, ModelId, Reply, Request } from './models.worker';

// --- Samples (IndexedDB) ---------------------------------------------------------------------

interface Sample {
  index: number;
  prompt: string;
  strokes: InkStroke[];
  writtenAt: number;
}

const DB = 'hwr-spike';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('samples', { keyPath: 'index' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction('samples', mode).objectStore('samples'));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const allSamples = () => tx<Sample[]>('readonly', (s) => s.getAll() as IDBRequest<Sample[]>);
const putSample = (x: Sample) => tx('readwrite', (s) => s.put(x));

function download(name: string, data: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Send JSON to the dev server on the Mac (spike/hwr/data/<name>.json). */
async function sendToMac(name: string, data: unknown): Promise<void> {
  const r = await fetch(`/__hwr/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(`the Mac answered ${r.status}`);
}

const app = document.getElementById('app')!;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...kids);
  return el;
};

// --- Write --------------------------------------------------------------------------------------

async function showWrite(start?: number) {
  const samples = new Map((await allSamples()).map((s) => [s.index, s]));
  let index = start ?? PROMPTS.findIndex((_, i) => !samples.has(i));
  if (index < 0) index = 0;
  let strokes: InkStroke[] = samples.get(index)?.strokes.map((s) => ({ ...s, points: [...s.points] })) ?? [];
  let penSeen = false;

  const pad = h('canvas', { id: 'pad' });
  const counter = h('div', { className: 'muted' });
  const promptEl = h('div', { className: 'prompt' });
  const dots = h('div', { className: 'dots' });
  const save = h('button', { className: 'primary', textContent: 'Save and next' });
  const undo = h('button', { textContent: 'Undo stroke' });
  const clear = h('button', { textContent: 'Clear' });
  // On a touch screen, fingers and palms don't write unless this is turned off.
  const stylus = h('label', {}, h('input', { type: 'checkbox', id: 'stylus', checked: navigator.maxTouchPoints > 0 }), 'Stylus only');
  const sendBtn = h('button', { textContent: 'Send samples to Mac' });
  const loadBtn = h('button', { textContent: 'Load samples from Mac' });
  const exportBtn = h('button', { textContent: 'Download samples' });
  const importBtn = h('button', { textContent: 'Load samples…' });
  const note = h('span', { className: 'muted' });
  app.replaceChildren(
    h('p', { className: 'muted', textContent: 'Write each line as you normally would in notes, on one line, at your usual size. The default pen is used. Wrong? Clear and write it again. Samples stay in this browser until you download them.' }),
    counter,
    promptEl,
    pad,
    h('div', { className: 'row' }, save, undo, clear, stylus),
    dots,
    h('div', { className: 'row' }, sendBtn, loadBtn, exportBtn, importBtn, note),
  );

  const dpr = Math.min(3, devicePixelRatio || 1);
  const ctx = pad.getContext('2d')!;
  const paint = () => {
    const r = pad.getBoundingClientRect();
    if (pad.width !== Math.round(r.width * dpr)) [pad.width, pad.height] = [Math.round(r.width * dpr), Math.round(r.height * dpr)];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fffefb';
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.strokeStyle = '#c9d6e8';
    for (const y of [150]) {
      ctx.beginPath();
      ctx.moveTo(16, y + 0.5);
      ctx.lineTo(r.width - 16, y + 0.5);
      ctx.stroke();
    }
    strokes.forEach((s, i) => s.points.length && paintStroke(ctx, asStroke(s, i)));
  };
  const refresh = () => {
    counter.textContent = `Line ${index + 1} of ${PROMPTS.length} · ${samples.size} written`;
    promptEl.textContent = PROMPTS[index];
    save.textContent = index === PROMPTS.length - 1 ? 'Save' : 'Save and next';
    save.disabled = !strokes.length;
    dots.replaceChildren(
      ...PROMPTS.map((_, i) => {
        const b = h('button', { textContent: String(i + 1), className: `${samples.has(i) ? 'done' : ''} ${i === index ? 'here' : ''}`, title: PROMPTS[i] });
        b.onclick = () => void showWrite(i);
        return b;
      }),
    );
    paint();
  };

  let cur: InkStroke | null = null;
  let curId = -1;
  const pt = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 0.5 };
  };
  // Safari: without this, a Pencil press can start text selection, a callout or a scroll instead of a stroke.
  pad.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  pad.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  pad.onpointerdown = (e) => {
    if (e.pointerType === 'pen' && !penSeen) {
      // The first time the pen is used, anything a palm drew on this line goes.
      penSeen = true;
      strokes = strokes.filter((s) => s.pen);
    }
    const only = (document.getElementById('stylus') as HTMLInputElement).checked || penSeen;
    if (e.pointerType === 'touch' && only) return;
    if (cur) {
      // The pen always wins over a finger or palm that got there first.
      if (e.pointerType !== 'pen' || cur.pen) return;
      strokes = strokes.filter((s) => s !== cur);
    }
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    curId = e.pointerId;
    cur = { points: [pt(e)], pen: e.pointerType === 'pen' };
    strokes.push(cur);
  };
  pad.onpointermove = (e) => {
    if (!cur || e.pointerId !== curId) return;
    for (const c of e.getCoalescedEvents?.() ?? [e]) {
      const p = pt(c);
      const q = cur.points[cur.points.length - 1];
      if (p.x !== q.x || p.y !== q.y) cur.points.push(p);
    }
    paint();
  };
  pad.onpointerup = pad.onpointercancel = (e) => {
    if (!cur || e.pointerId !== curId) return;
    cur = null;
    refresh();
  };
  undo.onclick = () => {
    strokes.pop();
    refresh();
  };
  clear.onclick = () => {
    strokes = [];
    refresh();
  };
  save.onclick = async () => {
    const s: Sample = { index, prompt: PROMPTS[index], strokes, writtenAt: Date.now() };
    await putSample(s);
    samples.set(index, s);
    const next = PROMPTS.findIndex((_, i) => i > index && !samples.has(i));
    void showWrite(next >= 0 ? next : Math.min(index + 1, PROMPTS.length - 1));
  };
  sendBtn.onclick = async () => {
    try {
      const all = await allSamples();
      await sendToMac('samples', { format: 'hwr-spike-samples', version: 1, samples: all });
      note.textContent = `Sent ${all.length} lines to the Mac.`;
    } catch (e) {
      note.textContent = `Could not send: ${(e as Error).message}`;
    }
  };
  loadBtn.onclick = async () => {
    try {
      const r = await fetch('/__hwr/samples');
      if (!r.ok) throw new Error(r.status === 404 ? 'none have been sent yet' : `the Mac answered ${r.status}`);
      const data = (await r.json()) as { samples?: Sample[] };
      for (const x of data.samples ?? []) await putSample(x);
      void showWrite();
    } catch (e) {
      note.textContent = `Could not load: ${(e as Error).message}`;
    }
  };
  exportBtn.onclick = async () => download('hwr-samples.json', { format: 'hwr-spike-samples', version: 1, samples: await allSamples() });
  importBtn.onclick = () => {
    const input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const data = JSON.parse(await f.text()) as { samples?: Sample[] };
      for (const s of data.samples ?? []) await putSample(s);
      void showWrite();
    };
    input.click();
  };
  new ResizeObserver(paint).observe(pad);
  refresh();
}

// --- Run ----------------------------------------------------------------------------------------

interface LineResult {
  index: number;
  truth: string;
  guess: string;
  /** Worker time for the model. */
  modelMs: number;
  /** From starting to draw the images to having text. */
  totalMs: number;
  /** SimpleHTR: words found by splitting vs words in the truth. */
  words?: [number, number];
}

interface ModelRun {
  model: ModelId;
  label: string;
  backend: string;
  threads: number;
  loadMs: number;
  lines: LineResult[];
  firstMs: number;
  warm: Timing;
  warmModel: Timing;
  strict: Score;
  loose: Score;
  exactLoose: number;
  wordSplitRight?: number;
  error?: string;
}

/** A model on a backend: one row of results. */
interface Config {
  model: ModelId;
  device: Device;
  label: string;
  oneThread?: boolean;
}
const CONFIGS: Config[] = [
  { model: 'trocr', device: 'wasm', label: 'TrOCR-small-handwritten (q8) · WASM' },
  { model: 'trocr', device: 'wasm', oneThread: true, label: 'TrOCR-small-handwritten (q8) · WASM, 1 thread' },
  { model: 'trocr', device: 'webgpu', label: 'TrOCR-small-handwritten (q8) · WebGPU' },
  { model: 'simplehtr', device: 'wasm', label: 'SimpleHTR + gap word split · WASM' },
];
/** Safari offers WebGPU only to secure (HTTPS) pages. */
const webgpuReason = () => (!isSecureContext ? 'needs HTTPS: open this page from npm run spike' : !('gpu' in navigator) ? 'this browser has no WebGPU' : null);

/** Long enough for a slow first download (the iPad took 5 minutes for TrOCR), short of forever. */
const LOAD_TIMEOUT_MS = 15 * 60_000;
const LINE_TIMEOUT_MS = 60_000;

class WorkerClient {
  private w = new Worker(new URL('./models.worker.ts', import.meta.url), { type: 'module' });
  private waiting: ((r: Reply) => void) | null = null;
  constructor() {
    this.w.onmessage = (e: MessageEvent<Reply>) => this.waiting?.(e.data);
    this.w.onerror = (e) => this.waiting?.({ type: 'error', message: e.message || 'worker failed' });
  }
  /** Send a request and wait for its reply, or an error after `timeoutMs` (a stalled download). */
  ask(req: Request, transfer: Transferable[] = [], timeoutMs = LINE_TIMEOUT_MS): Promise<Reply> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ type: 'error', message: `no answer after ${Math.round(timeoutMs / 1000)} s` }), timeoutMs);
      this.waiting = (r) => {
        clearTimeout(timer);
        resolve(r);
      };
      this.w.postMessage(req, transfer);
    });
  }
  close() {
    this.w.terminate();
  }
}

/** A line in a handwriting-like font, for checking the pipeline without written samples. */
function fontLine(text: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '44px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive';
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 40;
  c.height = 90;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = font;
  ctx.fillStyle = '#000';
  ctx.fillText(text, 20, 60);
  return c;
}

async function runModel({ model, device, label, oneThread }: Config, samples: Sample[], fontCheck: boolean, progress: (s: string) => void): Promise<ModelRun> {
  const worker = new WorkerClient();
  const run: ModelRun = { model, label, backend: '', threads: 1, loadMs: 0, lines: [], firstMs: 0, warm: timing([]), warmModel: timing([]), strict: { cer: 0, wer: 0 }, loose: { cer: 0, wer: 0 }, exactLoose: 0 };
  try {
    progress(`${label}: downloading and starting…`);
    const loaded = await worker.ask({ type: 'load', model, device, oneThread }, [], LOAD_TIMEOUT_MS);
    if (loaded.type === 'error') throw new Error(loaded.message);
    if (loaded.type !== 'loaded') throw new Error('unexpected reply');
    Object.assign(run, { backend: loaded.backend, threads: loaded.threads, loadMs: loaded.ms });
    for (const [n, s] of samples.entries()) {
      progress(`${label}: line ${n + 1} of ${samples.length}`);
      const t0 = performance.now();
      let reply: Reply;
      let words: [number, number] | undefined;
      if (model === 'trocr') {
        const line = fontCheck ? fontLine(s.prompt) : renderInk(s.strokes, 1);
        const rgba = line.getContext('2d')!.getImageData(0, 0, line.width, line.height).data;
        reply = await worker.ask({ type: 'line', id: n, width: line.width, height: line.height, rgba }, [rgba.buffer]);
      } else {
        const images = fontCheck
          ? s.prompt.split(' ').map(fontLine)
          : splitWords(s.strokes.map((st) => st.points)).map((ids) => renderInk(ids.map((i) => s.strokes[i]), 1));
        words = [images.length, tidy(s.prompt).split(' ').length];
        const inputs = images.map((im) => simpleHtrInput(im));
        reply = await worker.ask({ type: 'words', id: n, inputs }, inputs.map((x) => x.buffer));
      }
      if (reply.type === 'error') throw new Error(reply.message);
      if (reply.type !== 'result') throw new Error('unexpected reply');
      run.lines.push({ index: s.index, truth: s.prompt, guess: reply.text, modelMs: reply.ms, totalMs: performance.now() - t0, words });
    }
  } catch (e) {
    run.error = (e as Error).message;
  } finally {
    worker.close();
  }
  const pairs = run.lines.map((l) => ({ truth: l.truth, guess: l.guess }));
  run.strict = corpusScore(pairs);
  run.loose = corpusScore(pairs, loose);
  run.exactLoose = run.lines.filter((l) => loose(l.truth) === loose(l.guess)).length;
  run.firstMs = run.lines[0]?.totalMs ?? 0;
  run.warm = timing(run.lines.slice(1).map((l) => l.totalMs));
  run.warmModel = timing(run.lines.slice(1).map((l) => l.modelMs));
  if (model === 'simplehtr' && !fontCheck) run.wordSplitRight = run.lines.filter((l) => l.words && l.words[0] === l.words[1]).length;
  return run;
}

function deviceInfo() {
  // iPad Safari reports itself as a Mac; a Mac has no touch screen.
  const iPad = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  return {
    device: iPad ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'desktop',
    userAgent: navigator.userAgent,
    secure: isSecureContext,
    cores: navigator.hardwareConcurrency,
    crossOriginIsolated: self.crossOriginIsolated,
    webgpu: 'gpu' in navigator,
    screen: `${screen.width}×${screen.height} @${devicePixelRatio}x`,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ms = (x: number) => `${Math.round(x)} ms`;

function summaryMarkdown(runs: ModelRun[], n: number, fontCheck: boolean): string {
  const d = deviceInfo();
  const rows = runs.map(
    (r) =>
      `| ${r.label} | ${r.backend}, ${r.threads} thread${r.threads === 1 ? '' : 's'} | ${(r.loadMs / 1000).toFixed(1)} s | ${ms(r.firstMs)} | ${ms(r.warm.median)} / ${ms(r.warm.p95)} | ${pct(r.strict.cer)} / ${pct(r.strict.wer)} | ${pct(r.loose.cer)} / ${pct(r.loose.wer)} | ${r.exactLoose}/${r.lines.length} |${r.error ? ` error: ${r.error}` : ''}`,
  );
  const split = runs.find((r) => r.wordSplitRight !== undefined);
  return [
    `**${fontCheck ? 'Font check (not handwriting)' : `${n} handwritten lines`}** · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    `Device: ${d.device} · ${d.userAgent} · ${d.cores} cores · HTTPS: ${d.secure} · cross-origin isolated: ${d.crossOriginIsolated} · WebGPU: ${d.webgpu}`,
    '',
    '| Model | Backend | Load (cold) | First line | Line median / p95 | CER / WER (exact) | CER / WER (search) | Lines right (search) |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    ...(split ? ['', `Word split matched the word count on ${split.wordSplitRight}/${split.lines.length} lines.`] : []),
  ].join('\n');
}

async function showRun() {
  const samples = (await allSamples()).sort((a, b) => a.index - b.index);
  const noGpu = webgpuReason();
  const picks = CONFIGS.map((c) => {
    const off = c.device === 'webgpu' && noGpu;
    const box = h('input', { type: 'checkbox', checked: !off, disabled: !!off });
    return { c, box, row: h('div', { className: 'row' }, h('label', {}, box, c.label, ...(off ? [h('span', { className: 'muted', textContent: ` (${off})` })] : []))) };
  });
  const fontCheck = h('input', { type: 'checkbox', checked: !samples.length });
  const go = h('button', { className: 'primary', textContent: 'Run models' });
  const status = h('p', { className: 'muted', textContent: samples.length ? `${samples.length} written lines ready.` : 'No lines written yet: write some first, or tick Font check to test the pipeline.' });
  const out = h('div');
  app.replaceChildren(
    ...picks.map((p) => p.row),
    h('div', { className: 'row' }, h('label', {}, fontCheck, 'Font check: typed text in a handwriting font instead of the written lines'), go),
    status,
    out,
  );
  go.onclick = async () => {
    const font = fontCheck.checked;
    const set: Sample[] = font ? PROMPTS.map((prompt, index) => ({ index, prompt, strokes: [], writtenAt: 0 })) : samples;
    if (!set.length) return;
    go.disabled = true;
    const runs: ModelRun[] = [];
    // One model at a time, each in a fresh worker, so neither slows the other down.
    for (const { c } of picks.filter((p) => p.box.checked)) {
      runs.push(await runModel(c, set, font, (s) => (status.textContent = s)));
    }
    go.disabled = false;
    status.textContent = 'Done. Results stay on screen until you leave this tab; download them to keep.';
    renderResults(out, runs, set.length, font);
  };
}

function renderResults(out: HTMLElement, runs: ModelRun[], n: number, font: boolean) {
  const md = summaryMarkdown(runs, n, font);
  const copy = h('button', { textContent: 'Copy summary' });
  copy.onclick = () => void navigator.clipboard.writeText(md).then(() => (copy.textContent = 'Copied'));
  const send = h('button', { textContent: 'Send results to Mac' });
  send.onclick = () =>
    void sendToMac(`results-${font ? 'font' : 'ink'}-${Date.now()}`, { format: 'hwr-spike-results', version: 1, fontCheck: font, device: deviceInfo(), runs }).then(
      () => (send.textContent = 'Sent'),
      (e: Error) => (send.textContent = `Could not send: ${e.message}`),
    );
  const save = h('button', { textContent: 'Download results' });
  save.onclick = () => download(`hwr-results-${font ? 'font' : 'ink'}.json`, { format: 'hwr-spike-results', version: 1, fontCheck: font, device: deviceInfo(), runs });
  const head = h('tr', {}, ...['#', 'Written', ...runs.map((r) => r.label)].map((t) => h('th', { textContent: t })));
  const body = (runs[0]?.lines ?? []).map((_, i) => {
    const truth = runs[0].lines[i].truth;
    return h(
      'tr',
      {},
      h('td', { textContent: String(runs[0].lines[i].index + 1) }),
      h('td', { textContent: truth }),
      ...runs.map((r) => {
        const l = r.lines[i];
        if (!l) return h('td');
        const s = score(loose(truth), loose(l.guess));
        return h('td', { className: s.cer === 0 ? 'ok' : s.cer > 0.25 ? 'err' : '' }, l.guess || '—', h('div', { className: 'muted', textContent: `${ms(l.totalMs)}${l.words ? ` · ${l.words[0]}/${l.words[1]} words` : ''}` }));
      }),
    );
  });
  out.replaceChildren(h('h2', { textContent: 'Summary' }), h('pre', { textContent: md }), h('div', { className: 'row' }, copy, send, save), h('h2', { textContent: 'Line by line' }), h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
}

// --- Tabs ---------------------------------------------------------------------------------------

const tabs = { write: document.getElementById('tab-write')!, run: document.getElementById('tab-run')! };
function show(tab: 'write' | 'run') {
  tabs.write.setAttribute('aria-pressed', String(tab === 'write'));
  tabs.run.setAttribute('aria-pressed', String(tab === 'run'));
  void (tab === 'write' ? showWrite() : showRun());
}
tabs.write.onclick = () => show('write');
tabs.run.onclick = () => show('run');
show(location.hash === '#run' ? 'run' : 'write');
