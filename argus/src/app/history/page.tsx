"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Brief = {
  id: number;
  trigger: string;
  status: string;
  error: string | null;
  triaged: number;
  auto: number;
  engine: string | null;
  ranAt: string;
};

type Responded = {
  decision: {
    id: number;
    action: string;
    reason: string;
    userResponse: string;
    autoRuleId: number | null;
    respondedAt: string | null;
  };
  item: { title: string; from: string | null; kind: string };
};

type Totals = {
  decisions: number;
  approved: number;
  auto: number;
  rejected: number;
  acknowledged: number;
};

const BADGE: Record<string, string> = {
  approved: "Done",
  rejected: "Dismissed",
  acknowledged: "Seen",
};

export default function History() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [responded, setResponded] = useState<Responded[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);

  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/history");
        if (!res.ok) throw new Error("bad status");
        const data = await res.json();
        setBriefs(data.briefs);
        setResponded(data.responded);
        setTotals(data.totals);
        setLoadError(false);
      } catch {
        setLoadError(true);
      }
    })();
  }, []);

  return (
    <>
      <nav className="bar">
        <div className="inner">
          <div className="brand">
            <span className="eye">◉</span> Argus
          </div>
          <Link className="linkbtn" href="/">
            ← Today
          </Link>
        </div>
      </nav>

      <main>
        <h1 className="greeting">The record.</h1>
        {loadError && (
          <div className="banner error">
            Couldn&apos;t reach Argus — is the server up? Reload to retry.
          </div>
        )}
        <p className="summary">
          {totals && (
            <>
              <strong>{totals.decisions}</strong> decisions ·{" "}
              <strong>{totals.approved}</strong> approved ·{" "}
              <strong>{totals.auto}</strong> automatic ·{" "}
              <strong>{totals.rejected}</strong> dismissed ·{" "}
              <strong>{totals.acknowledged}</strong> seen
            </>
          )}
        </p>

        <section>
          <h2>Brief runs</h2>
          <div className="group">
            {briefs.map((b) => (
              <div className="row" key={b.id}>
                <div className={`glyph ${b.status === "error" ? "needs_you" : "handle"}`}>
                  {b.status === "error" ? "⚠️" : b.trigger === "schedule" ? "⏰" : "▶️"}
                </div>
                <div className="body">
                  <div className="title">
                    {new Date(b.ranAt).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="meta">
                    {b.trigger} · {b.engine ?? "—"}
                    {b.status === "error" && b.error ? ` · ${b.error.slice(0, 80)}` : ""}
                  </div>
                </div>
                <div className="controls">
                  <span className={`badge ${b.status === "error" ? "rejected" : "approved"}`}>
                    {b.status === "error" ? "Failed" : `${b.triaged} triaged · ${b.auto} auto`}
                  </span>
                </div>
              </div>
            ))}
            {briefs.length === 0 && (
              <div className="row">
                <div className="body meta">No briefs yet.</div>
              </div>
            )}
          </div>
        </section>

        <section>
          <h2>Recent responses</h2>
          <div className="group">
            {responded.map((r) => (
              <div className="row" key={r.decision.id}>
                <div className="glyph ignore">{r.item.kind === "event" ? "📅" : "✉️"}</div>
                <div className="body">
                  <div className="title">{r.item.title}</div>
                  <div className="meta">
                    {r.decision.action}
                    {r.decision.respondedAt &&
                      ` · ${new Date(r.decision.respondedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}`}
                  </div>
                </div>
                <div className="controls">
                  <span
                    className={`badge ${r.decision.autoRuleId ? "auto" : r.decision.userResponse}`}
                  >
                    {r.decision.autoRuleId ? "Auto ⚡️" : BADGE[r.decision.userResponse]}
                  </span>
                </div>
              </div>
            ))}
            {responded.length === 0 && (
              <div className="row">
                <div className="body meta">No responses yet.</div>
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
