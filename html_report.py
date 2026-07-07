"""Self-contained HTML report for maia_diff analyses.

Everything is inlined (CSS + SVG boards), so the file works offline and can
be shared as-is. All PGN/API-derived text is HTML-escaped: game headers come
from the outside world and must be treated as untrusted.
"""

from html import escape
from pathlib import Path

import chess
import chess.svg

from maia_diff import LOSS_MATE, fmt_prob, loss_severity, summarize

ARROW_TGT = "#15803dcc"     # green  — Maia-target move
ARROW_PLAYED = "#b91c1ccc"  # red    — your move (when it differs)
ARROW_CUR = "#d97706cc"     # amber  — Maia-current move (when it differs)

CSS = """
:root { color-scheme: light dark;
  --fg: #1c1917; --bg: #fafaf9; --card: #ffffff; --line: #e7e5e4;
  --dim: #78716c; --green: #15803d; --amber: #b45309; --red: #b91c1c; }
@media (prefers-color-scheme: dark) { :root {
  --fg: #e7e5e4; --bg: #1c1917; --card: #292524; --line: #44403c;
  --dim: #a8a29e; --green: #4ade80; --amber: #fbbf24; --red: #f87171; } }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 72rem; padding: 2rem 1.25rem 4rem;
  background: var(--bg); color: var(--fg);
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.2rem; margin: 2.5rem 0 .25rem; }
.sub { color: var(--dim); margin: 0 0 1rem; }
.stats { display: flex; flex-wrap: wrap; gap: .4rem 1.5rem; padding: 0;
  margin: 1rem 0; list-style: none; color: var(--dim); font-size: .95rem; }
.stats b { color: var(--fg); font-weight: 600; }
.tablewrap { overflow-x: auto; border: 1px solid var(--line);
  border-radius: .5rem; }
table { border-collapse: collapse; width: 100%; font-size: .9rem;
  font-variant-numeric: tabular-nums; }
th, td { padding: .35rem .65rem; text-align: left; white-space: nowrap; }
th { position: sticky; top: 0; background: var(--card);
  border-bottom: 1px solid var(--line); font-weight: 600; }
tbody tr:nth-child(even) { background: color-mix(in srgb, var(--line) 30%, transparent); }
td.num { text-align: right; }
.dim { color: var(--dim); }
.hot { color: var(--red); font-weight: 600; }
.warm { color: var(--amber); }
.badge { display: inline-block; padding: 0 .45rem; border-radius: 999px;
  font-size: .75rem; font-weight: 600; line-height: 1.5; }
.badge.lesson { background: color-mix(in srgb, var(--green) 18%, transparent);
  color: var(--green); }
.badge.engine { background: color-mix(in srgb, var(--dim) 18%, transparent);
  color: var(--dim); }
.badge.match { color: var(--dim); font-weight: 400; }
tr.lesson-row td:first-child { box-shadow: inset 3px 0 var(--green); }
.cards { display: grid; gap: 1.25rem;
  grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr)); margin-top: 1rem; }
.card { background: var(--card); border: 1px solid var(--line);
  border-radius: .75rem; padding: 1rem; }
.card svg { width: 100%; height: auto; border-radius: .375rem; }
.card h3 { margin: 0 0 .5rem; font-size: 1rem; }
.card p { margin: .6rem 0 0; font-size: .9rem; }
.legend { margin: .6rem 0 0; font-size: .8rem; color: var(--dim);
  display: flex; gap: .9em; flex-wrap: wrap; }
.legend span { white-space: nowrap; }
.k { display: inline-block; width: .7em; height: .7em; border-radius: 2px;
  margin-right: .25em; }
details.answer { margin-top: .6rem; }
details.answer summary { cursor: pointer; font-weight: 600;
  color: var(--green); }
details.answer svg { margin-top: .6rem; }
footer { margin-top: 3rem; color: var(--dim); font-size: .85rem; }
"""


def _arrow_spec(row) -> list:
    """(uci, color, label) for each arrow — drives both the SVG and legend,
    so they can never disagree."""
    spec = [(row.tgt_uci, ARROW_TGT, "target move")]
    if row.played_uci != row.tgt_uci:
        spec.append((row.played_uci, ARROW_PLAYED, "your move"))
    if row.cur_uci not in (row.played_uci, row.tgt_uci):
        spec.append((row.cur_uci, ARROW_CUR, "Maia-current"))
    return spec


def _board_svg(row, orientation: chess.Color, spec: list) -> str:
    arrows = []
    for uci, color, _ in spec:
        move = chess.Move.from_uci(uci)
        arrows.append(chess.svg.Arrow(move.from_square, move.to_square,
                                      color=color))
    return chess.svg.board(chess.Board(row.fen), orientation=orientation,
                           arrows=arrows, size=360)


def _loss_cell(loss: int) -> str:
    cls = {"bad": "hot", "warn": "warm"}.get(
        loss_severity(loss), "dim" if loss == 0 else "")
    text = "mate" if loss >= LOSS_MATE else loss
    return f'<td class="num {cls}">{text}</td>'


def _cp(loss: int) -> str:
    if loss >= LOSS_MATE:
        return "a forced mate"
    return f"−{loss}cp" if loss else "0cp"


BADGE_CLASS = {"lesson": "lesson", "engine-only": "engine", "=tgt": "match",
               "=cur": "match"}


def _flags(row) -> str:
    return " ".join(f'<span class="badge {BADGE_CLASS[t]}">{t}</span>'
                    for t in row.tags())


def _move_table(report) -> str:
    head = ("<tr><th>Move</th><th>Played</th><th>you%</th><th>Maia-cur</th>"
            "<th>Maia-tgt</th><th>SF top</th><th>loss you</th>"
            "<th>loss cur</th><th>loss tgt</th><th></th></tr>")
    body = []
    for r in report.rows:
        cls = ' class="lesson-row"' if r.lesson else ""
        body.append(
            f"<tr{cls}><td>{escape(r.move_number)}</td>"
            f"<td><b>{escape(r.played_san)}</b></td>"
            f'<td class="num dim">{fmt_prob(r.played_prob_cur)}</td>'
            f"<td>{escape(r.maia_cur_san)}</td>"
            f"<td>{escape(r.maia_tgt_san)}</td>"
            f"<td>{escape(r.sf_san)}</td>"
            f"{_loss_cell(r.played_loss)}{_loss_cell(r.cur_loss)}"
            f"{_loss_cell(r.tgt_loss)}<td>{_flags(r)}</td></tr>")
    return (f'<div class="tablewrap"><table><thead>{head}</thead>'
            f'<tbody>{"".join(body)}</tbody></table></div>')


def _lesson_cards(report) -> str:
    lessons = [r for r in report.rows if r.lesson]
    if not lessons:
        return "<p class='dim'>No human-learnable deltas in this game.</p>"
    cards = []
    for r in lessons:
        consider = (f" Only {fmt_prob(r.tgt_prob_cur)} of {report.band_cur}s "
                    f"consider it." if r.tgt_prob_cur is not None else "")
        pol = (f" ({fmt_prob(r.tgt_prob_tgt)} policy)"
               if r.tgt_prob_tgt is not None else "")
        spec = _arrow_spec(r)
        legend = "".join(
            f'<span><span class="k" style="background:{color[:7]}">'
            f'</span>{label}</span>' for _, color, label in spec)
        answer = (
            f"<p>A {report.band_tgt}-level player finds "
            f"<b>{escape(r.maia_tgt_san)}</b>{pol} ({_cp(r.tgt_loss)}), while "
            f"{report.band_cur} typically plays {escape(r.maia_cur_san)} "
            f"({_cp(r.cur_loss)}).{consider}</p>")
        if r.lesson_kind == "missed":
            # Quiz form: question board shows only your move; the answer
            # (and its arrows) stays behind a click.
            question = [(r.played_uci, ARROW_PLAYED, "your move")]
            cards.append(f"""
<div class="card">
  <h3>Move {escape(r.move_number.rstrip('.'))} — find the improvement</h3>
  {_board_svg(r, report.player_color, question)}
  <p>You played <b>{escape(r.played_san)}</b> ({_cp(r.played_loss)}).
     What's better here?</p>
  <details class="answer"><summary>Show answer</summary>
    {_board_svg(r, report.player_color, spec)}
    {answer}
    <p class="legend">{legend}</p>
  </details>
</div>""")
        else:
            cards.append(f"""
<div class="card">
  <h3>Move {escape(r.move_number.rstrip('.'))} — you found
      <span style="color:var(--green)">{escape(r.maia_tgt_san)}</span></h3>
  {_board_svg(r, report.player_color, spec)}
  <p>You played <b>{escape(r.played_san)}</b> ({_cp(r.played_loss)}) —
     a move your band usually misses.</p>
  {answer}
  <p class="legend">{legend}</p>
</div>""")
    return f'<div class="cards">{"".join(cards)}</div>'


def _game_section(report, index: int) -> str:
    h = report.headers
    s = summarize(report)
    who = "White" if report.player_color == chess.WHITE else "Black"
    humanness = (f"<li>humanness <b>{100 * s.humanness:.0f}%</b></li>"
                 if s.humanness is not None else "")
    title = (f"{escape(h.get('White', '?'))} vs {escape(h.get('Black', '?'))}")
    return f"""
<section>
  <h2>Game {index}: {title}</h2>
  <p class="sub">{escape(h.get('Date', '?'))} · {escape(h.get('Result', '?'))}
     · you were {who} · Maia bands {report.band_cur} → {report.band_tgt}</p>
  <ul class="stats">
    <li>moves <b>{s.moves}</b></li>
    <li>lessons <b>{len(s.lessons)}</b></li>
    <li>matched Maia-current <b>{s.pct(s.agree_cur):.0f}%</b></li>
    <li>matched Maia-target <b>{s.pct(s.agree_tgt):.0f}%</b></li>
    <li>avg cp loss <b>{s.avg_loss:.0f}</b></li>
    {humanness}
  </ul>
  {_lesson_cards(report)}
  <details style="margin-top:1rem">
    <summary style="cursor:pointer">All analyzed moves</summary>
    {_move_table(report)}
  </details>
</section>"""


def write_report(reports: list, path: Path) -> None:
    total_lessons = sum(1 for rep in reports for r in rep.rows if r.lesson)
    sections = "".join(_game_section(rep, i + 1)
                       for i, rep in enumerate(reports))
    doc = f"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maia move-diff report</title>
<style>{CSS}</style>
<body>
<h1>Maia move-diff report</h1>
<p class="sub">{len(reports)} game{'s' if len(reports) != 1 else ''} ·
   {total_lessons} lesson{'s' if total_lessons != 1 else ''} worth studying</p>
{sections}
<footer>Generated by maia_diff. Lessons are moves where the stronger Maia
band diverges from yours and Stockfish endorses the difference —
human-plausible improvement, not engine lines.</footer>
</body>
</html>"""
    Path(path).write_text(doc, encoding="utf-8")
