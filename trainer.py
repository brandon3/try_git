#!/usr/bin/env python3
"""Spaced-repetition drill trainer for your own missed lessons.

Analysis runs (maia_diff.py --deck deck.json) add every *missed* lesson to a
deck. This CLI drills the cards that are due, using retrieval practice (you
must produce the move, not recognize it) and an SM-2-style spacing schedule:
positions you keep getting right retreat to longer intervals, ones you miss
come back tomorrow.

Usage:
  python trainer.py drill                # drill everything that's due
  python trainer.py drill --limit 10
  python trainer.py stats                # deck and streak overview

Answers are typed in SAN ("Nf3", "Bxb5+") or UCI ("g1f3"); "q" quits,
"?" shows a hint (the piece to move).
"""

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import chess

DEFAULT_DECK = Path(__file__).resolve().parent / "deck.json"

# SM-2-lite: (interval multiplier progression for successive successes)
FIRST_INTERVALS = [1, 3]      # days for reps 1 and 2
MIN_EF, START_EF = 1.3, 2.5


def today() -> str:
    return dt.date.today().isoformat()


def load_deck(path: Path) -> dict:
    if Path(path).is_file():
        try:
            deck = json.loads(Path(path).read_text(encoding="utf-8"))
            if isinstance(deck, dict) and "cards" in deck:
                deck.setdefault("streak", {"count": 0, "last_day": ""})
                deck.setdefault("log", [])
                return deck
        except (OSError, ValueError):
            print(f"warning: could not read {path}; starting a fresh deck",
                  file=sys.stderr)
    return {"cards": {}, "streak": {"count": 0, "last_day": ""}, "log": []}


def save_deck(deck: dict, path: Path) -> None:
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(deck, indent=1), encoding="utf-8")
    tmp.replace(path)


def add_card(deck: dict, *, fen: str, target_uci: str, target_san: str,
             played_san: str, cur_san: str, band_cur: int, band_tgt: int,
             source: str) -> bool:
    """Add a missed lesson to the deck. Returns False if already present."""
    key = f"{fen}:{target_uci}"
    if key in deck["cards"]:
        return False
    deck["cards"][key] = {
        "fen": fen, "target_uci": target_uci, "target_san": target_san,
        "played_san": played_san, "cur_san": cur_san,
        "band_cur": band_cur, "band_tgt": band_tgt, "source": source,
        "added": today(), "ef": START_EF, "reps": 0, "interval": 0,
        "due": today(), "lapses": 0,
    }
    return True


def sm2_update(card: dict, quality: int) -> None:
    """quality: 5 = right first try, 3 = right on retry, 1 = failed."""
    if quality < 3:
        card["reps"] = 0
        card["interval"] = 1
        card["lapses"] += 1
    else:
        card["reps"] += 1
        if card["reps"] <= len(FIRST_INTERVALS):
            card["interval"] = FIRST_INTERVALS[card["reps"] - 1]
        else:
            card["interval"] = round(card["interval"] * card["ef"])
        card["ef"] = max(MIN_EF, card["ef"]
                         + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    card["due"] = (dt.date.today()
                   + dt.timedelta(days=card["interval"])).isoformat()


def due_cards(deck: dict) -> list:
    import random
    cutoff = today()
    due = [(k, c) for k, c in deck["cards"].items() if c["due"] <= cutoff]
    # Interleave: mixing positions from different games/themes beats blocked
    # repetition for retention (Bjork's "desirable difficulties").
    random.shuffle(due)
    return due


def bump_streak(deck: dict) -> int:
    streak = deck["streak"]
    day = today()
    if streak["last_day"] == day:
        return streak["count"]
    yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    streak["count"] = streak["count"] + 1 if streak["last_day"] == yesterday else 1
    streak["last_day"] = day
    return streak["count"]


def parse_answer(board: chess.Board, text: str) -> chess.Move | None:
    for parser in (board.parse_san, board.parse_uci):
        try:
            return parser(text)
        except ValueError:
            continue
    return None


def show_board(board: chess.Board, pov: chess.Color) -> None:
    print()
    print(board.unicode(invert_color=True, empty_square="·",
                        orientation=pov))
    print()


def drill(deck: dict, deck_path: Path, limit: int | None) -> None:
    queue = due_cards(deck)
    if limit:
        queue = queue[:limit]
    if not queue:
        n = len(deck["cards"])
        nxt = min((c["due"] for c in deck["cards"].values()), default=None)
        print(f"Nothing due. {n} card(s) in deck"
              + (f"; next due {nxt}." if nxt else "."))
        return

    print(f"{len(queue)} position(s) due. Type the move you'd play "
          "(SAN or UCI), '?' for a hint, 'q' to stop.")
    right = wrong = 0
    for i, (key, card) in enumerate(queue, 1):
        board = chess.Board(card["fen"])
        side = "White" if board.turn == chess.WHITE else "Black"
        target = board.parse_uci(card["target_uci"])
        print(f"\n--- {i}/{len(queue)} · {side} to move · from {card['source']} ---")
        show_board(board, board.turn)
        attempts = 0
        while True:
            try:
                answer = input(f"{side} plays: ").strip()
            except (EOFError, KeyboardInterrupt):
                answer = "q"
            if answer == "q":
                finish(deck, deck_path, right, wrong)
                return
            if answer == "?":
                piece = board.piece_at(target.from_square)
                print(f"hint: move the {chess.piece_name(piece.piece_type)}")
                continue
            move = parse_answer(board, answer)
            if move is None:
                print("not a legal move here — try again")
                continue
            attempts += 1
            if move == target:
                quality = 5 if attempts == 1 else 3
                right += 1
                print(f"✓ {card['target_san']} — correct"
                      + (" (on the retry)" if attempts > 1 else "")
                      + f". You originally played {card['played_san']}.")
                sm2_update(card, quality)
                break
            if attempts == 1:
                print("✗ not the one — one more try")
                continue
            wrong += 1
            print(f"✗ The move is {card['target_san']} "
                  f"(you played {card['played_san']}; your band typically "
                  f"plays {card['cur_san']}). Back in the deck for tomorrow.")
            sm2_update(card, 1)
            break
        deck["log"].append({"day": today(), "card": key,
                            "ok": move == target, "attempts": attempts})
    finish(deck, deck_path, right, wrong)


def finish(deck: dict, deck_path: Path, right: int, wrong: int) -> None:
    if right or wrong:
        streak = bump_streak(deck)
        total = right + wrong
        print(f"\nSession: {right}/{total} correct. "
              f"Daily streak: {streak} day(s).")
    save_deck(deck, deck_path)


def stats(deck: dict) -> None:
    cards = deck["cards"].values()
    n = len(deck["cards"])
    due = sum(1 for c in cards if c["due"] <= today())
    mature = sum(1 for c in cards if c["interval"] >= 21)
    lapses = sum(c["lapses"] for c in cards)
    recent = [e for e in deck["log"] if e["day"] >= (
        dt.date.today() - dt.timedelta(days=7)).isoformat()]
    acc = (100 * sum(e["ok"] for e in recent) / len(recent)) if recent else 0
    print(f"deck        : {n} card(s), {due} due today, {mature} mature (21d+)")
    print(f"streak      : {deck['streak']['count']} day(s) "
          f"(last: {deck['streak']['last_day'] or 'never'})")
    print(f"last 7 days : {len(recent)} attempt(s), {acc:.0f}% correct, "
          f"{lapses} lifetime lapse(s)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("command", choices=["drill", "stats"])
    ap.add_argument("--deck", type=Path, default=DEFAULT_DECK)
    ap.add_argument("--limit", type=int, help="max cards this session")
    args = ap.parse_args()

    deck = load_deck(args.deck)
    if args.command == "drill":
        drill(deck, args.deck, args.limit)
    else:
        stats(deck)


if __name__ == "__main__":
    main()
