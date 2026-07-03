"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Horizon = {
  id: number;
  category: "hobby" | "travel" | "people" | "local" | "learning";
  title: string;
  rationale: string;
  firstStep: string;
  dimension: string;
  effort: "small" | "medium" | "big";
  timing: string | null;
  engine: string;
};

const CAT: Record<Horizon["category"], { label: string; emoji: string }> = {
  hobby: { label: "Hobby", emoji: "🎨" },
  travel: { label: "Travel", emoji: "✈️" },
  people: { label: "People", emoji: "👥" },
  local: { label: "Nearby", emoji: "📍" },
  learning: { label: "Learn", emoji: "📚" },
};

const EFFORT: Record<Horizon["effort"], string> = {
  small: "this week",
  medium: "a weekend",
  big: "a trip",
};

export default function Horizons() {
  const [open, setOpen] = useState<Horizon[]>([]);
  const [saved, setSaved] = useState<Horizon[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/horizons");
    const data = await res.json();
    setOpen(data.open);
    setSaved(data.saved);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function scan() {
    setScanning(true);
    try {
      await fetch("/api/horizons", { method: "POST" });
      await load();
    } finally {
      setScanning(false);
    }
  }

  async function respond(id: number, verdict: "saved" | "dismissed" | "snoozed") {
    await fetch(`/api/horizons/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict }),
    });
    await load();
  }

  return (
    <>
      <nav className="bar">
        <div className="inner">
          <div className="brand">
            <span className="eye">◉</span> Argus
          </div>
          <div className="navactions">
            <Link className="linkbtn" href="/">
              ← Today
            </Link>
            <button className="cta" onClick={scan} disabled={scanning}>
              {scanning ? "Looking…" : "Scan the horizon"}
            </button>
          </div>
        </div>
      </nav>

      <main className="horizons">
        <h1 className="greeting">On the horizon.</h1>
        <p className="summary">
          Not what needs handling — what would be worth your time. Drawn from the
          quiet corners of your life and the open space on your calendar.
        </p>

        {loaded && open.length === 0 && (
          <div className="empty">
            <div className="symbol">🌅</div>
            <h3>The horizon&apos;s clear for now</h3>
            <p>Scan again after a week of living, and Argus will have more to go on.</p>
          </div>
        )}

        {open.map((h) => (
          <article className="horizon" key={h.id}>
            <div className="hcat">
              <span className="hglyph">{CAT[h.category].emoji}</span>
              <span className="hcatlabel">{CAT[h.category].label}</span>
              <span className="hchip">{EFFORT[h.effort]}</span>
              {h.timing && h.timing.toLowerCase() !== EFFORT[h.effort].toLowerCase() && (
                <span className="hchip subtle">{h.timing}</span>
              )}
            </div>
            <h2 className="htitle">{h.title}</h2>
            <p className="hrationale">{h.rationale}</p>
            <p className="hstep">
              <span className="hsteplabel">First step</span> {h.firstStep}
            </p>
            <div className="hactions">
              <button className="pill approve" onClick={() => respond(h.id, "saved")}>
                Save this
              </button>
              <button className="pill reject" onClick={() => respond(h.id, "dismissed")}>
                Not for me
              </button>
              <button className="linkbtn" onClick={() => respond(h.id, "snoozed")}>
                Later
              </button>
            </div>
          </article>
        ))}

        {saved.length > 0 && (
          <section>
            <h2 className="savedhead">Saved</h2>
            <div className="group">
              {saved.map((h) => (
                <div className="row" key={h.id}>
                  <div className="glyph handle">{CAT[h.category].emoji}</div>
                  <div className="body">
                    <div className="title">{h.title}</div>
                    <div className="meta">{h.firstStep}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
