#!/usr/bin/env node
/**
 * Daily signals + stock scanner generator.
 *
 * Fetches VIX + VIX3M (CBOE), BTC (CryptoCompare), and daily prices for a
 * curated ~65-name equity universe (Stooq), then:
 *   - evaluates alert TRANSITIONS (VIX zone change, term-structure flip,
 *     BTC cycle-phase change) against the previously committed signals
 *   - ranks each bucket of the universe by price-based factors
 *   - writes data/signals.{json,js}, data/scanner.{json,js}, data/digest.md
 *
 * Zero dependencies (Node 18+). Run `node scripts/daily.mjs`.
 * `--demo` writes deterministic synthetic output instead of fetching
 * (for testing the pipeline and the dashboard offline).
 *
 * Keep the constants below in sync with index.html.
 */
import { writeFile, readFile, mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = process.argv.includes("--demo");
const DAY = 86400000;

/* ---------------- shared constants (mirror index.html) ---------------- */
const LAST_HALVING = "2024-04-20";
const PHASES = [
  { key: "ramp",  name: "Post-halving ramp",  from: 0,    to: 210 },
  { key: "bull",  name: "Bull window",        from: 210,  to: 550 },
  { key: "bear",  name: "Bear window",        from: 550,  to: 950 },
  { key: "accum", name: "Accumulation",       from: 950,  to: 1250 },
  { key: "runup", name: "Pre-halving run-up", from: 1250, to: 1600 },
];
const ZONE_NAMES = { buy: "BUY", scale: "SCALE IN", hold: "HOLD", sell: "SELL" };
const zoneOf = (v) => (v >= 35 ? "buy" : v >= 25 ? "scale" : v >= 15 ? "hold" : "sell");
const phaseOf = (d) => PHASES.find((p) => d >= p.from && d < p.to) || PHASES[PHASES.length - 1];
const PLAYBOOK = {
  buy:   ["Add equities & BTC hard", "Add equities; trim BTC into strength", "Back up the truck — both assets", "Max accumulation, both", "Add both aggressively"],
  scale: ["Scale into both", "Scale equities; hold BTC", "Scale into both in tranches", "Scale in, DCA BTC weekly", "Scale into both"],
  hold:  ["Hold; let winners run", "Hold equities; take partial BTC profit", "Hold equities; DCA BTC", "Hold; keep DCA-ing BTC", "Hold; overweight BTC"],
  sell:  ["Trim equities; hold BTC", "Trim both — froth in both clocks", "Trim equities; DCA BTC slowly", "Rotate equity trims into BTC", "Trim equities; hold BTC"],
};

/* ---------------- scanner universe (curated, bucketed by VIX zone) ---------------- */
const UNIVERSE = {
  buy: [ // high-beta tech, growth, small caps — what you buy into panic
    ["NVDA","Nvidia"],["AMD","AMD"],["TSLA","Tesla"],["PLTR","Palantir"],
    ["COIN","Coinbase"],["MSTR","Strategy"],["SHOP","Shopify"],["NET","Cloudflare"],
    ["DDOG","Datadog"],["CRWD","CrowdStrike"],["SNOW","Snowflake"],["RBLX","Roblox"],
    ["SOFI","SoFi"],["DKNG","DraftKings"],["IWM","Russell 2000 ETF"],["ARKK","ARK Innovation ETF"],
  ],
  scale: [ // quality tech, financials, cyclicals — what you scale into elevated fear
    ["MSFT","Microsoft"],["AAPL","Apple"],["GOOGL","Alphabet"],["AMZN","Amazon"],
    ["META","Meta"],["AVGO","Broadcom"],["ORCL","Oracle"],["JPM","JPMorgan"],
    ["GS","Goldman Sachs"],["MS","Morgan Stanley"],["V","Visa"],["MA","Mastercard"],
    ["CAT","Caterpillar"],["DE","Deere"],["HON","Honeywell"],["UNP","Union Pacific"],
  ],
  hold: [ // tech + defensives, dividend growers — the stay-positioned core
    ["COST","Costco"],["WMT","Walmart"],["HD","Home Depot"],["MCD","McDonald's"],
    ["JNJ","Johnson & Johnson"],["ABBV","AbbVie"],["LLY","Eli Lilly"],["UNH","UnitedHealth"],
    ["PG","Procter & Gamble"],["KO","Coca-Cola"],["PEP","PepsiCo"],["TXN","Texas Instruments"],
    ["ADP","ADP"],["LOW","Lowe's"],["SCHD","Schwab US Dividend ETF"],["BRK-B","Berkshire Hathaway B"],
  ],
  sell: [ // utilities, healthcare, staples, bonds — where you rotate when VIX < 15
    ["XLU","Utilities SPDR"],["XLP","Staples SPDR"],["XLV","Health Care SPDR"],["TLT","20+Y Treasury ETF"],
    ["IEF","7-10Y Treasury ETF"],["GLD","Gold ETF"],["USMV","Min-Vol ETF"],["NEE","NextEra"],
    ["DUK","Duke Energy"],["SO","Southern Co"],["ED","Consolidated Edison"],["MRK","Merck"],
    ["PFE","Pfizer"],["AMGN","Amgen"],["CL","Colgate"],["KMB","Kimberly-Clark"],
  ],
};
const BENCH = "SPY";

/* ---------------- fetch helpers ---------------- */
async function get(url, type = "text") {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (signals-dashboard)" } });
      if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
      return type === "json" ? r.json() : r.text();
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
    }
  }
}
function parseCboeCsv(csv) {
  // DATE,OPEN,HIGH,LOW,CLOSE
  const rows = csv.trim().split(/\r?\n/).slice(1);
  const out = [];
  for (const row of rows) {
    const p = row.split(",");
    if (p.length < 5) continue;
    let d = p[0];
    if (d.includes("/")) { const [m, dd, y] = d.split("/"); d = `${y}-${m.padStart(2, "0")}-${dd.padStart(2, "0")}`; }
    const c = parseFloat(p[4]);
    if (isFinite(c)) out.push({ d, c });
  }
  return out;
}
async function fetchStooq(sym) {
  const csv = await get(`https://stooq.com/q/d/l/?s=${sym.toLowerCase()}.us&i=d`);
  const rows = csv.trim().split(/\r?\n/).slice(1); // Date,Open,High,Low,Close,Volume
  const out = [];
  for (const row of rows) {
    const p = row.split(",");
    const c = parseFloat(p[4]);
    if (p.length >= 5 && isFinite(c) && c > 0) out.push(c);
  }
  return out.slice(-320); // ~15 months of trading days
}

/* ---------------- scanner metrics ---------------- */
function metrics(closes, bench) {
  const n = closes.length;
  if (n < 260) return null;
  const last = closes[n - 1];
  const ret = (d) => (n > d ? last / closes[n - 1 - d] - 1 : null);
  const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
  const hi252 = Math.max(...closes.slice(-252));
  const bRet = (d) => bench[bench.length - 1] / bench[bench.length - 1 - d] - 1;
  const pc = (v) => Math.round(v * 1000) / 10; // fraction -> % 1dp
  return {
    rs3m: pc(ret(63) - bRet(63)),
    rs6m: pc(ret(126) - bRet(126)),
    ret12m: pc(ret(252)),
    trend: pc(last / sma200 - 1),
    offHigh: pc(last / hi252 - 1),
  };
}
function scoreBucket(entries) {
  // percentile-rank each factor within the bucket, composite 0-100
  const rank = (key, invertAbs) => {
    const vals = entries.map((e) => e[key]).sort((a, b) => a - b);
    return (v) => vals.filter((x) => x <= v).length / vals.length;
  };
  const r3 = rank("rs3m"), r6 = rank("rs6m"), rt = rank("trend"), rh = rank("offHigh");
  for (const e of entries)
    e.score = Math.round(100 * (0.25 * r3(e.rs3m) + 0.35 * r6(e.rs6m) + 0.25 * rt(e.trend) + 0.15 * rh(e.offHigh)));
  entries.sort((a, b) => b.score - a.score);
}

/* ---------------- demo generator ---------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- main ---------------- */
async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const daysSinceHalving = Math.round((Date.parse(today) - Date.parse(LAST_HALVING)) / DAY);
  const phase = phaseOf(daysSinceHalving);

  let vix, vixDate, vix3m, btcClose, btcDate, buckets, skipped = [];

  if (DEMO) {
    const rnd = mulberry32(7);
    vix = 16.4; vixDate = today; vix3m = 18.6;
    btcClose = 64200; btcDate = today;
    buckets = {};
    for (const key of Object.keys(UNIVERSE)) {
      buckets[key] = UNIVERSE[key].map(([sym, name]) => ({
        sym, name,
        rs3m: Math.round((rnd() * 30 - 12) * 10) / 10,
        rs6m: Math.round((rnd() * 50 - 20) * 10) / 10,
        ret12m: Math.round((rnd() * 90 - 25) * 10) / 10,
        trend: Math.round((rnd() * 40 - 15) * 10) / 10,
        offHigh: -Math.round(rnd() * 45 * 10) / 10,
      }));
      scoreBucket(buckets[key]);
    }
  } else {
    // volatility complex
    const vixHist = parseCboeCsv(await get("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv"));
    const vix3mHist = parseCboeCsv(await get("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv"));
    const vLast = vixHist[vixHist.length - 1];
    vix = vLast.c; vixDate = vLast.d;
    vix3m = vix3mHist[vix3mHist.length - 1].c;

    // btc
    const btc = await get("https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=3", "json");
    const bLast = btc.Data.Data.filter((r) => r.close > 0).pop();
    btcClose = bLast.close; btcDate = new Date(bLast.time * 1000).toISOString().slice(0, 10);

    // scanner universe
    const bench = await fetchStooq(BENCH);
    if (bench.length < 260) throw new Error("Benchmark history too short");
    buckets = {};
    for (const key of Object.keys(UNIVERSE)) {
      buckets[key] = [];
      for (const [sym, name] of UNIVERSE[key]) {
        try {
          const m = metrics(await fetchStooq(sym), bench);
          if (m) buckets[key].push({ sym, name, ...m });
          else skipped.push(sym);
        } catch (e) { skipped.push(sym); }
        await new Promise((s) => setTimeout(s, 250)); // be polite to stooq
      }
      scoreBucket(buckets[key]);
    }
  }

  const zone = zoneOf(vix);
  const term = vix / vix3m >= 1 ? "backwardation" : vix / vix3m >= 0.95 ? "flat" : "contango";
  const stance = PLAYBOOK[zone][PHASES.findIndex((p) => p.key === phase.key)];

  /* transitions vs the previously committed signals */
  let prev = null;
  try { prev = JSON.parse(await readFile(join(ROOT, "data", "signals.json"), "utf8")); } catch {}
  const alerts = [];
  if (prev) {
    if (prev.vix?.zone && prev.vix.zone !== zone)
      alerts.push(`VIX zone changed: ${ZONE_NAMES[prev.vix.zone]} → ${ZONE_NAMES[zone]} (VIX ${vix.toFixed(1)})`);
    if (prev.termStructure && prev.termStructure !== term && (term === "backwardation" || prev.termStructure === "backwardation"))
      alerts.push(`VIX term structure flipped to ${term} (VIX/VIX3M ${(vix / vix3m).toFixed(2)})`);
    if (prev.cycle?.phase && prev.cycle.phase !== phase.key)
      alerts.push(`BTC cycle entered ${phase.name} (day ${daysSinceHalving} since halving)`);
  }

  const signals = {
    asOf: today, demo: DEMO || undefined,
    vix: { close: vix, date: vixDate, zone },
    vix3m, termStructure: term, ratio: Math.round((vix / vix3m) * 100) / 100,
    btc: { close: btcClose, date: btcDate },
    cycle: { daysSinceHalving, phase: phase.key, phaseName: phase.name },
    stance, alerts,
  };
  const scanner = {
    asOf: today, demo: DEMO || undefined, benchmark: BENCH, buckets,
    notes: skipped.length ? "Skipped (no/short data): " + skipped.join(", ") : "",
  };

  /* digest */
  const top = (key, n = 5) => (buckets[key] || []).slice(0, n)
    .map((e, i) => `${i + 1}. **${e.sym}** ${e.name} — score ${e.score} (RS6m ${e.rs6m > 0 ? "+" : ""}${e.rs6m}%, vs 200d ${e.trend > 0 ? "+" : ""}${e.trend}%, ${e.offHigh}% off 52w high)`).join("\n");
  const digest = `# Signal digest — ${today}${DEMO ? " (DEMO DATA)" : ""}

**VIX** ${vix.toFixed(1)} (${vixDate}) → **${ZONE_NAMES[zone]}** zone · term structure **${term}** (VIX/VIX3M ${(vix / vix3m).toFixed(2)})
**BTC** $${Math.round(btcClose).toLocaleString("en-US")} (${btcDate}) · day **${daysSinceHalving}** since halving → **${phase.name}**
**Combined stance:** ${stance}

## Alerts
${alerts.length ? alerts.map((a) => "- 🚨 " + a).join("\n") : "- No transitions."}

## Scanner — top of the current bucket (${ZONE_NAMES[zone]})
${top(zone)}

## Scanner — high-beta bucket (what you'd buy into a VIX spike)
${top("buy")}

---
_Generated by scripts/daily.mjs · price-based factors only (RS vs SPY, trend vs 200-day, distance from 52-week high) · not financial advice._
`;

  await mkdir(join(ROOT, "data"), { recursive: true });
  await writeFile(join(ROOT, "data", "signals.json"), JSON.stringify(signals, null, 2));
  await writeFile(join(ROOT, "data", "signals.js"), "window.SIGNALS_DATA = " + JSON.stringify(signals) + ";\n");
  await writeFile(join(ROOT, "data", "scanner.json"), JSON.stringify(scanner, null, 2));
  await writeFile(join(ROOT, "data", "scanner.js"), "window.SCANNER_DATA = " + JSON.stringify(scanner) + ";\n");
  await writeFile(join(ROOT, "data", "digest.md"), digest);

  if (process.env.GITHUB_OUTPUT) {
    const title = alerts.length
      ? "🚨 " + alerts[0] + (alerts.length > 1 ? ` (+${alerts.length - 1} more)` : "")
      : "";
    await appendFile(process.env.GITHUB_OUTPUT,
      `alert=${alerts.length ? "true" : "false"}\ntitle=${title.replace(/\n/g, " ")}\n`);
  }
  console.log(`ok: VIX ${vix} (${zone}, ${term}) · BTC day ${daysSinceHalving} (${phase.key}) · ` +
    `scanner ${Object.values(buckets).reduce((a, b) => a + b.length, 0)} names` +
    (skipped.length ? ` · skipped: ${skipped.join(",")}` : "") +
    (alerts.length ? `\nALERTS:\n- ${alerts.join("\n- ")}` : ""));
}

main().catch((e) => { console.error(e); process.exit(1); });
