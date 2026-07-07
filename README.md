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

## Notes

Zone thresholds follow the AskLivermore VIX cheat sheet. Cycle-phase windows are
derived from the 2012/2016/2020 cycles. Halving dates are hardcoded facts; the
next halving (~April 2028) is an estimate. This is a study tool, not financial
advice.
