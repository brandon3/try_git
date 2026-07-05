"""Unit tests for maia_diff's pure logic (no engines needed).

Run:  python -m unittest test_maia_diff -v
"""

import unittest

import chess

from maia_diff import (classify, load_pgn_games, nearest_band,
                       parse_verbose_stats, target_band)


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
