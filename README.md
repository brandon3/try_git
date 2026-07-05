# Maia move-diff trainer

Three-way move diff for chess training. For each of your moves in a game it
reports:

| column | meaning |
|---|---|
| Played | the move you actually played |
| Maia-cur | what Maia at **your** rating band would play (typical human at your level) |
| Maia-tgt | what Maia **~200 points above** would play (the reachable improvement) |
| SF top | Stockfish's best move (ground truth) |
| loss(...) | centipawn loss of each move vs Stockfish's best |

The **you%** column is Maia-current's policy probability for the move you
played — how typical your choice was for your rating band.

**LESSON flag** (the training signal): Maia-target diverges from Maia-current,
Stockfish endorses the target move (within `--endorse-cp` of best, default 50),
and it is meaningfully better than the current-band move (`--gain-cp`, default
50). **engine-only flag**: Maia's policy gives Stockfish's top move less than
`--human-prob` (default 10%) at *both* bands — humans at your level and the
target level rarely even consider it, so it is filtered out of the lesson
surface. (If lc0 ever fails to report policy stats, this falls back to a
coarser test: SF's move differs from both Maia moves.)

Maia moves are queried at `nodes=1` (raw policy argmax), which is the Maia
paper's "predict the human move" setting; the policy distribution comes from
lc0's `VerboseMoveStats` output.

## Setup (Windows)

```bat
py -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

Engines — the script never guesses paths; give it one of these:

- **lc0**: a Windows CPU build is committed at `dist\windows\lc0.exe`
  (lc0 v0.31.2, x86-64, Eigen backend, cross-compiled with MinGW, statically
  linked — no DLLs needed; requires a CPU with POPCNT+F16C, i.e. anything
  from ~2013 on). Copy it to `engines\lc0.exe` and you're done:

  ```bat
  copy dist\windows\lc0.exe engines\lc0.exe
  ```

  It carries two small source patches vs upstream v0.31.2: system-zlib
  linking instead of the vendored subproject, and
  `GetModuleFileNameA` instead of `_get_pgmptr` (not exported by MinGW's
  msvcrt). Neither affects search or the network evaluation. If you prefer
  an official build (or want a faster dnnl/onednn backend), download
  `lc0-...-windows-cpu-...zip` from
  https://github.com/LeelaChessZero/lc0/releases and use that instead.
- **Stockfish**: a Windows build is committed at `dist\windows\stockfish.exe`
  (Stockfish 16, x86-64 sse41-popcnt for broad CPU compatibility, MinGW
  cross-build, NNUE net `nn-5af11540bbfe` embedded — the same engine version
  the test suite ran against). Same drill:

  ```bat
  copy dist\windows\stockfish.exe engines\stockfish.exe
  ```

  Official (and faster, AVX2) builds: https://stockfishchess.org/download/.

Then verify everything in one shot:

```bat
.venv\Scripts\python maia_diff.py --check
```

which finds the engines, checks all five weight files, and runs a
one-position smoke test through both engines.

Maia weights (maia-1100 … maia-1900, from
[CSSLab/maia-chess](https://github.com/CSSLab/maia-chess), GPL-3.0) are
committed in `weights/`.

## Setup (Linux)

Same, with `python3 -m venv .venv`. `apt install stockfish` works; lc0 must be
built from source (v0.31.x with `-Dblas=true` uses the Eigen CPU backend) or
installed from your distro/conda.

## Usage

```bat
:: analyze your latest chess.com game (fetches via the public API)
.venv\Scripts\python maia_diff.py --fetch barec

:: last 5 games
.venv\Scripts\python maia_diff.py --fetch barec --games 5

:: analyze a PGN file instead
.venv\Scripts\python maia_diff.py --pgn mygame.pgn

:: also write a shareable HTML report with a board diagram per lesson
.venv\Scripts\python maia_diff.py --fetch barec --games 5 --html report.html
```

The terminal table is colorized when stdout is a terminal (respects
`NO_COLOR`). The `--html` report is a single self-contained file — no
network, no scripts — with lesson cards (SVG boards, arrows for the
target/played/Maia-current moves) and the full move table per game; it
follows your OS light/dark theme.

Lessons come in two kinds, missed-first, biggest mistake first:

- **missed** — you didn't play the target move. In the HTML report these
  are quiz cards: the board shows only your move, and the answer (with its
  arrows and explanation) sits behind a "Show answer" click.
- **aced** — you played the target move even though your band usually
  doesn't. Shown openly, as positive reinforcement.

`--lessons-pgn drills.pgn` additionally exports every lesson position as a
FEN-start PGN chapter (target move as the main line, explanation as a
comment) — import it into a lichess study or any drilling tool for spaced
repetition. Losses that involve forced mates display as `mate` instead of
meaningless huge centipawn numbers.

Your rating is read from the PGN `WhiteElo`/`BlackElo` header for your side
and rounded to the nearest Maia band; the target band is +200 (capped at
1900). Override with `--rating`, `--target-delta`. Other knobs:
`--both-sides`, `--sf-movetime` (default 0.25 s per Stockfish query),
`--sf-depth` (fixed-depth search instead: slower or faster, but
reproducible — borderline lessons can't flip between runs), `--endorse-cp`,
`--gain-cp`, `--human-prob`.

Validate the pipeline any time with the committed sample:

```bat
.venv\Scripts\python maia_diff.py --pgn sample_game.pgn
```

Expected: exactly one LESSON at move 11 (Maia-1500 grabs with the queen,
Qxb5+??; Maia-1700 finds Bxb5+, which Stockfish endorses).

## Tests

```bat
.venv\Scripts\python -m unittest test_maia_diff -v
```

Covers band selection, the LESSON/engine-only decision logic, lc0 policy
parsing (including Chess960-style castling normalization), and sample-game
legality. No engines needed.

## Security notes

- `--fetch` validates the username charset, pins every request (including
  archive URLs read from API responses) to `https://api.chess.com/pub`, and
  caps response sizes.
- `--check` verifies the SHA-256 of all five Maia weight files against the
  published CSSLab networks, so a corrupted or tampered download is caught
  before it ever reaches lc0.
- PGN headers are untrusted input; the HTML report escapes them everywhere
  (covered by tests).
- Engine binaries run as your user: only point `--lc0`/`--stockfish` at
  binaries you trust.

## Notes / limitations

- Per position: the two lc0 policy queries run on worker threads *while*
  Stockfish searches for the best move (three engine processes in
  parallel), then one multipv search covers the remaining candidates.
  Engines are spawned once per run and reused across batch games. A full
  game analyzes in a few seconds on a laptop CPU.
- `--cache analysis.json` persists all engine results keyed by position:
  re-running the same games — e.g. to tune `--gain-cp`/`--endorse-cp` — is
  near-instant (~15× faster), and identical opening positions across batch
  games are only analyzed once. Delete the file to re-analyze from scratch;
  entries are keyed by search limit, so changing `--sf-depth`/`--sf-movetime`
  automatically bypasses stale results.
- `--sf-threads N` speeds up fixed-depth (`--sf-depth`) runs at the cost of
  reproducibility; it has no wall-clock effect on time-based runs.
- `--fetch` uses `https://api.chess.com/pub/player/<user>/games/{archives}`.
  It could not be live-tested from the development container (network policy
  blocks api.chess.com) but follows the documented public API; if it
  misbehaves, export the PGN from chess.com and use `--pgn`.
