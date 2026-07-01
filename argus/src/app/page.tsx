"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  decision: {
    id: number;
    verdict: "needs_you" | "handle" | "ignore";
    action: string;
    reason: string;
    confidence: string;
    engine: string;
    userResponse: string | null;
  };
  item: {
    id: number;
    kind: string;
    title: string;
    from: string | null;
    occursAt: number | null;
  };
};

const SECTIONS: { verdict: Row["decision"]["verdict"]; heading: string }[] = [
  { verdict: "needs_you", heading: "Needs you" },
  { verdict: "handle", heading: "Handled — awaiting your OK" },
  { verdict: "ignore", heading: "Ignored" },
];

const ACTION_LABEL: Record<string, string> = {
  none: "no action",
  archive: "archive",
  label: "label",
  draft_reply: "draft a reply",
  accept_event: "accept",
  decline_event: "decline",
  flag: "flag for you",
};

const GLYPH: Record<string, string> = { email: "✉️", event: "📅" };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [engine, setEngine] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/brief");
    const data = await res.json();
    setRows(data.rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runBrief() {
    setRunning(true);
    try {
      const res = await fetch("/api/brief", { method: "POST" });
      const data = await res.json();
      setEngine(data.triage.engine);
      await load();
    } finally {
      setRunning(false);
    }
  }

  async function respond(id: number, response: "approved" | "rejected") {
    await fetch(`/api/decisions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    });
    await load();
  }

  const needs = rows.filter((r) => r.decision.verdict === "needs_you").length;
  const pending = rows.filter(
    (r) => r.decision.verdict !== "needs_you" && !r.decision.userResponse,
  ).length;

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <nav className="bar">
        <div className="inner">
          <div className="brand">
            <span className="eye">◉</span> Argus
          </div>
          <button className="cta" onClick={runBrief} disabled={running}>
            {running ? "Watching…" : "Run brief"}
          </button>
        </div>
      </nav>

      <main>
        <h1 className="greeting">{greeting()}.</h1>
        <p className="summary">
          {today}
          {rows.length > 0 && (
            <>
              {" · "}
              <strong>{needs}</strong> need{needs === 1 ? "s" : ""} you
              {" · "}
              <strong>{pending}</strong> awaiting your OK
            </>
          )}
        </p>

        {rows.length === 0 && (
          <div className="empty">
            <div className="symbol">◉</div>
            <h3>Nothing on the watch list</h3>
            <p>Run a brief and Argus will triage your inbox and calendar.</p>
          </div>
        )}

        {SECTIONS.map(({ verdict, heading }) => {
          const group = rows.filter((r) => r.decision.verdict === verdict);
          if (group.length === 0) return null;
          return (
            <section key={verdict}>
              <h2>{heading}</h2>
              <div className="group">
                {group.map((r) => (
                  <div className="row" key={r.decision.id}>
                    <div className={`glyph ${verdict}`}>
                      {GLYPH[r.item.kind] ?? "•"}
                    </div>
                    <div className="body">
                      <div className="title">{r.item.title}</div>
                      {r.item.from && r.item.from !== "calendar" && (
                        <div className="meta">{r.item.from}</div>
                      )}
                      <div className="reason">
                        {r.decision.reason}
                        {r.decision.action !== "none" && (
                          <span className="proposes">
                            {" "}
                            — <strong>{ACTION_LABEL[r.decision.action]}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="controls">
                      {r.decision.userResponse ? (
                        <span className={`badge ${r.decision.userResponse}`}>
                          {r.decision.userResponse === "approved" ? "Done" : "Dismissed"}
                        </span>
                      ) : r.decision.action !== "none" ? (
                        <>
                          <button
                            className="pill approve"
                            onClick={() => respond(r.decision.id, "approved")}
                          >
                            Approve
                          </button>
                          <button
                            className="pill reject"
                            onClick={() => respond(r.decision.id, "rejected")}
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <span className="badge">Your call</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {engine && (
          <p className="enginenote">
            Last brief triaged by {engine}
            {engine === "mock" && " — set ANTHROPIC_API_KEY to use Claude"}
          </p>
        )}
      </main>
    </>
  );
}
