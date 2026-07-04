#!/usr/bin/env python3
"""Three-way move diff for chess training: you vs Maia-current vs Maia-target,
with Stockfish as ground truth.

For each of your moves in a game, reports:
  - the move you played
  - what Maia at your rating band would play (human-typical at your level)
  - what Maia ~200 points above would play (the reachable improvement)
  - Stockfish's top move (ground truth, flagged "engine-only" when neither
    Maia would realistically play it)

A move is flagged as a LESSON (human-learnable delta) when:
  1. Maia-target diverges from Maia-current, and
  2. Stockfish endorses the Maia-target move (within --endorse-cp of best), and
  3. the target move is meaningfully better than the current-band move
     (by at least --gain-cp).

Usage:
  python maia_diff.py --pgn game.pgn
  python maia_diff.py --fetch barec            # pull latest chess.com game
  python maia_diff.py --fetch barec --games 5  # batch: last 5 games

Engine discovery: --lc0/--stockfish flags, else LC0_PATH/STOCKFISH_PATH env
vars, else PATH, else ./engines/. Never assumes other locations; errors with
instructions if not found.
"""

import argparse
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

import chess
import chess.engine
import chess.pgn

REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_WEIGHTS_DIR = REPO_ROOT / "weights"
MAIA_BANDS = [1100, 1300, 1500, 1700, 1900]

MATE_CP = 10_000  # score assigned to forced mates when converting to centipawns


def nearest_band(rating: int) -> int:
    return min(MAIA_BANDS, key=lambda b: abs(b - rating))


def find_binary(explicit: str | None, env_name: str, names: list[str], label: str) -> str:
    """Locate an engine binary without assuming paths: flag > env var > PATH > ./engines/."""
    import os

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


def open_maia(lc0_path: str, weights: Path) -> chess.engine.SimpleEngine:
    eng = chess.engine.SimpleEngine.popen_uci([lc0_path, f"--weights={weights}"])
    return eng


def maia_move(engine: chess.engine.SimpleEngine, board: chess.Board) -> chess.Move:
    # nodes=1 => raw policy-head argmax: Maia's single best guess of the
    # human move, per the Maia paper's evaluation setting.
    result = engine.play(board, chess.engine.Limit(nodes=1))
    return result.move


def score_cp(info_score: chess.engine.PovScore, pov: chess.Color) -> int:
    s = info_score.pov(pov)
    if s.is_mate():
        m = s.mate()
        return MATE_CP - abs(m) if m > 0 else -MATE_CP + abs(m)
    return s.score()


@dataclass
class MoveRow:
    ply: int
    move_number: str
    played_san: str
    maia_cur_san: str
    maia_tgt_san: str
    sf_san: str
    sf_best_cp: int
    played_loss: int
    cur_loss: int
    tgt_loss: int
    engine_only: bool
    lesson: bool


@dataclass
class GameReport:
    headers: dict
    player_color: chess.Color
    band_cur: int
    band_tgt: int
    rows: list = field(default_factory=list)


class Analyzer:
    def __init__(self, lc0_path, sf_path, band_cur, band_tgt, weights_dir,
                 sf_limit, endorse_cp, gain_cp):
        self.sf_limit = sf_limit
        self.endorse_cp = endorse_cp
        self.gain_cp = gain_cp
        self.band_cur = band_cur
        self.band_tgt = band_tgt
        self.maia_cur = open_maia(lc0_path, maia_weight_path(band_cur, weights_dir))
        self.maia_tgt = open_maia(lc0_path, maia_weight_path(band_tgt, weights_dir))
        self.sf = chess.engine.SimpleEngine.popen_uci(sf_path)

    def close(self):
        for e in (self.maia_cur, self.maia_tgt, self.sf):
            try:
                e.quit()
            except Exception:
                pass

    def eval_move(self, board: chess.Board, move: chess.Move, pov: chess.Color) -> int:
        """Eval (cp, from pov) of the position after forcing `move` at the root."""
        info = self.sf.analyse(board, self.sf_limit, root_moves=[move])
        return score_cp(info["score"], pov)

    def analyze_position(self, board: chess.Board, played: chess.Move, ply: int) -> MoveRow:
        pov = board.turn
        san = board.san

        m_cur = maia_move(self.maia_cur, board)
        m_tgt = maia_move(self.maia_tgt, board)

        best_info = self.sf.analyse(board, self.sf_limit)
        sf_move = best_info["pv"][0]
        best_cp = score_cp(best_info["score"], pov)

        # Eval each distinct candidate once; SF top move's eval is best_cp.
        evals = {sf_move: best_cp}
        for mv in {played, m_cur, m_tgt}:
            if mv not in evals:
                evals[mv] = self.eval_move(board, mv, pov)

        played_loss = max(0, best_cp - evals[played])
        cur_loss = max(0, best_cp - evals[m_cur])
        tgt_loss = max(0, best_cp - evals[m_tgt])

        engine_only = sf_move != m_cur and sf_move != m_tgt
        diverges = m_tgt != m_cur
        endorsed = tgt_loss <= self.endorse_cp
        meaningful = (evals[m_tgt] - evals[m_cur]) >= self.gain_cp
        lesson = diverges and endorsed and meaningful

        num = f"{(ply // 2) + 1}{'.' if pov == chess.WHITE else '...'}"
        return MoveRow(
            ply=ply, move_number=num,
            played_san=san(played), maia_cur_san=san(m_cur),
            maia_tgt_san=san(m_tgt), sf_san=san(sf_move),
            sf_best_cp=best_cp, played_loss=played_loss,
            cur_loss=cur_loss, tgt_loss=tgt_loss,
            engine_only=engine_only, lesson=lesson,
        )

    def analyze_game(self, game: chess.pgn.Game, player: str | None,
                     both_sides: bool) -> GameReport:
        headers = dict(game.headers)
        color = detect_player_color(headers, player)
        report = GameReport(headers=headers, player_color=color,
                            band_cur=self.band_cur, band_tgt=self.band_tgt)
        board = game.board()
        for ply, move in enumerate(game.mainline_moves()):
            if both_sides or board.turn == color:
                row = self.analyze_position(board, move, ply)
                report.rows.append(row)
                print(format_row(row), flush=True)
            board.push(move)
        return report


def detect_player_color(headers: dict, player: str | None) -> chess.Color:
    if player:
        if headers.get("White", "").lower() == player.lower():
            return chess.WHITE
        if headers.get("Black", "").lower() == player.lower():
            return chess.BLACK
        print(f"warning: '{player}' not in PGN headers "
              f"(White={headers.get('White')}, Black={headers.get('Black')}); "
              "defaulting to White", file=sys.stderr)
    return chess.WHITE

def detect_rating(headers: dict, color: chess.Color) -> int:
    key = "WhiteElo" if color == chess.WHITE else "BlackElo"
    try:
        return int(headers.get(key, ""))
    except ValueError:
        sys.exit(f"error: no usable {key} in PGN and no --rating given; "
                 "pass --rating to choose the Maia band.")


HEADER = (f"{'Move':>7}  {'Played':<8} {'Maia-cur':<9} {'Maia-tgt':<9} "
          f"{'SF top':<8} {'loss(you)':>9} {'loss(cur)':>9} {'loss(tgt)':>9}  Flags")


def format_row(r: MoveRow) -> str:
    flags = []
    if r.lesson:
        flags.append("LESSON")
    if r.engine_only:
        flags.append("engine-only")
    if r.played_san == r.maia_tgt_san:
        flags.append("=tgt")
    elif r.played_san == r.maia_cur_san:
        flags.append("=cur")
    return (f"{r.move_number:>7}  {r.played_san:<8} {r.maia_cur_san:<9} "
            f"{r.maia_tgt_san:<9} {r.sf_san:<8} {r.played_loss:>9} "
            f"{r.cur_loss:>9} {r.tgt_loss:>9}  {' '.join(flags)}")


def print_summary(report: GameReport):
    rows = report.rows
    n = len(rows)
    if not n:
        print("no moves analyzed")
        return
    h = report.headers
    who = "White" if report.player_color == chess.WHITE else "Black"
    print()
    print(f"=== Summary: {h.get('White','?')} vs {h.get('Black','?')} "
          f"({h.get('Date','?')}, {h.get('Result','?')}) — you were {who} ===")
    print(f"Maia bands: current={report.band_cur}, target={report.band_tgt}")
    agree_cur = sum(1 for r in rows if r.played_san == r.maia_cur_san)
    agree_tgt = sum(1 for r in rows if r.played_san == r.maia_tgt_san)
    agree_sf = sum(1 for r in rows if r.played_san == r.sf_san)
    lessons = [r for r in rows if r.lesson]
    eng_only = sum(1 for r in rows if r.engine_only)
    avg_loss = sum(r.played_loss for r in rows) / n
    print(f"Moves analyzed: {n}")
    print(f"  matched Maia-current: {agree_cur}/{n} ({100*agree_cur/n:.0f}%)")
    print(f"  matched Maia-target : {agree_tgt}/{n} ({100*agree_tgt/n:.0f}%)")
    print(f"  matched Stockfish   : {agree_sf}/{n} ({100*agree_sf/n:.0f}%)")
    print(f"  avg centipawn loss  : {avg_loss:.0f}")
    print(f"  engine-only SF tops (filtered from lessons): {eng_only}")
    print(f"  LESSONS (human-learnable deltas): {len(lessons)}")
    for r in lessons:
        print(f"    {r.move_number:>7} you played {r.played_san} "
              f"(loss {r.played_loss}cp); a {report.band_tgt}-rated player "
              f"finds {r.maia_tgt_san} (loss {r.tgt_loss}cp), "
              f"while {report.band_cur} plays {r.maia_cur_san} (loss {r.cur_loss}cp)")


def fetch_games(username: str, count: int) -> list:
    """Fetch the player's most recent games from the chess.com public API."""
    import json
    import urllib.request

    def get(url):
        req = urllib.request.Request(url, headers={"User-Agent": "maia-diff-trainer"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)

    try:
        archives = get(f"https://api.chess.com/pub/player/{username}/games/archives")["archives"]
    except Exception as e:
        sys.exit(f"error: could not reach chess.com API ({e}). "
                 "If you're offline or the network blocks api.chess.com, "
                 "export a PGN and use --pgn instead.")
    games = []
    for month_url in reversed(archives):
        month = get(month_url)["games"]
        games.extend(reversed(month))  # newest first
        if len(games) >= count:
            break
    out = []
    import io
    for g in games[:count]:
        pgn = g.get("pgn")
        if pgn:
            parsed = chess.pgn.read_game(io.StringIO(pgn))
            if parsed:
                out.append(parsed)
    return out


def load_pgn_games(path: Path) -> list:
    games = []
    with open(path, encoding="utf-8", errors="replace") as f:
        while True:
            g = chess.pgn.read_game(f)
            if g is None:
                break
            games.append(g)
    return games


def main():
    import logging
    logging.getLogger("chess.engine").setLevel(logging.ERROR)  # hide lc0 banner noise

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--pgn", type=Path, help="PGN file (may contain multiple games)")
    src.add_argument("--fetch", metavar="USERNAME", help="fetch recent games from chess.com")
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
    ap.add_argument("--endorse-cp", type=int, default=50,
                    help="max cp loss for SF to 'endorse' the Maia-target move")
    ap.add_argument("--gain-cp", type=int, default=50,
                    help="min cp gain of target over current move to count as a lesson")
    args = ap.parse_args()

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
    for game in games:
        headers = dict(game.headers)
        color = detect_player_color(headers, args.player)
        rating = args.rating or detect_rating(headers, color)
        band_cur = nearest_band(rating)
        band_tgt = nearest_band(min(MAIA_BANDS[-1], band_cur + args.target_delta))
        print(f"\n### {headers.get('White','?')} ({headers.get('WhiteElo','?')}) vs "
              f"{headers.get('Black','?')} ({headers.get('BlackElo','?')}) "
              f"{headers.get('Date','')} — rating {rating} -> bands {band_cur}/{band_tgt}")
        print(HEADER)
        an = Analyzer(lc0_path, sf_path, band_cur, band_tgt, args.weights_dir,
                      chess.engine.Limit(time=args.sf_movetime),
                      args.endorse_cp, args.gain_cp)
        try:
            report = an.analyze_game(game, args.player, args.both_sides)
        finally:
            an.close()
        reports.append(report)
        print_summary(report)

    if len(reports) > 1:
        total = sum(len(r.rows) for r in reports)
        lessons = sum(1 for r in reports for row in r.rows if row.lesson)
        print(f"\n=== Batch: {len(reports)} games, {total} moves, {lessons} lessons ===")


if __name__ == "__main__":
    main()
