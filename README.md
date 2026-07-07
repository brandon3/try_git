# Acumen

A daily trainer for the six cognitive abilities that research actually finds trainable. No accounts, no tracking, no build step — open it and train. All progress lives in your browser's `localStorage`.

## The six pillars

| Domain | Drill | Method / evidence |
|---|---|---|
| Working memory | **Dual N-Back** | The most-studied WM intervention (Jaeggi et al., 2008); adaptive difficulty drives the gains |
| Fluid reasoning | **Matrices** | Raven-style relational rule-finding — what fluid-intelligence tests measure |
| Processing speed | **Cipher** | Digit-symbol coding; speed-of-processing training showed durable gains in the ACTIVE trial |
| Attention / inhibition | **Ink & Word** | The Stroop task — the canonical measure of selective attention and response inhibition |
| Spatial memory | **Constellation** | Corsi-style pattern span, run as an adaptive staircase |
| Verbal / crystallized | **Lexicon** | Vocabulary on a Leitner spaced-repetition schedule |

Each drill adapts its own difficulty to your performance, and a streak counter rewards the daily habit.

## Honest about the science

You will measurably improve at each drill's core task, and the vocabulary you learn is durable knowledge. What the research does **not** clearly support is far transfer — that training these tasks raises general IQ. Meta-analyses find near-transfer is solid and far-transfer is small at best, so Acumen tracks each ability directly instead of promising a single number. The strongest levers for cognition remain sleep, aerobic exercise, and learning hard new things; treat these ten minutes as the deliberate-practice layer on top.

## Running it

The app uses native ES modules, so it must be served over HTTP (opening `index.html` from `file://` won't load the modules). Any static server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

No dependencies, no bundler, no install step.

## How it's built

- **`index.html`** — shell markup, a flash-free theme bootstrap, and a scoped Content-Security-Policy.
- **`css/main.css`** — one design system: warm-paper light / deep-charcoal dark, one accent hue per domain, full theming.
- **`js/app.js`** — the view controller: dashboard → intro → play → results, one view mounted at a time, with per-view teardown.
- **`js/games/*.js`** — six self-contained modules sharing a `mount(stage, { level, finish })` contract that returns a cleanup function.
- **`js/store.js`** — persistence: adaptive levels, streaks, and the Leitner schedule, saved atomically to one `localStorage` document.
- **`js/ui.js`** — a tiny dependency-free DOM/SVG toolkit plus the sparkline and progress-ring charts.

## Privacy

Everything stays on your device. There is no backend and no analytics. The only outbound request is for the web fonts (loaded non-render-blocking, with `no-referrer`); it fails gracefully to a system-font stack when offline.
