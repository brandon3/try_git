"""Unit tests for the drill trainer. Run: python -m unittest test_trainer"""

import datetime as dt
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import chess

import trainer


def make_deck_with_card(**overrides):
    deck = trainer.load_deck(Path("/nonexistent"))
    kw = dict(fen=chess.STARTING_FEN, target_uci="e2e4", target_san="e4",
              played_san="d4", cur_san="d4", band_cur=1500, band_tgt=1700,
              source="test game")
    kw.update(overrides)
    trainer.add_card(deck, **kw)
    return deck


class TestDeck(unittest.TestCase):
    def test_add_card_dedups(self):
        deck = make_deck_with_card()
        self.assertFalse(trainer.add_card(
            deck, fen=chess.STARTING_FEN, target_uci="e2e4", target_san="e4",
            played_san="d4", cur_san="d4", band_cur=1500, band_tgt=1700,
            source="other"))
        self.assertEqual(len(deck["cards"]), 1)

    def test_new_card_is_due_today(self):
        deck = make_deck_with_card()
        self.assertEqual(len(trainer.due_cards(deck)), 1)

    def test_save_load_roundtrip(self):
        deck = make_deck_with_card()
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "deck.json"
            trainer.save_deck(deck, p)
            self.assertEqual(trainer.load_deck(p)["cards"], deck["cards"])


class TestSm2(unittest.TestCase):
    def card(self):
        return next(iter(make_deck_with_card()["cards"].values()))

    def test_success_progression(self):
        c = self.card()
        trainer.sm2_update(c, 5)
        self.assertEqual(c["interval"], 1)
        trainer.sm2_update(c, 5)
        self.assertEqual(c["interval"], 3)
        trainer.sm2_update(c, 5)
        self.assertGreater(c["interval"], 3)  # ef-multiplied from here
        self.assertEqual(c["lapses"], 0)

    def test_failure_resets(self):
        c = self.card()
        for _ in range(3):
            trainer.sm2_update(c, 5)
        trainer.sm2_update(c, 1)
        self.assertEqual((c["reps"], c["interval"], c["lapses"]), (0, 1, 1))
        tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
        self.assertEqual(c["due"], tomorrow)

    def test_ef_floor(self):
        c = self.card()
        for _ in range(30):
            trainer.sm2_update(c, 3)
        self.assertGreaterEqual(c["ef"], trainer.MIN_EF)


class TestStreak(unittest.TestCase):
    def test_streak_increments_consecutive_days(self):
        deck = trainer.load_deck(Path("/nonexistent"))
        yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat()
        deck["streak"] = {"count": 4, "last_day": yesterday}
        self.assertEqual(trainer.bump_streak(deck), 5)
        self.assertEqual(trainer.bump_streak(deck), 5)  # same day: no double

    def test_streak_resets_after_gap(self):
        deck = trainer.load_deck(Path("/nonexistent"))
        deck["streak"] = {"count": 9, "last_day": "2020-01-01"}
        self.assertEqual(trainer.bump_streak(deck), 1)


class TestAnswers(unittest.TestCase):
    def test_parse_answer_san_uci_and_garbage(self):
        board = chess.Board()
        self.assertEqual(trainer.parse_answer(board, "Nf3"),
                         board.parse_san("Nf3"))
        self.assertEqual(trainer.parse_answer(board, "g1f3"),
                         board.parse_san("Nf3"))
        self.assertIsNone(trainer.parse_answer(board, "Ke4"))
        self.assertIsNone(trainer.parse_answer(board, "hello"))


class TestDrillSession(unittest.TestCase):
    def run_drill(self, answers, deck=None):
        deck = deck or make_deck_with_card()
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "deck.json"
            with patch("builtins.input", side_effect=answers), \
                 redirect_stdout(io.StringIO()) as out:
                trainer.drill(deck, p, limit=None)
            return deck, out.getvalue()

    def test_correct_first_try(self):
        deck, out = self.run_drill(["e4"])
        card = next(iter(deck["cards"].values()))
        self.assertEqual(card["reps"], 1)
        self.assertIn("correct", out)
        self.assertEqual(deck["log"][-1]["ok"], True)
        self.assertEqual(deck["streak"]["count"], 1)

    def test_wrong_twice_reveals_and_reschedules(self):
        deck, out = self.run_drill(["d4", "Nf3"])
        card = next(iter(deck["cards"].values()))
        self.assertEqual(card["lapses"], 1)
        self.assertIn("The move is e4", out)
        self.assertEqual(deck["log"][-1]["ok"], False)

    def test_hint_then_correct(self):
        deck, out = self.run_drill(["?", "e4"])
        self.assertIn("hint: move the pawn", out)
        self.assertEqual(next(iter(deck["cards"].values()))["reps"], 1)


if __name__ == "__main__":
    unittest.main()
