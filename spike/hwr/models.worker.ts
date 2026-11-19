// Runs the two candidate models off the main thread, as the app would.
//  - TrOCR-small-handwritten (Microsoft, MIT): a transformer that reads a whole line image.
//    Quantised ONNX from Xenova/trocr-small-handwritten, through Transformers.js.
//  - SimpleHTR (Xournal++ HTR, MIT): a small CNN + BiLSTM + CTC model that reads one word at a time.
//    ONNX from PellelNitram/xournalpp-htr-simple-htr, through ONNX Runtime Web.
//  - Pix2Text MFR (breezedeus/pix2text-mfr, MIT; task 10.5): reads a formula image to LaTeX. Same
//    architecture as TrOCR, but published without the merged decoder Transformers.js needs, so its
//    encoder and decoder run here directly, decoding greedily (no cache: formulas are short).
import * as ort from 'onnxruntime-web';

export type ModelId = 'trocr' | 'simplehtr' | 'mfr';
export type Device = 'wasm' | 'webgpu';

export type Request =
  /** `oneThread`: use one thread even where more are possible, to measure hosting without isolation. */
  | { type: 'load'; model: ModelId; device: Device; oneThread?: boolean }
  /** A line as RGBA pixels (TrOCR). */
  | { type: 'line'; id: number; width: number; height: number; rgba: Uint8ClampedArray }
  /** A line's words, each a 1×32×128 SimpleHTR input, run as one batch. */
  | { type: 'words'; id: number; inputs: Float32Array[] }
  /** A formula as Pix2Text's input: 3×384×384, scaled to [-1, 1]. */
  | { type: 'formula'; id: number; pixels: Float32Array };

export type Reply =
  | { type: 'loaded'; model: ModelId; ms: number; backend: string; threads: number }
  | { type: 'result'; id: number; text: string; ms: number }
  | { type: 'error'; message: string };

const ORT_VERSION = '1.31.1';
const SIMPLEHTR_URL = 'https://huggingface.co/PellelNitram/xournalpp-htr-simple-htr/resolve/main/model.onnx';
// SimpleHTR's config.json charset; the CTC blank is the class after the last character.
const CHARSET = [...'!"#&\'()*+,-./0123456789:;?ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'];

// Threads need cross-origin isolation, which neither the dev server nor plain static hosting gives.
let threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

type Recognise = (rgba: Uint8ClampedArray, width: number, height: number) => Promise<string>;
let trocr: Recognise | null = null;
let simple: ort.InferenceSession | null = null;
let mfr: { encoder: ort.InferenceSession; decoder: ort.InferenceSession; decode: (ids: number[]) => string } | null = null;

const MFR = 'https://huggingface.co/breezedeus/pix2text-mfr/resolve/main/';
// From its generation_config.json.
const MFR_START = 2, MFR_EOS = 2, MFR_MAX = 120;

async function loadMfr(): Promise<string> {
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  ort.env.wasm.numThreads = threads;
  const { AutoTokenizer, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  const bytes = async (f: string) => new Uint8Array(await (await fetch(MFR + f)).arrayBuffer());
  const [enc, dec, tokenizer] = await Promise.all([bytes('encoder_model.onnx'), bytes('decoder_model.onnx'), AutoTokenizer.from_pretrained('breezedeus/pix2text-mfr')]);
  const opts = { executionProviders: ['wasm'] };
  mfr = {
    encoder: await ort.InferenceSession.create(enc, opts),
    decoder: await ort.InferenceSession.create(dec, opts),
    decode: (ids) => tokenizer.decode(ids, { skip_special_tokens: true }),
  };
  return 'wasm';
}

async function readFormula(pixels: Float32Array): Promise<string> {
  const { encoder, decoder, decode } = mfr!;
  const enc = await encoder.run({ [encoder.inputNames[0]]: new ort.Tensor('float32', pixels, [1, 3, 384, 384]) });
  const hidden = enc[encoder.outputNames[0]];
  const ids = [MFR_START];
  for (let step = 0; step < MFR_MAX; step++) {
    const feeds: Record<string, ort.Tensor> = {};
    for (const name of decoder.inputNames) {
      if (name.includes('input_ids')) feeds[name] = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
      else if (name.includes('encoder_hidden_states')) feeds[name] = hidden;
      else if (name.includes('attention_mask')) feeds[name] = new ort.Tensor('int64', BigInt64Array.from(ids.map(() => 1n)), [1, ids.length]);
    }
    const out = await decoder.run(feeds);
    const logits = out[decoder.outputNames[0]];
    const vocab = logits.dims[2];
    const data = logits.data as Float32Array;
    const base = (ids.length - 1) * vocab;
    let best = 0;
    for (let c = 1; c < vocab; c++) if (data[base + c] > data[base + best]) best = c;
    if (best === MFR_EOS) break;
    ids.push(best);
  }
  return decode(ids.slice(1));
}

const post = (r: Reply) => (self as unknown as Worker).postMessage(r);

async function loadTrocr(device: Device): Promise<string> {
  const { pipeline, RawImage, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  const onnx = env.backends.onnx as { wasm?: { numThreads?: number } };
  if (onnx.wasm) onnx.wasm.numThreads = threads;
  const pipe = await pipeline('image-to-text', 'Xenova/trocr-small-handwritten', { dtype: 'q8', device });
  trocr = async (rgba, width, height) => {
    const out = (await pipe(new RawImage(rgba, width, height, 4), { max_new_tokens: 40 })) as { generated_text: string }[];
    return out[0]?.generated_text ?? '';
  };
  return device;
}

async function loadSimple(): Promise<string> {
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  ort.env.wasm.numThreads = threads;
  const bytes = new Uint8Array(await (await fetch(SIMPLEHTR_URL)).arrayBuffer());
  simple = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  return 'wasm';
}

/** Greedy CTC: best class per step, repeats collapsed, blanks dropped. `lp` is [steps, batch, classes]. */
function ctcGreedy(lp: Float32Array, steps: number, batch: number, classes: number, b: number): string {
  const blank = classes - 1;
  let prev = blank, out = '';
  for (let t = 0; t < steps; t++) {
    const base = (t * batch + b) * classes;
    let best = 0;
    for (let c = 1; c < classes; c++) if (lp[base + c] > lp[base + best]) best = c;
    if (best !== prev && best !== blank) out += CHARSET[best] ?? '';
    prev = best;
  }
  return out;
}

async function readWords(inputs: Float32Array[]): Promise<string> {
  if (!inputs.length) return '';
  const data = new Float32Array(inputs.length * 32 * 128);
  inputs.forEach((x, i) => data.set(x, i * 32 * 128));
  const res = await simple!.run({ [simple!.inputNames[0]]: new ort.Tensor('float32', data, [inputs.length, 1, 32, 128]) });
  const lp = res[simple!.outputNames[0]];
  const [steps, batch, classes] = lp.dims as number[];
  return inputs.map((_, b) => ctcGreedy(lp.data as Float32Array, steps, batch, classes, b)).join(' ');
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      if (m.oneThread) threads = 1;
      const t0 = performance.now();
      const backend = m.model === 'trocr' ? await loadTrocr(m.device) : m.model === 'mfr' ? await loadMfr() : await loadSimple();
      post({ type: 'loaded', model: m.model, ms: performance.now() - t0, backend, threads });
    } else {
      const t0 = performance.now();
      const text = m.type === 'line' ? await trocr!(m.rgba, m.width, m.height) : m.type === 'formula' ? await readFormula(m.pixels) : await readWords(m.inputs);
      post({ type: 'result', id: m.id, text, ms: performance.now() - t0 });
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error).message ?? String(err) });
  }
};
