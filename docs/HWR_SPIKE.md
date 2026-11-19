# Handwriting recognition spike (task 10.0)

Question: can an on-device model read handwriting well enough, and fast enough, in Safari on an iPad, to build
handwriting search, convert-to-text and spellcheck (tasks 10.3–10.4)? This page records how the two candidates were
chosen, how they are measured, the results, and the go/no-go decision.

Status: **done, 2026-11-19. Go with TrOCR-small on WASM** (see Decision). It passes on one thread; cross-origin
isolation roughly halves the time per line but is not required.

## Candidates

No openly licensed model that reads pen strokes directly (online recognition) could be found. Goodnotes ships its own
(`HWRecognitionLSTM_latin.onnx`, see [REVERSE_ENGINEERING.md](REVERSE_ENGINEERING.md)), which is not available.
Both candidates read an image, so ink is first drawn to an image with the app's own pen.

| | TrOCR-small-handwritten | SimpleHTR (Xournal++ HTR) |
|---|---|---|
| Source | [Xenova/trocr-small-handwritten](https://huggingface.co/Xenova/trocr-small-handwritten) (ONNX of Microsoft's model) | [PellelNitram/xournalpp-htr-simple-htr](https://huggingface.co/PellelNitram/xournalpp-htr-simple-htr) |
| Licence | MIT | MIT |
| Kind | Transformer encoder–decoder | 5 CNN layers + 2 BiLSTM + CTC |
| Reads | A whole line | One word (needs words split out first) |
| Download | ~63 MB quantised (encoder 23 MB, decoder 40 MB) + runtime | 13 MB + runtime |
| Trained on | IAM (scanned handwriting) | IAM (scanned handwriting) |
| Runtime | Transformers.js 4.3.2 (ONNX Runtime Web inside) | ONNX Runtime Web 1.31.1 |

They were picked to be as different as possible: a large, accurate-on-paper line model against a small word model
that depends on splitting words, which task 10.1 builds anyway. Other options looked at and set aside: Felix92/onnxtr
(printed text, 247 MB), naeyn/de-htr-web (German), and models without a clear licence or with a non-commercial one.

## Method

- **Test set:** 50 short lines of the kind people write in notes ([spike/hwr/prompts.ts](../spike/hwr/prompts.ts)):
  prose, names and capitals, numbers, times, abbreviations and punctuation. Only characters both models can output.
  The person writes each one with the Apple Pencil in the spike page, on one line, at their usual size. The task
  plan said "50 sample pages"; 50 written lines are used instead, since recognition runs a line at a time.
- **Ink to image:** the app's default pen (black fountain pen, width 3, 30% steadying), cropped to the ink plus a
  margin, 1 px per page unit. SimpleHTR's words are found by horizontal gaps between strokes
  ([spike/hwr/segment.ts](../spike/hwr/segment.ts)), each scaled into 128×32 as its authors do.
- **Accuracy:** character and word error rate over the whole set ([spike/hwr/metrics.ts](../spike/hwr/metrics.ts)),
  measured two ways. *Exact* compares the text as written. *Search* ignores case and punctuation, which is what
  handwriting search needs. Also the number of lines read perfectly (search).
- **Speed:** each model runs in its own Web Worker, as it would in the app, one model at a time. Recorded: cold load
  (download + start), the first line, then median and 95th percentile per line after it. Times are end to end, from
  drawing the image to having text.
- **Threads:** ONNX Runtime only uses several threads when the page is cross-origin isolated (COOP/COEP headers).
  The dev server and plain static hosting are not, so the numbers are single-threaded, which is what the app would
  get unless hosting adds those headers.

## Running it

1. On the Mac: `npm run spike`. This serves over HTTPS with a self-signed certificate and cross-origin isolation:
   Safari only offers WebGPU to secure pages, and ONNX Runtime only uses several threads on isolated ones. (Plain
   `npm run dev` works too, but then only single-threaded WASM can be measured.)
2. On the iPad, open `https://<mac's address>:5173/spike/hwr/` in Safari and accept the certificate warning
   (Show Details → visit this website).
3. **Write:** write each of the 50 lines. They are kept in that page's browser storage. **Send samples to Mac** saves
   them to `spike/hwr/data/samples.json` (git-ignored); **Load samples from Mac** brings them into another address,
   for example from the `http://` page to the `https://` one.
4. **Run:** leave every model ticked and choose **Run models**. The first run downloads about 80 MB; later runs come
   from the browser cache. Then **Send results to Mac** and **Copy summary**.

"Font check" runs typed text in a handwriting font through both models. It only proves the pipeline works; its
accuracy says nothing about real handwriting.

## Go / no-go criteria

Set before the results, so they can't be fitted to them.

- **Go** with a model if, on the iPad, in search terms: word error rate ≤ 20% (most words findable), and a line is
  read in ≤ 1 s at the median and ≤ 2 s at p95 (recognition runs in the background after writing pauses, so this is
  about catching up, not typing speed), and the download is ≤ 100 MB (cached once, offline after).
- **Partial go** if search WER is 20–35%: ship handwriting search only (it tolerates errors, especially with fuzzy
  matching), not convert-to-text or spellcheck.
- **No-go** otherwise: ship segmentation-based Smart Ink (10.1–10.2) and drop recognition, as the plan's risk table says.

## Results

### Desktop pipeline check (Font check, headless Chromium on a Mac)

Typed text in a handwriting-style font, 2026-11-18. This shows the pipeline works end to end and gives a feel for
speed on a laptop; it is **not** a measure of handwriting accuracy. Load is with an empty cache (download included).

| Model | Backend | Load (cold) | First line | Line median / p95 | CER / WER (exact) | CER / WER (search) | Lines right (search) |
|---|---|---|---|---|---|---|---|
| TrOCR-small-handwritten (q8) | wasm, 1 thread | 41.7 s | 689 ms | 662 ms / 673 ms | 5.0% / 25.2% | 1.7% / 7.4% | 39/50 |
| SimpleHTR + gap word split | wasm, 1 thread | 10.8 s | 58 ms | 31 ms / 45 ms | 18.9% / 51.8% | 16.4% / 47.0% | 3/50 |

Early signs: TrOCR reads printed-looking text well, and its "exact" errors are mostly added full stops and
capitalisation. SimpleHTR is about 20× faster and 5× smaller, but misreads many words even in a clean font, so its
handwriting accuracy will need to be much better than this to pass. The iPad will be several times slower than the
Mac, which matters most for TrOCR.

### iPad, handwritten lines

**First run, 2026-11-19** (iPad, Safari 26.5, 8 cores, plain HTTP so single-threaded and no WebGPU):

| Model | Backend | Load (cold) | First line | Line median / p95 | CER / WER (exact) | CER / WER (search) | Lines right (search) |
|---|---|---|---|---|---|---|---|
| TrOCR-small-handwritten (q8) | — | — | — | — | — | — | not run: WebGPU was chosen, which Safari doesn't offer over HTTP |
| SimpleHTR + gap word split | wasm, 1 thread | 33.8 s | 89 ms | 54 ms / 81 ms | 15.9% / 71.2% | 11.6% / 49.3% | 6/50 |

Word split matched the word count on only 10/50 lines, so most of SimpleHTR's word errors were splitting, not reading.

**Second run, 2026-11-19** (same iPad and lines, HTTPS with cross-origin isolation, so 4 threads and WebGPU):

| Model | Backend | Load | First line | Line median / p95 | CER / WER (exact) | CER / WER (search) | Lines right (search) |
|---|---|---|---|---|---|---|---|
| TrOCR-small-handwritten (q8) | wasm, 4 threads | 296 s (first download) | 602 ms | **363 ms / 458 ms** | 3.0% / 16.7% | **1.4% / 6.5%** | 38/50 |
| TrOCR-small-handwritten (q8) | webgpu | 1.7 s (cached) | 3501 ms | 1279 ms / 2602 ms | 3.1% / 15.3% | 1.3% / 4.1% | 43/50 |
| SimpleHTR, first word split | wasm, 4 threads | 57 s | 82 ms | 22 ms / 46 ms | 14.0% / 66.2% | 11.2% / 45.2% | 9/50 |

TrOCR's misreads are small: "jump" for "jumps", "Bpm" for "3pm", "over" for "oven", "hairs" for "hours", a space
lost in "buymilk", "41:30" for "4:30". The 296 s first load was the download (about 0.25 MB/s on that network);
starting from the browser cache took under 2 s.

**Word split tuned on these lines, SimpleHTR re-scored** (desktop Chromium; same model and input, so the same accuracy
as the iPad would give):

| Model | Line median / p95 (Mac) | CER / WER (exact) | CER / WER (search) | Lines right (search) | Word count right |
|---|---|---|---|---|---|
| SimpleHTR, tuned split | 32 ms / 45 ms | 7.3% / 29.3% | 5.2% / 18.4% | 19/50 | 43/50 |

The split now cuts at gaps over one letter height (it was 0.55) and joins small marks such as commas to the word
before them. Results were flat between 0.8 and 1.2 letter heights, so this is not fitted to these 50 lines. The 7
lines still wrong have a `/`, `-` or `?` written with space around it, which is ambiguous even to a person.

**Third run, 2026-11-19:** TrOCR forced to one thread on the same isolated page, from the browser cache:

| Model | Backend | Load (cached) | First line | Line median / p95 | CER / WER (exact) | CER / WER (search) | Lines right (search) |
|---|---|---|---|---|---|---|---|
| TrOCR-small-handwritten (q8) | wasm, 1 thread | 1.1 s | 1391 ms | **733 ms / 784 ms** | 3.0% / 16.7% | 1.4% / 6.5% | 38/50 |

Same readings as with four threads; each line takes twice as long, still inside the bar.

### Download size

Measured in the browser, compressed, first load:

| | Model files | Runtime (WASM) | Total |
|---|---|---|---|
| TrOCR-small (q8) | 64.8 MB (encoder 23.1, decoder 40.6, tokenizer and config 1.1) | 5.6 MB | ≈ 70 MB |
| SimpleHTR | 13.0 MB | 4.8 MB | ≈ 18 MB |

### Harness problems found and fixed

- A palm touch could take the stroke before the Pencil; a Pencil drag could select the page's text.
- WebGPU was offered where Safari can't use it (it needs HTTPS).
- A model download sometimes stalls with no error (seen 3 times on the Mac, from the Hugging Face and jsDelivr CDNs);
  the page now gives up and says so after 15 minutes for a load and 60 s for a line.

## Decision

**Go: TrOCR-small-handwritten (q8) on WASM, in a worker.** On the iPad it clears every bar: 6.5% search word error
rate (bar 20%); per line 733 ms median and 784 ms p95 on one thread, or 363 ms and 458 ms on four (bars 1 s and 2 s);
about 70 MB to download (bar 100 MB). Exact word error rate is 16.7%, mostly capitals and punctuation, which is good enough
for convert-to-text with the result shown for checking before it replaces the ink.

- **Not WebGPU.** It was slightly more accurate but 3.5× slower per line in Safari (the decoder runs one token at a
  time, and each step pays GPU overhead). Re-check when Safari or Transformers.js change.
- **Not SimpleHTR as the main model.** With the tuned split it passes the search bar (18.4%) at a quarter of the
  download and a twentieth of the time per line, but it reads only 19/50 lines right against TrOCR's 38, and its
  29% exact word error rate rules out convert-to-text and spellcheck. It stays the fallback if TrOCR's download or
  memory proves too much on older iPads.

**Conditions this rests on, for tasks 10.3 and 12.1:**

1. **Cross-origin isolation is optional.** Serving the page with `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp` lets ONNX Runtime use four threads and halves the time per line, but
   one thread already passes. Recognition should use threads when `crossOriginIsolated` is true and work without.
2. **If isolation is wanted, plan around Google sign-in.** `same-origin` COOP cuts the link between the page and a
   sign-in popup, which Google Identity Services' popup flow relies on in Safari. Phase 12 should either skip the
   headers (and take the single-thread speed) or sign in on a page served without them, or use the redirect flow.
   Cloudflare Pages can set the headers (a `_headers` file); GitHub Pages can't.
3. **Where the model comes from.** Cloudflare Pages limits files to 25 MiB, and the decoder is 40.6 MB, so the model
   can't ship as part of the site as it stands. Options: load it from Hugging Face's CDN (free, but a third party and
   it stalled occasionally here), split the file, or a free-tier object store (Cloudflare R2).
   **Decided in 10.3:** the model comes from Hugging Face and ONNX Runtime's WASM from jsDelivr, the first time
   recognition is turned on; Transformers.js keeps both in Cache Storage, so it works offline after. The build
   leaves out ONNX Runtime's bundled 27 MB WASM (never loaded, and over the 25 MiB limit), so the site stays
   small and every file fits. A load that makes no progress for 3 minutes is reported, with Try again in
   Settings. Hosting the files ourselves (R2) remains the fix if the CDNs prove unreliable.
4. **First download.** 70 MB took 5 minutes on the test network. Recognition must be opt-in or start in the
   background with visible progress, cache the model (the browser cache already worked here), and never block writing.
5. **Lines, not pages.** These numbers are for one line at a time. Task 10.3 needs line segmentation (10.1) first, and
   recognition should run on lines as they settle, so a full page never waits on 30 lines at once.
