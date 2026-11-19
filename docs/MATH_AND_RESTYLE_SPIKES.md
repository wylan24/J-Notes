# Math Assist and Restyle spikes (task 10.5)

Two research spikes, run after handwriting recognition shipped (tasks 10.0–10.4). Each asks whether a
Goodnotes feature can be built on the device, for free, with what the app has, and ends in a go or no-go.
The plan treats both as research, not commitments (risk table, FEATURE_PARITY_PLAN.md).

Status, 2026-11-19: **Restyle: no-go** (tidying makes writing harder to read). **Math Assist: not decided yet**:
TrOCR is ruled out for maths, and Pix2Text's handwriting run waits on 30 lines of maths written on the iPad.
Criteria were set before any results.

## What Goodnotes does

From Goodnotes' own pages (read 2026-11-19):

- **Restyle** (added July–September 2026): "Lasso a section, tap the Smart Ink icon, choose Restyle, and pick a
  style." The result is "a cleaner, more readable style", and "the words, layout, and color all stay exactly as
  they were". The page doesn't say whether the result is the writer's own strokes tidied or new, generated
  handwriting, nor whether it runs on the device. Free on Apple devices; eight languages.
  ([What's new, Jul–Sep 2026](https://www.goodnotes.com/blog/whats-new-in-goodnotes-july-september-2026))
- **Math Assist**: off by default (Pen → Math Assist → Suggestions). "Write a maths equation with an equals sign.
  Once recognized as a maths equation, the equation will glow blue. Tap on the blue glow to open the Math Assist
  menu, from here you can choose a solving strategy and the answer will appear in handwriting." A misread can be
  corrected by editing its LaTeX. It covers arithmetic, percentages, solving equations up to quartics, systems,
  expanding and factorising, trigonometry, limits, derivatives, integrals and more; not differential equations,
  geometry or inequalities. Misreads can make a line "improperly underlined as incorrect". English notebooks only.
  ([How to use Math Assist](https://support.goodnotes.com/hc/en-us/articles/10779567357199),
  [Why isn't my math being recognized](https://support.goodnotes.com/hc/en-us/articles/10779297639567),
  [Design at Goodnotes: AI Math Assistance](https://www.goodnotes.com/blog/how-its-made-ai-math-assistance), which
  says it "runs locally on your device")

## Restyle

**Question.** Can the app tidy handwriting, keeping the words, layout and colour and the writer's own strokes,
without a model?

**What was tried** ([spike/hwr/restyle.ts](../spike/hwr/restyle.ts)). Lines and words are found once by
segmentation (task 10.1), then each line is:

1. **Levelled**: a straight line through the words' baselines is turned level, and each word settles onto it (by
   at most a third of a letter height, so a misjudged baseline can't throw a word off the line).
2. **Stood upright**: sheared about the baseline by the writing's slant, measured on its near-vertical strokes.
3. **Evened in size**: each word scaled towards the line's letter height, by at most a quarter either way.
4. **Evenly spaced**: words re-laid from the line's start with its median gap.
5. **Smoothed**: points steadied a little (the same steadying the pens use), before the steps above.

Generated handwriting in a new style (Goodnotes' "pick a style", if that is what it does) was not tried; see
the decision.

**Measures** (lower is tidier), on the spike's 50 handwritten lines, before and after, on the same words:
bounce (spread of word baselines about a straight line, in letter heights), slant (degrees from upright), word
size spread and word gap spread (each as a fraction of its median). Legibility: TrOCR's reading of every line
before and after, as in task 10.0. Looks: the before-and-after sheet on the spike page's Restyle tab.

**Go if**, set before the results:

- every neatness measure improves by at least 30%;
- TrOCR's search word error rate on the restyled lines is no more than 1 point worse than on the lines as
  written (tidying must not make writing harder to read);
- the writer, looking at the sheet, finds the restyled lines tidier and still their own writing;
- a line restyles in under 50 ms on the Mac (no model, so it should be far quicker).

## Math Assist

**Question.** Can the app read a line of handwritten maths on the device well enough to answer it, check it, or
solve it?

**Pieces.**

- **Reading.** Two candidates, both MIT-licensed and run in a worker:
  - TrOCR-small-handwritten, already in the app. Trained on prose (IAM), so it has digits, `+ - = / ( )` but no
    `×`, `÷`, `√`, superscripts or stacked fractions.
  - [Pix2Text MFR](https://huggingface.co/breezedeus/pix2text-mfr) (breezedeus, MIT): the same encoder–decoder
    shape as TrOCR, trained to read printed and handwritten formulas to LaTeX. 118 MB (fp32 encoder 87.5 MB,
    decoder 30.1 MB). It is published without the merged decoder Transformers.js needs, so the spike runs its
    two ONNX files with ONNX Runtime directly, decoding greedily.
- **Understanding** ([spike/hwr/maths.ts](../spike/hwr/maths.ts)). Readings are normalised to one ASCII form
  (LaTeX `\frac`, `\sqrt`, `\times`; plain-text `x` as times between numbers), parsed, and analysed: an unfinished
  sum (`17 × 23 =`) gets its answer, a finished one (`9 × 6 = 56`) is checked, and an equation in one variable up
  to a quadratic is solved, by fitting the difference of the two sides as a polynomial. No algebra library.
- **Test set.** 30 lines a student might write ([MATH_PROMPTS](../spike/hwr/maths.ts)): arithmetic, decimals,
  percentages, powers, a square root, brackets, two wrong answers, four unfinished sums, seven equations (two
  quadratic) and three with stacked fractions. Written with the Pencil on the spike page (Write → Maths).

**Measures**, per model: lines read exactly (same structure as the truth, whatever brackets or times signs) and
lines with the **same verdict** (the same answer, the same right-or-wrong, the same solutions), which is what a
person sees. Time per line and download, as in task 10.0.

**Go if**, set before the results, on the iPad with handwritten lines, for the better model:

- same verdict on at least 80% of lines (24/30);
- a line read in at most 1.5 s at the median;
- at most 150 MB to download in total for maths.

**Partial go** at 60–80% (18–23/30): show the reading for the person to confirm or correct before answering, and
never mark a line wrong unprompted. **No-go** below 60%.

The desktop Font check (typed maths in a handwriting font) only proves the pipeline; it says nothing about
handwriting.

## Results

All on the Mac in headless Chromium (desktop, one thread, no cross-origin isolation). A model reads the same
image the same way on any device, so the accuracy figures carry over to the iPad; the times don't.

### Restyle, on the spike's 50 handwritten lines

**Neatness**, before and after, measured on the same words:

| Measure (lower is tidier) | As written | Restyled | Change | Bar |
|---|---|---|---|---|
| Bounce (word baselines, letter heights) | 0.096 | 0.014 | −85% | ✅ ≥ 30% |
| Slant (degrees from upright) | 3.81 | 1.48 | −61% | ✅ |
| Word size spread | 0.193 | 0.084 | −57% | ✅ |
| Word gap spread | 0.155 | 0.000 | −100% | ✅ |

**Speed**: 0.1 ms per line at the median, 0.2 ms at worst. ✅ (bar 50 ms)

**Legibility**, TrOCR reading every line, as written and restyled:

| | CER / WER (exact) | CER / WER (search) | Lines right (search) |
|---|---|---|---|
| As written | 3.1% / 15.8% | 1.2% / **4.1%** | 43/50 |
| Restyled (all steps) | 5.1% / 21.6% | 2.2% / **8.3%** | 39/50 |

Search word error rate doubles, 4.2 points worse. ❌ (bar: at most 1 point worse.) New misreads include
"by milk Vegas and bread", "QB sales", "check the over at 6" and "x +/91/2" for "x + y is 12".

**Each step alone** (search word error rate; as written 4.1%):

| Level | Upright | Size | Spacing | Smoothing | Upright + smoothing |
|---|---|---|---|---|---|
| 9.2% | **4.1%** | 10.1% | 7.8% | 5.1% | 5.5% |

Only standing letters upright costs nothing. Levelling, evening sizes and evening gaps each make the writing
markedly harder to read, though each does what it set out to (the neatness table). Why isn't known: likely
suspects are that scaling a word changes its stroke width and letter shapes away from what the model learned,
and that one evened gap is tighter than a writer's widest, so words read as joined. A person may not be fooled
where the model is; the spike page's Restyle tab has the before-and-after sheet for that judgement, which has not
been made.

This writer's hand is already fairly neat (4° of slant, small bounce), so these lines show little of what tidying
could do for messy writing, and the most there is to lose.

### Math Assist font check (not handwriting)

Typed maths in a handwriting font, run through each model and scored on the 30 prompts:

| Model | Load (cold) | Line median / p95 | Read exactly | Same verdict |
|---|---|---|---|---|
| TrOCR-small-handwritten (q8) | 36 s | 650 / 670 ms | 0/30 | 0/30 |
| Pix2Text MFR (fp32) | 52 s | 857 / 1020 ms | 18/30 | 18/30 |

- **TrOCR can't read maths.** It reads "=" as "-" and "+" as "t" on every line ("12t7-19"), and has no way to
  write ×, ÷, √, powers or fractions. Ruled out.
- **Pix2Text reads the structure well**: powers, decimals, ×, ÷, brackets, equations with variables and inline
  fractions all came back right. Most misses were single symbols in this font: its 7 read as ≠ (four lines) and
  its 9 as g (three). Two misreads moved a superscript (`^{3(x+2)}`), and √ failed. Whether handwriting fares
  better or worse than this font is exactly what the iPad run must show.
- The understanding side (normalising, parsing, answering, checking, solving up to quadratics) handled all 30
  intended readings, and is unit-tested.
- One normaliser bug was found and fixed on these results ("25 % o f 80": Pix2Text spells "of" out), which
  raised Pix2Text from 17/30 to 18/30 on rescoring the same outputs.

### Harness problems

- Editing a file the spike page imports makes Vite reload the page, which silently wipes a run in progress. It cost
  two runs; don't edit spike files while a run is going.
- One maths run reset itself while Pix2Text loaded, with no edit and no reload logged. It didn't happen again
  with navigation and crash logging on, so the cause is unknown.
- A TrOCR download stalled once more (no CPU, no progress for 7 minutes), as seen three times in task 10.0.

## Decision

**Restyle: no-go** for tidying by geometry, by the criteria set beforehand: every neatness measure clears its bar
and it is instant, but the writing becomes harder to read (search word error rate 4.1% → 8.3%), which defeats
the point and would also hurt search and convert-to-text. Not building it.

- Generated handwriting in another style (what Goodnotes may do) was not tried: no openly licensed, browser-sized
  model for style-preserving handwriting synthesis was found, and building one is beyond a spike.
- Worth revisiting: **standing letters upright** was the one step that cost nothing (4.1% before and after) and it
  removes most of the slant. It could become a small Smart Ink action of its own, if a messier writer's samples show
  it helps and the writer likes how it looks.

**Math Assist: not decided.** The pipeline works end to end and TrOCR is ruled out. Pix2Text read 18/30 typed lines
in a handwriting font, at 0.86 s a line on the Mac, from a 118 MB download; those are in reach of the bars but say
nothing about handwriting. Next step: write the 30 maths lines with the Pencil on the iPad (spike page → Write →
Maths), run Run → Run maths models there, and decide against the criteria above:

1. `npm run spike` on the Mac, open `https://<mac>:5173/spike/hwr/` on the iPad.
2. Write → **Maths**, write each line as shown (the three fraction lines stacked), then **Send samples to Mac**.
3. Run → **Run maths models** (Font check off). The first run downloads Pix2Text (118 MB). **Send results to Mac**.

If it is a go, building it would need: a quantised Pix2Text (the fp32 model is 118 MB on top of TrOCR's 70 MB, so
quantising it is worth measuring; an unvetted community int8 conversion on Hugging Face is 41 MB), a way to tell a maths line from a
text line (an "=" and mostly digits and symbols), and the answer written beside the line.
