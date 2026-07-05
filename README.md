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

**LESSON flag** (the training signal): Maia-target diverges from Maia-current,
Stockfish endorses the target move (within `--endorse-cp` of best, default 50),
and it is meaningfully better than the current-band move (`--gain-cp`, default
50). **engine-only flag**: Stockfish's top move is one *neither* Maia band
would play — filtered out of the lesson surface, because engine-only lines are
not human-plausible improvement at club level.

Maia moves are queried at `nodes=1` (raw policy argmax), which is the Maia
paper's "predict the human move" setting.

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
- **Stockfish**: download from https://stockfishchess.org/download/, then drop
  `stockfish.exe` into `engines\`, set `STOCKFISH_PATH`, or pass `--stockfish`.

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
```

Your rating is read from the PGN `WhiteElo`/`BlackElo` header for your side
and rounded to the nearest Maia band; the target band is +200 (capped at
1900). Override with `--rating`, `--target-delta`. Other knobs:
`--both-sides`, `--sf-movetime` (default 0.25 s per Stockfish query),
`--endorse-cp`, `--gain-cp`.

Validate the pipeline any time with the committed sample:

```bat
.venv\Scripts\python maia_diff.py --pgn sample_game.pgn
```

Expected: exactly one LESSON at move 11 (Maia-1500 grabs with the queen,
Qxb5+??; Maia-1700 finds Bxb5+, which Stockfish endorses).

## Notes / v1 limitations

- One Stockfish query per distinct candidate move per position (up to ~4 ×
  0.25 s), plus two persistent lc0 processes — a full game analyzes in about
  a minute on a laptop CPU.
- The "engine-only" filter is a membership test (SF top ∉ {Maia moves}). A
  finer version would threshold on Maia's policy probability for the SF move;
  planned for v2.
- `--fetch` uses `https://api.chess.com/pub/player/<user>/games/{archives}`.
  It could not be live-tested from the development container (network policy
  blocks api.chess.com) but follows the documented public API; if it
  misbehaves, export the PGN from chess.com and use `--pgn`.
