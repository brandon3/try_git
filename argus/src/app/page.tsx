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

  return (
    <main>
      <header className="hero">
        <h1>
          Argus <span className="eye">◉</span>
        </h1>
        <button className="primary" onClick={runBrief} disabled={running}>
          {running ? "Watching…" : "Run morning brief"}
        </button>
      </header>
      <p className="tagline">A hundred eyes on your inbox, so yours can be elsewhere.</p>

      {rows.length === 0 && (
        <div className="empty">Nothing triaged yet. Run the morning brief.</div>
      )}

      {SECTIONS.map(({ verdict, heading }) => {
        const group = rows.filter((r) => r.decision.verdict === verdict);
        if (group.length === 0) return null;
        return (
          <section key={verdict}>
            <h2>
              {heading} <span className="count">· {group.length}</span>
            </h2>
            {group.map((r) => (
              <div className="card" key={r.decision.id}>
                <div className={`stripe ${verdict}`} />
                <div className="body">
                  <div className="title">{r.item.title}</div>
                  <div className="meta">
                    {r.item.kind === "event" ? "📅 event" : "✉️ email"}
                    {r.item.from ? ` · ${r.item.from}` : ""}
                  </div>
                  <div className="reason">
                    <span className="who">Argus:</span> {r.decision.reason}
                    {r.decision.action !== "none" && (
                      <> — proposes <strong>{ACTION_LABEL[r.decision.action]}</strong></>
                    )}
                  </div>
                </div>
                <div className="controls">
                  {r.decision.userResponse ? (
                    <span className={`badge ${r.decision.userResponse}`}>
                      {r.decision.userResponse}
                    </span>
                  ) : r.decision.action !== "none" ? (
                    <>
                      <button className="approve" onClick={() => respond(r.decision.id, "approved")}>
                        Approve
                      </button>
                      <button className="reject" onClick={() => respond(r.decision.id, "rejected")}>
                        Reject
                      </button>
                    </>
                  ) : (
                    <span className="badge">your call</span>
                  )}
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {engine && (
        <p className="enginenote">
          Last brief triaged by <strong>{engine}</strong>
          {engine === "mock" && " (set ANTHROPIC_API_KEY to use Claude)"}
        </p>
      )}
    </main>
  );
}
