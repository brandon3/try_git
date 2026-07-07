# Seasonal & Cyclical Dashboard

A single-file dashboard (`index.html`) for multi-month positioning signals, built
around two slow clocks:

- **VIX mean-reversion zones** — the classic cheat-sheet bands: **buy 35+**
  (buy aggressively: high-beta tech, growth, small caps), **scale in 25–35**,
  **hold 15–25**, **sell below 15** (rotate to utilities, healthcare, staples, bonds).
- **The Bitcoin 4-year halving cycle** — days since the last halving mapped to the
  historical rhythm (prior cycle tops at days 371/526/549 after halving; bottoms
  at days 778/891/925), with every cycle overlaid and indexed to 100 at its halving.

Plus live-computed **seasonality**: average VIX by calendar month and Bitcoin's
median monthly return by calendar month, with the current month highlighted.
A **positioning playbook** matrix crosses the current VIX zone with the current
cycle phase and highlights where both signals sit today.

## Usage

Open `index.html` in a browser — no build, no server, no API keys. The page
fetches everything at load time:

| Data | Source | Fallbacks |
|---|---|---|
| VIX daily history (1990–present) | CBOE (`cdn.cboe.com`) | — |
| VIX intraday (delayed) | CBOE delayed quotes | last daily close |
| BTC daily history (2010–present) | CryptoCompare | Coinbase Exchange, CoinGecko (365d, degraded) |
| BTC spot + 24h change | CoinGecko | CryptoCompare |

If a source is unreachable the affected section shows an error state — nothing is
ever fabricated. Append `?demo=1` to preview the layout with clearly-labeled
synthetic data (works offline).

## Alerts

Alerts fire on **transitions only** (VIX zone change, VIX/VIX3M term-structure
flip, BTC cycle-phase boundary) — never on levels, so a daily/weekly check
cadence doesn't get spammed.

- **Dashboard**: the Alerts panel flags anything that changed since your last
  visit (state is kept in localStorage) and can fire browser notifications once
  you enable them.
- **Email**: `.github/workflows/daily-signals.yml` runs `scripts/daily.mjs`
  every weekday after the US close. On any transition it opens a GitHub issue —
  GitHub emails you if you **watch the repo**. Every Monday it opens a digest
  issue regardless. For direct email, set `MAIL_USERNAME`, `MAIL_PASSWORD`
  (e.g. a Gmail app password) and `MAIL_TO` repo secrets.
- Scheduled workflows only run from the **default branch** — merge this branch
  to activate; use *Run workflow* to test manually.

## Stock scanner

The same daily job fetches prices for a curated 64-name universe (Stooq, free,
no key) bucketed to match the four VIX zones, ranks each bucket by price-based
factors — relative strength vs SPY over 3/6 months (60%), trend vs the 200-day
average (25%), distance from the 52-week high (15%) — and commits the results
to `data/scanner.{json,js}`. The dashboard reads that file and opens the bucket
matching the current VIX zone, plus a "washed-out rebound candidates" list when
the VIX is elevated. Run `node scripts/daily.mjs` locally to generate data
without waiting for the Action (`--demo` for synthetic output).

To change the universe, edit `UNIVERSE` in `scripts/daily.mjs`.

## Notes

Zone thresholds follow the AskLivermore VIX cheat sheet. Cycle-phase windows are
derived from the 2012/2016/2020 cycles. Halving dates are hardcoded facts; the
next halving (~April 2028) is an estimate. This is a study tool, not financial
advice.
