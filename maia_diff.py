#!/usr/bin/env python3
"""Three-way move diff for chess training: you vs Maia-current vs Maia-target,
with Stockfish as ground truth.

For each of your moves in a game, reports:
  - the move you played (and how typical it is at your band: "you%")
  - what Maia at your rating band would play (human-typical at your level)
  - what Maia ~200 points above would play (the reachable improvement)
  - Stockfish's top move (ground truth, flagged "engine-only" when Maia's
    policy says humans at either band rarely consider it)

A move is flagged as a LESSON (human-learnable delta) when:
  1. Maia-target diverges from Maia-current, and
  2. Stockfish endorses the Maia-target move (within --endorse-cp of best), and
  3. the target move is meaningfully better than the current-band move
     (by at least --gain-cp).

Usage:
  python maia_diff.py --check                  # verify engines + weights
  python maia_diff.py --pgn game.pgn
  python maia_diff.py --fetch barec            # pull latest chess.com game
  python maia_diff.py --fetch barec --games 5  # batch: last 5 games

Engine discovery: --lc0/--stockfish flags, else LC0_PATH/STOCKFISH_PATH env
vars, else PATH, else ./engines/. Never assumes other locations; errors with
instructions if not found.
"""

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import chess
import chess.engine
import chess.pgn

REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_WEIGHTS_DIR = REPO_ROOT / "weights"
MAIA_BANDS = [1100, 1300, 1500, 1700, 1900]

MATE_CP = 10_000  # score assigned to forced mates when converting to centipawns

# Integrity: SHA-256 of the Maia networks as published in CSSLab/maia-chess.
# `--check` verifies the local files against these.
WEIGHT_SHA256 = {
    1100: "e1cf1cd0c96b8a4fa6a275f4b9fd54ed1ffebf9fe44641b9fceded310e9619c4",
    1300: "36195f87bf4761834baa0bf87472b18509a7261a9d7d6f1a8443261369a733f2",
    1500: "35ab6f20421d59e1df3b17c5a5016947af4c6761368ef84044a9a9c7619a9a00",
    1700: "d277eacd792d340a30abb464dc65127254e65cac57abca17facc469889b96478",
    1900: "e2f565f42d7cd9f122557e6dc4eb84e5bbaedceda1d404dc485d3611c7c97a12",
}

CHESSCOM_API = "https://api.chess.com/pub"
USERNAME_RE = re.compile(r"[A-Za-z0-9_.-]{1,64}")
MAX_API_BYTES = 64 * 1024 * 1024  # refuse absurdly large API responses

# lc0 VerboseMoveStats line, e.g.:
# "e2e4  (293 ) N: 0 (+ 0) (P:  8.75%) (Q: ...)"
VERBOSE_STATS_RE = re.compile(
    r"^([a-h][1-8][a-h][1-8][qrbn]?)\s.*\(P:\s*([0-9.]+)%\)")


def nearest_band(rating: int) -> int:
    return min(MAIA_BANDS, key=lambda b: abs(b - rating))


def target_band(current: int, delta: int) -> int:
    return nearest_band(min(MAIA_BANDS[-1], current + delta))


def parse_verbose_stats(lines, board: chess.Board | None = None) -> dict:
    """Parse lc0 'info string' move lines into {uci_move: policy_fraction}.

    lc0 emits castling in Chess960 style (e1a1 = O-O-O); when a board is
    given, moves are normalized to standard UCI (e1c1) so they compare
    equal to python-chess moves.
    """
    policy = {}
    for line in lines:
        m = VERBOSE_STATS_RE.match(line.strip())
        if not m:
            continue
        uci, prob = m.group(1), float(m.group(2)) / 100.0
        if board is not None:
            try:
                uci = board.parse_uci(uci).uci()
            except ValueError:
                continue  # not a legal move in this position; skip
        policy[uci] = prob
    return policy


@dataclass
class Flags:
    engine_only: bool
    lesson: bool


def classify(*, m_cur: str, m_tgt: str, sf: str, eval_cur: int, eval_tgt: int,
             best_cp: int, p_cur_sf, p_tgt_sf, endorse_cp: int, gain_cp: int,
             human_prob: float) -> Flags:
    """Pure decision logic for the engine-only and LESSON flags.

    Moves are UCI strings; evals are cp from the mover's POV. p_cur_sf /
    p_tgt_sf are Maia policy priors for Stockfish's top move (None when
    policy output was unavailable -> falls back to a membership test).
    """
    if p_cur_sf is None or p_tgt_sf is None:
        engine_only = sf != m_cur and sf != m_tgt
    else:
        engine_only = p_cur_sf < human_prob and p_tgt_sf < human_prob

    diverges = m_tgt != m_cur
    endorsed = (best_cp - eval_tgt) <= endorse_cp
    meaningful = (eval_tgt - eval_cur) >= gain_cp
    return Flags(engine_only=engine_only,
                 lesson=diverges and endorsed and meaningful)


def find_binary(explicit: str | None, env_name: str, names: list[str], label: str) -> str:
    """Locate an engine binary without assuming paths: flag > env var > PATH > ./engines/."""
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    if os.environ.get(env_name):
        candidates.append(Path(os.environ[env_name]))
    for name in names:
        hit = shutil.which(name)
        if hit:
            candidates.append(Path(hit))
        for ext in ("", ".exe"):
            candidates.append(REPO_ROOT / "engines" / f"{name}{ext}")
    for c in candidates:
        if c.is_file():
            return str(c)
    sys.exit(
        f"error: could not find {label}. Pass --{label.lower()} PATH, set "
        f"{env_name}, put it on PATH, or drop the binary in ./engines/."
    )


def maia_weight_path(band: int, weights_dir: Path) -> Path:
    p = weights_dir / f"maia-{band}.pb.gz"
    if not p.is_file():
        sys.exit(
            f"error: Maia weights not found at {p}. Download maia-{band}.pb.gz "
            "from https://github.com/CSSLab/maia-chess (maia_weights/) into "
            f"{weights_dir}/ or pass --weights-dir."
        )
    return p


class MaiaEngine:
    """lc0 with a Maia network, queried at nodes=1 (raw policy argmax)."""

    def __init__(self, lc0_path: str, weights: Path):
        self.engine = chess.engine.SimpleEngine.popen_uci(
            [lc0_path, f"--weights={weights}"])
        self.verbose_ok = True
        try:
            self.engine.configure({"VerboseMoveStats": True})
        except chess.engine.EngineError:
            self.verbose_ok = False  # old lc0: no policy probs, moves only

    def query(self, board: chess.Board):
        """Return (move, {uci: policy_prob} or None)."""
        strings = []
        with self.engine.analysis(board, chess.engine.Limit(nodes=1)) as analysis:
            for info in analysis:
                if "string" in info:
                    strings.append(info["string"])
            analysis.wait()
            best = analysis.info.get("pv", [None])[0]
        policy = parse_verbose_stats(strings, board) if self.verbose_ok else {}
        if policy:
            top = max(policy, key=policy.get)
            move = board.parse_uci(top)
        else:
            move = best
        if move is None:  # last resort: plain play()
            move = self.engine.play(board, chess.engine.Limit(nodes=1)).move
        return move, (policy or None)

    def quit(self):
        try:
            self.engine.quit()
        except Exception:
            pass


def score_cp(info_score: chess.engine.PovScore, pov: chess.Color) -> int:
    return info_score.pov(pov).score(mate_score=MATE_CP)


@dataclass
class MoveRow:
    move_number: str
    fen: str                       # position before the move (for diagrams)
    played_san: str
    maia_cur_san: str
    maia_tgt_san: str
    sf_san: str
    played_uci: str
    cur_uci: str
    tgt_uci: str
    played_loss: int
    cur_loss: int
    tgt_loss: int
    played_prob_cur: float | None  # policy prob of your move at your band
    tgt_prob_tgt: float | None     # policy prob of maia-tgt move at target band
    tgt_prob_cur: float | None     # policy prob of maia-tgt move at your band
    engine_only: bool
    lesson: bool

    @property
    def matched_cur(self) -> bool:
        return self.played_san == self.maia_cur_san

    @property
    def matched_tgt(self) -> bool:
        return self.played_san == self.maia_tgt_san

    @property
    def matched_sf(self) -> bool:
        return self.played_san == self.sf_san

    @property
    def lesson_kind(self) -> str | None:
        """'missed' = you didn't play the target move (study this);
        'aced' = you already played it (your band typically doesn't)."""
        if not self.lesson:
            return None
        return "aced" if self.matched_tgt else "missed"

    def tags(self) -> list:
        """Semantic flag tokens; renderers only style them."""
        out = []
        if self.lesson:
            out.append("lesson")
        if self.engine_only:
            out.append("engine-only")
        if self.matched_tgt:
            out.append("=tgt")
        elif self.matched_cur:
            out.append("=cur")
        return out


@dataclass
class GameReport:
    headers: dict
    player_color: chess.Color
    band_cur: int
    band_tgt: int
    rows: list = field(default_factory=list)


@dataclass
class Stats:
    """Per-game aggregates; the single source both renderers consume."""
    moves: int
    agree_cur: int
    agree_tgt: int
    agree_sf: int
    engine_only: int
    avg_loss: float
    humanness: float | None   # mean policy prob of played moves, or None
    lessons: list             # the LESSON rows themselves

    def pct(self, count: int) -> float:
        return 100 * count / self.moves if self.moves else 0.0


def summarize(report: GameReport) -> Stats:
    rows = report.rows
    n = len(rows)
    probs = [r.played_prob_cur for r in rows if r.played_prob_cur is not None]
    return Stats(
        moves=n,
        agree_cur=sum(r.matched_cur for r in rows),
        agree_tgt=sum(r.matched_tgt for r in rows),
        agree_sf=sum(r.matched_sf for r in rows),
        engine_only=sum(r.engine_only for r in rows),
        avg_loss=sum(r.played_loss for r in rows) / n if n else 0.0,
        humanness=sum(probs) / len(probs) if probs else None,
        # Missed lessons first (real study material), biggest mistakes first.
        lessons=sorted((r for r in rows if r.lesson),
                       key=lambda r: (r.lesson_kind != "missed", -r.played_loss)),
    )


LOSS_WARN, LOSS_BAD = 50, 100   # centipawn-loss severity thresholds
LOSS_MATE = MATE_CP - 1000      # losses this large mean a forced mate is involved


def loss_severity(loss: int) -> str | None:
    if loss >= LOSS_BAD:
        return "bad"
    if loss >= LOSS_WARN:
        return "warn"
    return None


class AnalysisCache:
    """Position-keyed cache of engine results (in-memory, optionally
    persisted to a JSON file).

    Maia results are keyed by (band, fen); Stockfish results by (limit, fen)
    with candidate evals merged incrementally, so re-runs with different
    lesson thresholds — or overlapping openings across batch games — skip
    the engine work entirely.
    """

    def __init__(self, path: Path | None = None):
        self.path = path
        self.data = {"maia": {}, "sf": {}}
        self.dirty = False
        self.hits = self.misses = 0
        if path and Path(path).is_file():
            try:
                loaded = json.loads(Path(path).read_text(encoding="utf-8"))
                if isinstance(loaded, dict) and "maia" in loaded and "sf" in loaded:
                    self.data = loaded
            except (OSError, ValueError):
                pass  # corrupt/unreadable cache: start fresh

    def maia_get(self, band: int, fen: str):
        entry = self.data["maia"].get(f"{band}:{fen}")
        self.hits += entry is not None
        self.misses += entry is None
        return entry

    def maia_put(self, band: int, fen: str, move_uci: str, policy: dict | None):
        self.data["maia"][f"{band}:{fen}"] = {"move": move_uci,
                                              "policy": policy or {}}
        self.dirty = True

    def sf_entry(self, limit_key: str, fen: str) -> dict:
        return self.data["sf"].setdefault(f"{limit_key}:{fen}",
                                          {"evals": {}})

    def mark_dirty(self):
        self.dirty = True

    def save(self):
        if not (self.path and self.dirty):
            return
        tmp = Path(str(self.path) + ".tmp")
        tmp.write_text(json.dumps(self.data), encoding="utf-8")
        tmp.replace(self.path)


class EnginePool:
    """Owns the engine processes; spawns each at most once per run.

    Batch runs reuse Maia engines across games with the same band and share
    a single Stockfish process, instead of paying startup per game. Also
    owns the thread pool used to overlap Maia and Stockfish queries.
    """

    def __init__(self, lc0_path: str, sf_path: str, weights_dir: Path,
                 sf_threads: int = 1):
        self.lc0_path = lc0_path
        self.sf_path = sf_path
        self.weights_dir = weights_dir
        self.sf_threads = sf_threads
        self._maia: dict = {}
        self._sf = None
        self.executor = ThreadPoolExecutor(max_workers=2,
                                           thread_name_prefix="maia")

    def maia(self, band: int) -> MaiaEngine:
        if band not in self._maia:
            self._maia[band] = MaiaEngine(
                self.lc0_path, maia_weight_path(band, self.weights_dir))
        return self._maia[band]

    @property
    def sf(self) -> chess.engine.SimpleEngine:
        if self._sf is None:
            self._sf = chess.engine.SimpleEngine.popen_uci(self.sf_path)
            try:
                self._sf.configure({"Threads": self.sf_threads, "Hash": 128})
            except chess.engine.EngineError:
                pass  # engine without these options: run with its defaults
        return self._sf

    def close(self):
        self.executor.shutdown(wait=False)
        for engine in self._maia.values():
            engine.quit()
        if self._sf is not None:
            try:
                self._sf.quit()
            except Exception:
                pass


def limit_key(limit: chess.engine.Limit) -> str:
    return f"d{limit.depth}" if limit.depth else f"t{limit.time}"


class Analyzer:
    def __init__(self, pool: EnginePool, band_cur, band_tgt,
                 sf_limit, endorse_cp, gain_cp, human_prob,
                 cache: AnalysisCache | None = None):
        self.sf_limit = sf_limit
        self.limit_key = limit_key(sf_limit)
        self.endorse_cp = endorse_cp
        self.gain_cp = gain_cp
        self.human_prob = human_prob
        self.band_cur = band_cur
        self.band_tgt = band_tgt
        self.executor = pool.executor
        self.maia_cur = pool.maia(band_cur)
        self.maia_tgt = pool.maia(band_tgt)
        self.sf = pool.sf
        self.cache = cache or AnalysisCache()

    def _maia_query(self, engine: MaiaEngine, band: int,
                    board: chess.Board, fen: str):
        cached = self.cache.maia_get(band, fen)
        if cached is not None:
            return board.parse_uci(cached["move"]), (cached["policy"] or None)
        move, policy = engine.query(board)
        self.cache.maia_put(band, fen, move.uci(), policy)
        return move, policy

    def _sf_best(self, board: chess.Board, fen: str, pov: chess.Color):
        entry = self.cache.sf_entry(self.limit_key, fen)
        if "best" in entry:
            return board.parse_uci(entry["best"]), entry["best_cp"], entry
        info = self.sf.analyse(board, self.sf_limit)
        move, cp = info["pv"][0], score_cp(info["score"], pov)
        entry.update(best=move.uci(), best_cp=cp)
        entry["evals"][move.uci()] = cp
        self.cache.mark_dirty()
        return move, cp, entry

    def eval_moves(self, board: chess.Board, moves: list, pov: chess.Color,
                   entry: dict) -> dict:
        """Evals (cp, from pov) of forcing each move at the root — one
        multipv search for the moves the cache doesn't already know."""
        evals = {board.parse_uci(u): cp for u, cp in entry["evals"].items()}
        missing = [m for m in moves if m not in evals]
        if not missing:
            return evals
        infos = self.sf.analyse(board, self.sf_limit,
                                root_moves=missing, multipv=len(missing))
        for info in infos:
            if "pv" in info and "score" in info:
                evals[info["pv"][0]] = score_cp(info["score"], pov)
        for move in missing:  # engine dropped a line (rare): search it alone
            if move not in evals:
                info = self.sf.analyse(board, self.sf_limit, root_moves=[move])
                evals[move] = score_cp(info["score"], pov)
        entry["evals"].update({m.uci(): cp for m, cp in evals.items()})
        self.cache.mark_dirty()
        return evals

    def analyze_position(self, board: chess.Board, played: chess.Move) -> MoveRow:
        pov = board.turn
        san = board.san
        fen = board.fen()

        # The two Maia processes run on worker threads while this thread
        # runs the Stockfish best-move search — three engines in parallel.
        fut_cur = self.executor.submit(
            self._maia_query, self.maia_cur, self.band_cur, board, fen)
        fut_tgt = self.executor.submit(
            self._maia_query, self.maia_tgt, self.band_tgt, board, fen)
        sf_move, best_cp, entry = self._sf_best(board, fen, pov)
        m_cur, pol_cur = fut_cur.result()
        m_tgt, pol_tgt = fut_tgt.result()

        # Eval the distinct non-SF candidates in one multipv search.
        evals = self.eval_moves(
            board, [m for m in {played, m_cur, m_tgt} if m != sf_move],
            pov, entry)
        evals[sf_move] = best_cp

        def prob(policy, move):
            return policy.get(move.uci()) if policy else None

        flags = classify(
            m_cur=m_cur.uci(), m_tgt=m_tgt.uci(), sf=sf_move.uci(),
            eval_cur=evals[m_cur], eval_tgt=evals[m_tgt], best_cp=best_cp,
            p_cur_sf=prob(pol_cur, sf_move), p_tgt_sf=prob(pol_tgt, sf_move),
            endorse_cp=self.endorse_cp, gain_cp=self.gain_cp,
            human_prob=self.human_prob,
        )

        num = f"{board.fullmove_number}{'.' if pov == chess.WHITE else '...'}"
        return MoveRow(
            move_number=num, fen=board.fen(),
            played_san=san(played), maia_cur_san=san(m_cur),
            maia_tgt_san=san(m_tgt), sf_san=san(sf_move),
            played_uci=played.uci(), cur_uci=m_cur.uci(), tgt_uci=m_tgt.uci(),
            played_loss=max(0, best_cp - evals[played]),
            cur_loss=max(0, best_cp - evals[m_cur]),
            tgt_loss=max(0, best_cp - evals[m_tgt]),
            played_prob_cur=prob(pol_cur, played),
            tgt_prob_tgt=prob(pol_tgt, m_tgt),
            tgt_prob_cur=prob(pol_cur, m_tgt),
            engine_only=flags.engine_only, lesson=flags.lesson,
        )

    def analyze_game(self, game: chess.pgn.Game, player: str | None,
                     both_sides: bool, on_row=None) -> GameReport:
        headers = dict(game.headers)
        color = detect_player_color(headers, player)
        report = GameReport(headers=headers, player_color=color,
                            band_cur=self.band_cur, band_tgt=self.band_tgt)
        board = game.board()
        for move in game.mainline_moves():
            if both_sides or board.turn == color:
                row = self.analyze_position(board, move)
                report.rows.append(row)
                if on_row:
                    on_row(row)
            board.push(move)
        return report


def clean(text: str) -> str:
    """Strip control characters (e.g. ANSI escapes) from untrusted PGN text
    before it reaches the terminal."""
    return re.sub(r"[\x00-\x1f\x7f]", "", text)


def detect_player_color(headers: dict, player: str | None) -> chess.Color:
    if player:
        if headers.get("White", "").lower() == player.lower():
            return chess.WHITE
        if headers.get("Black", "").lower() == player.lower():
            return chess.BLACK
        print(f"warning: '{player}' not in PGN headers "
              f"(White={clean(headers.get('White', '?'))}, "
              f"Black={clean(headers.get('Black', '?'))}); "
              "defaulting to White", file=sys.stderr)
    return chess.WHITE


def detect_rating(headers: dict, color: chess.Color) -> int:
    key = "WhiteElo" if color == chess.WHITE else "BlackElo"
    try:
        return int(headers.get(key, ""))
    except ValueError:
        sys.exit(f"error: no usable {key} in PGN and no --rating given; "
                 "pass --rating to choose the Maia band.")


# ---------------------------------------------------------------------------
# Terminal presentation
# ---------------------------------------------------------------------------

class Style:
    """ANSI styling that degrades to plain text when unsupported.

    Honors NO_COLOR (https://no-color.org), disables itself when stdout is
    not a terminal, and nudges Windows terminals into VT mode.
    """

    enabled = False

    @classmethod
    def init(cls):
        cls.enabled = (sys.stdout.isatty()
                       and not os.environ.get("NO_COLOR")
                       and os.environ.get("TERM") != "dumb")
        if cls.enabled and os.name == "nt":
            os.system("")  # enables ANSI escape processing in cmd/PowerShell

    @classmethod
    def paint(cls, text: str, *codes: str) -> str:
        if not cls.enabled or not codes:
            return text
        return f"\033[{';'.join(codes)}m{text}\033[0m"


BOLD, DIM, GREEN, YELLOW, RED, CYAN = "1", "2", "32", "33", "31", "36"


def fmt_prob(p: float | None) -> str:
    return f"{100 * p:.0f}%" if p is not None else "-"


def fmt_loss(loss: int, width: int = 9) -> str:
    # cp deltas against a forced mate aren't meaningful numbers — say "mate"
    text = f"{'mate' if loss >= LOSS_MATE else loss:>{width}}"
    color = {"bad": RED, "warn": YELLOW}.get(loss_severity(loss))
    return Style.paint(text, color) if color else text


HEADER = (f"{'Move':>7}  {'Played':<8} {'you%':>5} {'Maia-cur':<9} "
          f"{'Maia-tgt':<9} {'SF top':<8} {'loss(you)':>9} {'loss(cur)':>9} "
          f"{'loss(tgt)':>9}  Flags")


TAG_STYLE = {"lesson": ("LESSON", (BOLD, GREEN)),
             "engine-only": ("engine-only", (DIM,)),
             "=tgt": ("=tgt", (CYAN,)),
             "=cur": ("=cur", ())}


def format_row(r: MoveRow) -> str:
    flags = [Style.paint(text, *codes) if codes else text
             for text, codes in (TAG_STYLE[t] for t in r.tags())]
    return (f"{r.move_number:>7}  {r.played_san:<8} "
            f"{Style.paint(f'{fmt_prob(r.played_prob_cur):>5}', DIM)} "
            f"{r.maia_cur_san:<9} {r.maia_tgt_san:<9} {r.sf_san:<8} "
            f"{fmt_loss(r.played_loss)} {fmt_loss(r.cur_loss)} "
            f"{fmt_loss(r.tgt_loss)}  {' '.join(flags)}")


def print_summary(report: GameReport):
    s = summarize(report)
    if not s.moves:
        print("no moves analyzed")
        return
    h = report.headers
    who = "White" if report.player_color == chess.WHITE else "Black"
    print()
    print(f"=== Summary: {clean(h.get('White', '?'))} vs {clean(h.get('Black', '?'))} "
          f"({clean(h.get('Date', '?'))}, {clean(h.get('Result', '?'))}) — you were {who} ===")
    print(f"Maia bands: current={report.band_cur}, target={report.band_tgt}")
    print(f"Moves analyzed: {s.moves}")
    print(f"  matched Maia-current: {s.agree_cur}/{s.moves} ({s.pct(s.agree_cur):.0f}%)")
    print(f"  matched Maia-target : {s.agree_tgt}/{s.moves} ({s.pct(s.agree_tgt):.0f}%)")
    print(f"  matched Stockfish   : {s.agree_sf}/{s.moves} ({s.pct(s.agree_sf):.0f}%)")
    print(f"  avg centipawn loss  : {s.avg_loss:.0f}")
    if s.humanness is not None:
        print(f"  avg 'humanness' of your moves at {report.band_cur} "
              f"(policy %): {100 * s.humanness:.0f}%")
    print(f"  engine-only SF tops (filtered from lessons): {s.engine_only}")
    print(f"  {Style.paint(f'LESSONS (human-learnable deltas): {len(s.lessons)}', BOLD, GREEN)}")
    for r in s.lessons:
        seen = (f"; only {fmt_prob(r.tgt_prob_cur)} of {report.band_cur}s "
                f"consider it" if r.tgt_prob_cur is not None else "")
        finds = (f" ({fmt_prob(r.tgt_prob_tgt)} policy)"
                 if r.tgt_prob_tgt is not None else "")
        kind = (Style.paint("MISSED", BOLD, RED) if r.lesson_kind == "missed"
                else Style.paint("aced", GREEN))
        print(f"    {r.move_number:>7} [{kind}] you played {r.played_san} "
              f"(loss {r.played_loss}cp); a {report.band_tgt}-rated player "
              f"finds {Style.paint(r.maia_tgt_san, BOLD, GREEN)}{finds} "
              f"(loss {r.tgt_loss}cp), "
              f"while {report.band_cur} plays {r.maia_cur_san} "
              f"(loss {r.cur_loss}cp){seen}")


def api_get(url: str):
    """GET a chess.com API URL with scheme/host pinning and a size cap.

    Archive URLs are taken from API responses, so re-validate every URL
    against the API origin before following it.
    """
    if not url.startswith(CHESSCOM_API + "/"):
        raise ValueError(f"refusing non-chess.com API URL: {url!r}")
    req = urllib.request.Request(url, headers={"User-Agent": "maia-diff-trainer"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read(MAX_API_BYTES + 1)
    if len(data) > MAX_API_BYTES:
        raise ValueError(f"API response exceeds {MAX_API_BYTES} bytes")
    return json.loads(data)


def fetch_games(username: str, count: int) -> list:
    """Fetch the player's most recent games from the chess.com public API."""
    if not USERNAME_RE.fullmatch(username):
        sys.exit("error: username may only contain letters, digits, '_', "
                 "'.', '-' (max 64 chars)")
    try:
        archives = api_get(f"{CHESSCOM_API}/player/{username}/games/archives")["archives"]
        if not (isinstance(archives, list)
                and all(isinstance(u, str) for u in archives)):
            raise ValueError("malformed archives listing")
        games = []
        for month_url in reversed(archives):
            month = api_get(month_url).get("games", [])
            games.extend(reversed(month))  # newest first
            if len(games) >= count:
                break
    except Exception as e:
        sys.exit(f"error: could not fetch games from chess.com ({e}). "
                 "If you're offline or the network blocks api.chess.com, "
                 "export a PGN and use --pgn instead.")
    out = []
    for g in games[:count]:
        pgn = g.get("pgn") if isinstance(g, dict) else None
        if isinstance(pgn, str):
            parsed = chess.pgn.read_game(io.StringIO(pgn))
            if parsed:
                out.append(parsed)
    return out


def write_lessons_pgn(reports: list, path: Path) -> int:
    """Export every lesson position as a FEN-start PGN chapter (importable
    into a lichess study or drilling tool). Returns the lesson count."""
    chapters = []
    for report in reports:
        h = report.headers
        for r in summarize(report).lessons:
            board = chess.Board(r.fen)
            game = chess.pgn.Game()
            game.setup(board)
            game.headers["Event"] = (
                f"Lesson ({r.lesson_kind}): move {r.move_number} of "
                f"{h.get('White', '?')} vs {h.get('Black', '?')} {h.get('Date', '')}")
            game.headers["Result"] = "*"
            node = game.add_variation(board.parse_san(r.maia_tgt_san))
            node.comment = (
                f"Target ({report.band_tgt}-level) move. You played "
                f"{r.played_san} (loss {r.played_loss}cp); "
                f"{report.band_cur} typically plays {r.maia_cur_san} "
                f"(loss {r.cur_loss}cp).")
            chapters.append(str(game))
    Path(path).write_text("\n\n".join(chapters) + "\n", encoding="utf-8")
    return len(chapters)


def append_progress(reports: list, path: Path) -> None:
    """Append this run's aggregates to a history file and print the trend.

    Tracks the metrics that reflect durable improvement (avg cp loss,
    target-band agreement) rather than in-session success — fast visible
    gains are a poor learning signal.
    """
    import datetime as dt

    stats = [summarize(r) for r in reports]
    moves = sum(s.moves for s in stats)
    if not moves:
        return
    probs = [s.humanness for s in stats if s.humanness is not None]
    entry = {
        "date": dt.date.today().isoformat(),
        "games": len(reports),
        "moves": moves,
        "acpl": round(sum(s.avg_loss * s.moves for s in stats) / moves, 1),
        "agree_tgt_pct": round(100 * sum(s.agree_tgt for s in stats) / moves, 1),
        "humanness": round(100 * sum(probs) / len(probs), 1) if probs else None,
        "missed": sum(1 for s in stats for r in s.lessons
                      if r.lesson_kind == "missed"),
        "aced": sum(1 for s in stats for r in s.lessons
                    if r.lesson_kind == "aced"),
    }
    history = []
    if Path(path).is_file():
        try:
            loaded = json.loads(Path(path).read_text(encoding="utf-8"))
            if isinstance(loaded, list):
                history = loaded
        except (OSError, ValueError):
            pass
    history.append(entry)
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(history, indent=1), encoding="utf-8")
    tmp.replace(path)

    print(f"\nprogress ({len(history)} run(s) tracked in {path}):")
    def arrow(cur, prev, lower_is_better=False):
        if prev is None or cur is None or cur == prev:
            return ""
        better = cur < prev if lower_is_better else cur > prev
        return Style.paint(" ↑" if better else " ↓",
                           GREEN if better else RED)
    prev = history[-2] if len(history) > 1 else {}
    print(f"  avg cp loss     : {entry['acpl']}"
          f"{arrow(entry['acpl'], prev.get('acpl'), lower_is_better=True)}")
    print(f"  matched +200 band: {entry['agree_tgt_pct']}%"
          f"{arrow(entry['agree_tgt_pct'], prev.get('agree_tgt_pct'))}")
    if entry["humanness"] is not None:
        print(f"  humanness       : {entry['humanness']}%")
    print(f"  lessons         : {entry['missed']} missed, {entry['aced']} aced")


def load_pgn_games(path: Path) -> list:
    games = []
    with open(path, encoding="utf-8", errors="replace") as f:
        while True:
            g = chess.pgn.read_game(f)
            if g is None:
                break
            games.append(g)
    return games


def run_check(args) -> None:
    """Doctor mode: verify engines and weights, run a one-position smoke test."""
    ok = True
    print("maia-diff environment check")
    print("---------------------------")
    lc0_path = find_binary(args.lc0, "LC0_PATH", ["lc0"], "lc0")
    sf_path = find_binary(args.stockfish, "STOCKFISH_PATH", ["stockfish"], "stockfish")
    print(f"lc0       : {lc0_path}")
    print(f"stockfish : {sf_path}")
    problems = []
    for band in MAIA_BANDS:
        path = args.weights_dir / f"maia-{band}.pb.gz"
        if not path.is_file():
            problems.append(f"maia-{band}: missing")
        elif hashlib.sha256(path.read_bytes()).hexdigest() != WEIGHT_SHA256[band]:
            problems.append(f"maia-{band}: SHA-256 MISMATCH — re-download it")
    print(f"weights   : {args.weights_dir} "
          f"({'all bands present, hashes verified' if not problems else '; '.join(problems)})")
    ok &= not problems

    board = chess.Board()
    maia = MaiaEngine(lc0_path, maia_weight_path(1500, args.weights_dir))
    try:
        move, policy = maia.query(board)
        pol = f", policy for {len(policy)} moves" if policy else " (no policy output)"
        print(f"maia-1500 : OK — startpos move {board.san(move)}{pol}")
        if not policy:
            print("            note: engine-only filter will use the weaker "
                  "membership test")
    finally:
        maia.quit()

    sf = chess.engine.SimpleEngine.popen_uci(sf_path)
    try:
        info = sf.analyse(board, chess.engine.Limit(depth=8))
        name = sf.id.get("name", "?")
        print(f"stockfish : OK — {name}, startpos move "
              f"{board.san(info['pv'][0])}")
    finally:
        sf.quit()
    print("---------------------------")
    print("ready" if ok else "NOT ready — fix the items above")
    sys.exit(0 if ok else 1)


def main():
    import logging
    logging.getLogger("chess.engine").setLevel(logging.ERROR)  # hide lc0 banner noise

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--pgn", type=Path, help="PGN file (may contain multiple games)")
    src.add_argument("--fetch", metavar="USERNAME", help="fetch recent games from chess.com")
    src.add_argument("--check", action="store_true",
                     help="verify engines/weights and run a smoke test, then exit")
    ap.add_argument("--games", type=int, default=1, help="number of games to analyze (default 1)")
    ap.add_argument("--player", default="barec", help="your username, to pick your side in each game")
    ap.add_argument("--rating", type=int, help="override rating (else read from PGN Elo headers)")
    ap.add_argument("--target-delta", type=int, default=200, help="target band offset (default +200)")
    ap.add_argument("--both-sides", action="store_true", help="analyze both players' moves")
    ap.add_argument("--lc0", help="path to lc0 binary")
    ap.add_argument("--stockfish", help="path to stockfish binary")
    ap.add_argument("--weights-dir", type=Path, default=DEFAULT_WEIGHTS_DIR)
    ap.add_argument("--sf-movetime", type=float, default=0.25,
                    help="stockfish seconds per query (default 0.25)")
    ap.add_argument("--sf-depth", type=int,
                    help="use a fixed stockfish depth instead of movetime "
                         "(reproducible: identical runs give identical output)")
    ap.add_argument("--sf-threads", type=int, default=1,
                    help="stockfish Threads option (default 1; raising it "
                         "speeds up --sf-depth runs but makes them "
                         "nondeterministic)")
    ap.add_argument("--cache", type=Path, metavar="FILE",
                    help="persist engine results to FILE (JSON); re-running "
                         "the same games (e.g. with different lesson "
                         "thresholds) becomes near-instant")
    ap.add_argument("--endorse-cp", type=int, default=50,
                    help="max cp loss for SF to 'endorse' the Maia-target move")
    ap.add_argument("--gain-cp", type=int, default=50,
                    help="min cp gain of target over current move to count as a lesson")
    ap.add_argument("--human-prob", type=float, default=0.10,
                    help="Maia policy prob below which a SF move counts as "
                         "engine-only, checked at both bands (default 0.10)")
    ap.add_argument("--html", type=Path, metavar="FILE",
                    help="also write a self-contained HTML report with board "
                         "diagrams for each lesson")
    ap.add_argument("--lessons-pgn", type=Path, metavar="FILE",
                    help="also export lesson positions as a FEN-start PGN "
                         "(one chapter per lesson, e.g. for a lichess study)")
    ap.add_argument("--deck", type=Path, metavar="FILE",
                    help="add missed lessons to a spaced-repetition deck "
                         "(drill it with: python trainer.py drill --deck FILE)")
    ap.add_argument("--progress", type=Path, metavar="FILE",
                    help="append this run's aggregate stats to FILE and show "
                         "the trend vs your previous runs")
    args = ap.parse_args()
    Style.init()

    if args.check:
        run_check(args)

    if args.pgn:
        games = load_pgn_games(args.pgn)[: args.games]
    else:
        games = fetch_games(args.fetch, args.games)
        args.player = args.fetch
    if not games:
        sys.exit("error: no games found")

    lc0_path = find_binary(args.lc0, "LC0_PATH", ["lc0"], "lc0")
    sf_path = find_binary(args.stockfish, "STOCKFISH_PATH", ["stockfish"], "stockfish")

    reports = []
    cache = AnalysisCache(args.cache)
    pool = EnginePool(lc0_path, sf_path, args.weights_dir,
                      sf_threads=args.sf_threads)
    try:
        for game in games:
            headers = dict(game.headers)
            color = detect_player_color(headers, args.player)
            rating = args.rating or detect_rating(headers, color)
            band_cur = nearest_band(rating)
            band_tgt = target_band(band_cur, args.target_delta)
            print(f"\n### {clean(headers.get('White', '?'))} ({clean(headers.get('WhiteElo', '?'))}) vs "
                  f"{clean(headers.get('Black', '?'))} ({clean(headers.get('BlackElo', '?'))}) "
                  f"{clean(headers.get('Date', ''))} — rating {rating} -> bands {band_cur}/{band_tgt}")
            print(Style.paint(HEADER, BOLD))
            sf_limit = (chess.engine.Limit(depth=args.sf_depth) if args.sf_depth
                        else chess.engine.Limit(time=args.sf_movetime))
            an = Analyzer(pool, band_cur, band_tgt, sf_limit,
                          args.endorse_cp, args.gain_cp, args.human_prob,
                          cache=cache)
            report = an.analyze_game(game, args.player, args.both_sides,
                                     on_row=lambda r: print(format_row(r), flush=True))
            reports.append(report)
            print_summary(report)
    finally:
        pool.close()
        cache.save()
    if args.cache and cache.hits:
        print(f"\ncache: {cache.hits} hits, {cache.misses} misses ({args.cache})")

    if len(reports) > 1:
        total = sum(len(r.rows) for r in reports)
        lessons = sum(1 for r in reports for row in r.rows if row.lesson)
        print(f"\n=== Batch: {len(reports)} games, {total} moves, {lessons} lessons ===")

    if args.html:
        from html_report import write_report
        write_report(reports, args.html)
        print(f"\nHTML report written to {args.html}")

    if args.lessons_pgn:
        count = write_lessons_pgn(reports, args.lessons_pgn)
        print(f"{count} lesson position(s) exported to {args.lessons_pgn}")

    if args.deck:
        import trainer
        deck = trainer.load_deck(args.deck)
        added = 0
        for report in reports:
            h = report.headers
            source = (f"{h.get('White', '?')} vs {h.get('Black', '?')} "
                      f"{h.get('Date', '')}")
            for r in summarize(report).lessons:
                if r.lesson_kind != "missed":
                    continue
                added += trainer.add_card(
                    deck, fen=r.fen, target_uci=r.tgt_uci,
                    target_san=r.maia_tgt_san, played_san=r.played_san,
                    cur_san=r.maia_cur_san, band_cur=report.band_cur,
                    band_tgt=report.band_tgt, source=clean(source))
        trainer.save_deck(deck, args.deck)
        due = len(trainer.due_cards(deck))
        print(f"{added} new drill card(s) added to {args.deck} "
              f"({len(deck['cards'])} total, {due} due — "
              f"run: python trainer.py drill --deck {args.deck})")

    if args.progress:
        append_progress(reports, args.progress)


if __name__ == "__main__":
    main()
