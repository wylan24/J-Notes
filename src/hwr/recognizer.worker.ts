// Reads handwriting off the main thread: TrOCR-small-handwritten (Microsoft, MIT), quantised ONNX
// from Xenova/trocr-small-handwritten, run through Transformers.js on WASM. Chosen by the spike
// (docs/HWR_SPIKE.md): on an iPad it reads a line in about 0.7 s on one thread, 0.35 s on four.
//
// The model (about 65 MB) is fetched from Hugging Face the first time and kept in the browser's
// Cache Storage by Transformers.js, so later loads and recognition work offline.

export type Request =
  | { type: 'load' }
  /** One line of writing as RGBA pixels, black on white. */
  | { type: 'line'; id: number; width: number; height: number; rgba: Uint8ClampedArray };

export type Reply =
  /** Download progress, in bytes, over every file seen so far. */
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'loaded'; threads: number }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

const MODEL = 'Xenova/trocr-small-handwritten';

type Recognise = (rgba: Uint8ClampedArray, width: number, height: number) => Promise<string>;
let loading: Promise<Recognise> | null = null;

const post = (r: Reply) => (self as unknown as Worker).postMessage(r);

function load(): Promise<Recognise> {
  loading ??= (async () => {
    const { pipeline, RawImage, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    // Several threads need cross-origin isolation; one thread is fast enough without it.
    const threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const onnx = env.backends.onnx as { wasm?: { numThreads?: number } };
    if (onnx.wasm) onnx.wasm.numThreads = threads;
    const files = new Map<string, { loaded: number; total: number }>();
    const pipe = await pipeline('image-to-text', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== 'progress' || !p.file || !p.total) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
        let loaded = 0, total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        post({ type: 'progress', loaded, total });
      },
    });
    post({ type: 'loaded', threads });
    return async (rgba, width, height) => {
      const out = (await pipe(new RawImage(rgba, width, height, 4), { max_new_tokens: 64 })) as { generated_text: string }[];
      return (out[0]?.generated_text ?? '').trim();
    };
  })();
  // A failed load can be tried again.
  loading.catch(() => (loading = null));
  return loading;
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      await load();
    } else {
      const read = await load();
      post({ type: 'result', id: m.id, text: await read(m.rgba, m.width, m.height) });
    }
  } catch (err) {
    post({ type: 'error', id: m.type === 'line' ? m.id : undefined, message: (err as Error).message ?? String(err) });
  }
};
