"""Unit tests for maia_diff's pure logic (no engines needed).

Run:  python -m unittest test_maia_diff -v
"""

import unittest

import chess

from maia_diff import (GameReport, MoveRow, api_get, classify, fetch_games,
                       load_pgn_games, loss_severity, nearest_band,
                       parse_verbose_stats, summarize, target_band)


def make_row(**kw):
    base = dict(move_number="1.", fen=chess.STARTING_FEN, played_san="e4",
                maia_cur_san="e4", maia_tgt_san="e4", sf_san="e4",
                played_uci="e2e4", cur_uci="e2e4", tgt_uci="e2e4",
                played_loss=0, cur_loss=0, tgt_loss=0, played_prob_cur=0.5,
                tgt_prob_tgt=0.5, tgt_prob_cur=0.5, engine_only=False,
                lesson=False)
    base.update(kw)
    return MoveRow(**base)


class TestBands(unittest.TestCase):
    def test_nearest_band(self):
        self.assertEqual(nearest_band(900), 1100)
        self.assertEqual(nearest_band(1399), 1300)
        self.assertEqual(nearest_band(1401), 1500)
        self.assertEqual(nearest_band(2350), 1900)

    def test_target_band_caps_at_1900(self):
        self.assertEqual(target_band(1500, 200), 1700)
        self.assertEqual(target_band(1900, 200), 1900)
        self.assertEqual(target_band(1700, 400), 1900)


class TestParseVerboseStats(unittest.TestCase):
    LINE = ("e2e4  (293 ) N:       0 (+ 0) (P:  8.75%) (WL:  -.-----) "
            "(D: -.---) (M:  -.-) (Q:  0.04017) (U: 0.00075) (S:  0.04092) "
            "(V:  -.----) ")

    def test_parses_move_and_prob(self):
        policy = parse_verbose_stats([self.LINE])
        self.assertAlmostEqual(policy["e2e4"], 0.0875)

    def test_ignores_non_move_lines(self):
        policy = parse_verbose_stats(["node ... something", "", self.LINE])
        self.assertEqual(list(policy), ["e2e4"])

    def test_promotion_move(self):
        line = self.LINE.replace("e2e4", "e7e8q")
        self.assertIn("e7e8q", parse_verbose_stats([line]))

    def test_castling_normalized_to_standard_uci(self):
        # lc0 emits O-O-O as e1a1 (chess960 style); with a board it must
        # normalize to e1c1 so it matches python-chess move encoding.
        board = chess.Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
        line = self.LINE.replace("e2e4", "e1a1")
        policy = parse_verbose_stats([line], board)
        self.assertIn("e1c1", policy)
        self.assertNotIn("e1a1", policy)

    def test_illegal_moves_skipped_when_board_given(self):
        board = chess.Board()
        line = self.LINE.replace("e2e4", "e2e5")
        self.assertEqual(parse_verbose_stats([line], board), {})


class TestClassify(unittest.TestCase):
    BASE = dict(m_cur="g1f3", m_tgt="e2e4", sf="e2e4",
                eval_cur=-20, eval_tgt=30, best_cp=30,
                p_cur_sf=0.40, p_tgt_sf=0.55,
                endorse_cp=50, gain_cp=50, human_prob=0.10)

    def test_lesson_when_diverge_endorsed_meaningful(self):
        f = classify(**self.BASE)
        self.assertTrue(f.lesson)
        self.assertFalse(f.engine_only)

    def test_no_lesson_without_divergence(self):
        f = classify(**{**self.BASE, "m_cur": "e2e4", "eval_cur": 30})
        self.assertFalse(f.lesson)

    def test_no_lesson_when_not_endorsed(self):
        # target move is 80cp worse than best -> SF does not endorse it
        f = classify(**{**self.BASE, "eval_tgt": -50})
        self.assertFalse(f.lesson)

    def test_no_lesson_when_gain_too_small(self):
        f = classify(**{**self.BASE, "eval_cur": 10})  # only +20 over current
        self.assertFalse(f.lesson)

    def test_engine_only_by_policy(self):
        f = classify(**{**self.BASE, "p_cur_sf": 0.02, "p_tgt_sf": 0.05})
        self.assertTrue(f.engine_only)

    def test_not_engine_only_if_either_band_considers_it(self):
        f = classify(**{**self.BASE, "p_cur_sf": 0.02, "p_tgt_sf": 0.30})
        self.assertFalse(f.engine_only)

    def test_membership_fallback_without_policy(self):
        f = classify(**{**self.BASE, "p_cur_sf": None, "p_tgt_sf": None,
                        "sf": "d2d4"})
        self.assertTrue(f.engine_only)
        f = classify(**{**self.BASE, "p_cur_sf": None, "p_tgt_sf": None})
        self.assertFalse(f.engine_only)  # sf == m_tgt


class TestRowTagsAndStats(unittest.TestCase):
    def test_tag_precedence_tgt_over_cur(self):
        r = make_row()  # played == cur == tgt
        self.assertEqual(r.tags(), ["=tgt"])

    def test_tags_full(self):
        r = make_row(maia_tgt_san="d4", lesson=True, engine_only=True)
        self.assertEqual(r.tags(), ["lesson", "engine-only", "=cur"])

    def test_loss_severity_thresholds(self):
        self.assertIsNone(loss_severity(49))
        self.assertEqual(loss_severity(50), "warn")
        self.assertEqual(loss_severity(100), "bad")

    def test_summarize_counts_and_zero_guard(self):
        empty = GameReport(headers={}, player_color=chess.WHITE,
                           band_cur=1500, band_tgt=1700, rows=[])
        s = summarize(empty)
        self.assertEqual((s.moves, s.avg_loss, s.pct(s.agree_cur)), (0, 0.0, 0.0))
        rep = GameReport(headers={}, player_color=chess.WHITE,
                         band_cur=1500, band_tgt=1700,
                         rows=[make_row(played_loss=40),
                               make_row(played_san="d4", played_uci="d2d4",
                                        lesson=True, played_prob_cur=None)])
        s = summarize(rep)
        self.assertEqual(s.moves, 2)
        self.assertEqual(s.agree_cur, 1)   # second row diverges
        self.assertEqual(s.agree_tgt, 1)
        self.assertEqual(len(s.lessons), 1)
        self.assertEqual(s.avg_loss, 20.0)
        self.assertEqual(s.humanness, 0.5)  # None prob excluded


class TestFetchSecurity(unittest.TestCase):
    def test_rejects_url_injecting_username(self):
        for bad in ("a/../../admin", "user?x=1", "a b", "x" * 65, "",
                    "user#frag", "näme"):
            with self.assertRaises(SystemExit, msg=bad):
                fetch_games(bad, 1)

    def test_api_get_pins_origin(self):
        for url in ("https://evil.example/pub/x",
                    "http://api.chess.com/pub/x",          # not https
                    "https://api.chess.com.evil.example/pub/x"):
            with self.assertRaises(ValueError, msg=url):
                api_get(url)


class TestHtmlEscaping(unittest.TestCase):
    def test_untrusted_pgn_headers_are_escaped(self):
        from html_report import write_report
        from maia_diff import GameReport
        import tempfile
        from pathlib import Path

        evil = '<script>alert(1)</script>'
        report = GameReport(
            headers={"White": evil, "Black": "o", "Date": "?", "Result": "*"},
            player_color=chess.WHITE, band_cur=1500, band_tgt=1700, rows=[])
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "r.html"
            write_report([report], out)
            html = out.read_text(encoding="utf-8")
        self.assertNotIn(evil, html)
        self.assertIn("&lt;script&gt;", html)


class TestPgnLoading(unittest.TestCase):
    def test_sample_game_loads_and_is_legal(self):
        games = load_pgn_games("sample_game.pgn")
        self.assertEqual(len(games), 1)
        board = games[0].board()
        for move in games[0].mainline_moves():
            self.assertIn(move, board.legal_moves)
            board.push(move)
        self.assertTrue(board.is_checkmate())


if __name__ == "__main__":
    unittest.main()
