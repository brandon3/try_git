"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Dimension =
  | "wealth"
  | "health"
  | "happiness"
  | "relationships"
  | "home"
  | "work"
  | "other";

type Row = {
  decision: {
    id: number;
    verdict: "needs_you" | "handle" | "ignore";
    action: string;
    dimension: Dimension;
    reason: string;
    confidence: string;
    engine: string;
    userResponse: string | null;
    autoRuleId: number | null;
  };
  item: {
    id: number;
    kind: string;
    title: string;
    from: string | null;
    occursAt: string | null; // ISO string over JSON
  };
};

type Proposal = {
  id: number;
  matcherFrom: string;
  predictedAction: string;
  agreements: number;
  hits: number;
};

type Stats = {
  experiments: {
    shadow: number;
    proposed: Proposal[];
    promoted: Proposal[];
    retired: number;
  };
  calibration: Record<"high" | "medium" | "low", { n: number; accuracy: number }>;
  constitution: { version: number; rationale: string; evalScore: number | null } | null;
  goldenCases: number;
  responses: number;
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

const BADGE_LABEL: Record<string, string> = {
  approved: "Done",
  rejected: "Dismissed",
  acknowledged: "Seen",
};

const GLYPH: Record<string, string> = { email: "✉️", event: "📅" };

const DIMENSIONS: { key: Dimension; label: string; emoji: string }[] = [
  { key: "wealth", label: "Wealth", emoji: "💰" },
  { key: "health", label: "Health", emoji: "❤️" },
  { key: "happiness", label: "Happiness", emoji: "☀️" },
  { key: "relationships", label: "People", emoji: "👥" },
  { key: "home", label: "Home", emoji: "🏠" },
  { key: "work", label: "Work", emoji: "💼" },
  { key: "other", label: "Other", emoji: "•" },
];

const DIM_META = Object.fromEntries(DIMENSIONS.map((d) => [d.key, d])) as Record<
  Dimension,
  (typeof DIMENSIONS)[number]
>;

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
  // Decision currently collecting a rejection note (axis 3: rationale).
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [dimFilter, setDimFilter] = useState<Dimension | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [reflecting, setReflecting] = useState(false);
  const noteRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [briefRes, statsRes] = await Promise.all([
      fetch("/api/brief"),
      fetch("/api/stats"),
    ]);
    setRows((await briefRes.json()).rows);
    setStats(await statsRes.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (noteFor !== null) noteRef.current?.focus();
  }, [noteFor]);

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

  async function respond(
    id: number,
    response: "approved" | "rejected" | "acknowledged",
    note?: string,
  ) {
    const res = await fetch(`/api/decisions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response, note }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      // 409 = already responded elsewhere (another tab/device) — reload shows
      // the truth. Anything else (e.g. execution failed) the user must see.
      if (res.status !== 409) alert(data.error ?? "Something went wrong");
    }
    setNoteFor(null);
    await load();
  }

  async function approveAll(group: Row[]) {
    const pending = group.filter(
      (r) => !r.decision.userResponse && r.decision.action !== "none",
    );
    for (const r of pending) {
      await fetch(`/api/decisions/${r.decision.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: "approved" }),
      });
    }
    await load();
  }

  function submitNote(id: number) {
    void respond(id, "rejected", noteRef.current?.value ?? "");
  }

  async function resolveProposal(id: number, verdict: "promote" | "retire") {
    await fetch(`/api/experiments/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict }),
    });
    await load();
  }

  async function reflect() {
    setReflecting(true);
    try {
      await fetch("/api/reflect", { method: "POST" });
      await load();
    } finally {
      setReflecting(false);
    }
  }

  const reviewed = rows.filter((r) => r.decision.userResponse).length;
  const allReviewed = rows.length > 0 && reviewed === rows.length;

  const dimCounts = rows.reduce(
    (acc, r) => {
      acc[r.decision.dimension] = (acc[r.decision.dimension] ?? 0) + 1;
      return acc;
    },
    {} as Record<Dimension, number>,
  );
  const visible = dimFilter
    ? rows.filter((r) => r.decision.dimension === dimFilter)
    : rows;

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
              {allReviewed ? (
                <strong>All {rows.length} decisions reviewed ✓</strong>
              ) : (
                <>
                  <strong>
                    {reviewed} of {rows.length}
                  </strong>{" "}
                  decisions reviewed
                </>
              )}
            </>
          )}
        </p>

        {rows.length > 0 && (
          <div className="dims">
            <button
              className={`dim ${dimFilter === null ? "active" : ""}`}
              onClick={() => setDimFilter(null)}
            >
              All <span className="dimcount">{rows.length}</span>
            </button>
            {DIMENSIONS.filter((d) => dimCounts[d.key]).map((d) => (
              <button
                key={d.key}
                className={`dim ${dimFilter === d.key ? "active" : ""}`}
                onClick={() => setDimFilter(dimFilter === d.key ? null : d.key)}
              >
                {d.emoji} {d.label} <span className="dimcount">{dimCounts[d.key]}</span>
              </button>
            ))}
          </div>
        )}

        {rows.length === 0 && (
          <div className="empty">
            <div className="symbol">◉</div>
            <h3>Nothing on the watch list</h3>
            <p>Run a brief and Argus will triage your inbox and calendar.</p>
          </div>
        )}

        {stats && stats.experiments.proposed.length > 0 && (
          <section>
            <h2>Argus proposes</h2>
            <div className="group">
              {stats.experiments.proposed.map((p) => (
                <div className="row" key={`prop-${p.id}`}>
                  <div className="glyph handle">⚡️</div>
                  <div className="body">
                    <div className="title">
                      Always {ACTION_LABEL[p.predictedAction] ?? p.predictedAction} mail from{" "}
                      {p.matcherFrom}?
                    </div>
                    <div className="reason">
                      I&apos;ve matched your decision {p.agreements}/{p.hits} times on this.
                      Promoted rules only run reversible actions and demote themselves
                      if your behavior changes.
                    </div>
                  </div>
                  <div className="controls">
                    <button className="pill approve" onClick={() => resolveProposal(p.id, "promote")}>
                      Promote
                    </button>
                    <button className="pill reject" onClick={() => resolveProposal(p.id, "retire")}>
                      Not now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {SECTIONS.map(({ verdict, heading }) => {
          const group = visible.filter((r) => r.decision.verdict === verdict);
          if (group.length === 0) return null;
          const pendingActions = group.filter(
            (r) => !r.decision.userResponse && r.decision.action !== "none",
          ).length;
          return (
            <section key={verdict}>
              <div className="sectionhead">
                <h2>{heading}</h2>
                {verdict !== "needs_you" && pendingActions > 1 && (
                  <button className="linkbtn" onClick={() => approveAll(group)}>
                    Approve all ({pendingActions})
                  </button>
                )}
              </div>
              <div className="group">
                {group.map((r) => (
                  <div className="row" key={r.decision.id}>
                    <div className={`glyph ${verdict}`}>
                      {GLYPH[r.item.kind] ?? "•"}
                    </div>
                    <div className="body">
                      <div className="title">{r.item.title}</div>
                      <div className="meta">
                        <span className={`dimtag ${r.decision.dimension}`}>
                          {DIM_META[r.decision.dimension].emoji}{" "}
                          {DIM_META[r.decision.dimension].label}
                        </span>
                        {r.item.occursAt && (
                          <>
                            {" · "}
                            {new Date(r.item.occursAt).toLocaleString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </>
                        )}
                        {r.item.from && r.item.from !== "calendar" && (
                          <> · {r.item.from}</>
                        )}
                      </div>
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
                        <span className={`badge ${r.decision.autoRuleId ? "auto" : r.decision.userResponse}`}>
                          {r.decision.autoRuleId ? "Auto ⚡️" : BADGE_LABEL[r.decision.userResponse]}
                        </span>
                      ) : noteFor === r.decision.id ? (
                        <div className="notebox">
                          <input
                            ref={noteRef}
                            className="noteinput"
                            placeholder="Why? (optional)"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") submitNote(r.decision.id);
                              if (e.key === "Escape") setNoteFor(null);
                            }}
                          />
                          <button
                            className="pill approve"
                            onClick={() => submitNote(r.decision.id)}
                          >
                            Dismiss
                          </button>
                        </div>
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
                            onClick={() => setNoteFor(r.decision.id)}
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <button
                          className="pill reject"
                          onClick={() => respond(r.decision.id, "acknowledged")}
                        >
                          Got it
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {stats && (
          <div className="learnbar">
            <span>
              {stats.experiments.promoted.length} auto-rule
              {stats.experiments.promoted.length === 1 ? "" : "s"} live ·{" "}
              {stats.experiments.shadow} shadowing · {stats.goldenCases} golden cases
              {stats.constitution && (
                <>
                  {" · "}constitution v{stats.constitution.version}
                  {stats.constitution.evalScore !== null &&
                    ` (evals ${stats.constitution.evalScore}%)`}
                </>
              )}
              {stats.calibration.high.n >= 5 && (
                <> · high-confidence accuracy {stats.calibration.high.accuracy}%</>
              )}
            </span>
            <button className="linkbtn" onClick={reflect} disabled={reflecting}>
              {reflecting ? "Reflecting…" : "Run reflection"}
            </button>
          </div>
        )}

        {stats?.constitution && (
          <p className="enginenote" title={stats.constitution.rationale}>
            Latest reflection: {stats.constitution.rationale}
          </p>
        )}

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
