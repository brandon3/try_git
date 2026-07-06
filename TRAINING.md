# From 1400 to 2200: the evidence, and how this tool applies it

This is the output of a multi-source research pass (July 2026) on chess
improvement for adult club players, learning science that transfers, what
chess.com/lichess/maiachess.com actually offer, and which gamification
mechanics help. Verification status is labeled honestly: one claim survived
full adversarial verification before rate limits cut the pass short; the
rest are sourced with direct quotes from primary literature but
single-sourced.

## What the evidence says

**1. Serious solo study is the single strongest predictor of chess rating.**
*(verified 2-0)* Charness, Tuffiash, Krampe, Reingold & Vasyukova (2005),
two large samples of tournament players: "serious study alone was the
strongest predictor of chess skill in both samples" — stronger than
tournament play or formal instruction. Grandmasters averaged ~5,000 hours
of solo study in their first decade, ~5× the intermediate average.
[doi:10.1002/acp.1106]

**2. The mechanisms that make study stick are spacing, retrieval,
interleaving, and generation.** Bjork & Bjork's "desirable difficulties"
literature: conditions that produce fast visible gains during practice
often fail to produce durable learning. The specific manipulations with
evidence: *spacing* study sessions (not massing), *retrieval practice*
(tests, not re-reading), *interleaving* topics (not blocking one theme),
and the *generation effect* — being shown an answer you could have produced
yourself destroys the learning opportunity.
[Bjork & Bjork, "Introducing desirable difficulties into practice"]

**3. Chess skill is a pattern database.** Chunking/template theory (Gobet &
Simon; Cambridge Handbook of Expertise): grandmaster skill rests on a huge
learned store of position patterns (estimates from 50,000 to ~300,000
chunks). Improvement tools should maximize *exposure to and retrieval of
recurring patterns* — and the same Handbook chapter notes the scientific
literature contains "almost no validated, powerful training methods," i.e.
the field runs on expert consensus, not RCTs.

**4. Human error is systematic and predictable — which is why correcting
it works.** The Maia papers (KDD 2020): Maia matches the actual human move
46-53% of the time vs ~35-40% for depth-limited Stockfish, and predicts the
*specific blunder* a player will commit >25% of the time. The Maia authors
themselves propose classifying a player's blunders into predictable
(trainable) vs random — exactly the "human-learnable delta" this tool
flags. Follow-up work: per-player fine-tuned Maia reaches ~65% move
prediction but needs ~5,000 games of history (KDD 2022); Maia-2 (NeurIPS
2024) unifies the rating bands into one skill-conditioned model.

**5. Gamification is a small effect — use it for consistency only.** A
2023 meta-analysis of 35 interventions (N≈2,500) found gamified learning
improved intrinsic motivation by a *small* effect (Hedges' g = 0.257).
Combined with #2 (fast in-session wins are a poor learning signal), the
implication: reward *showing up* (streaks, due-card clearing, longitudinal
trends), never in-session success rates.
[doi:10.1007/s11423-023-10337-7]

## How the competition maps to this — and the gap

| | chess.com / lichess | maiachess.com platform | this tool |
|---|---|---|---|
| Feedback reference | engine top line | Stockfish + human-likelihood ("dual lens") | Stockfish + Maia at *your* band and +200 |
| Learns from **your** games | game review, insights (aggregate stats) | analysis of your games, cross-rating visualizations | yes — every flagged moment comes from your play |
| Human-plausible corrections | no (engine lines a club player won't find) | yes (visualized) | yes, and *filtered*: engine-only lines excluded from lessons |
| Drills built from your own mistakes | no (generic puzzle pool) | **no export of drill positions from your games** | yes — missed lessons → SRS deck + lichess-study PGN |
| Spaced repetition / retrieval | no | no | SM-2 scheduling, generation-first quiz cards |
| Long-term learning signal | rating, puzzle rating | accuracy-style metrics | acpl + target-band agreement trends across runs |

The differentiated core: **closing the loop from your own games to spaced,
retrieval-based drills of human-plausible corrections.** Nobody in the
table's other columns does the full loop.

## The weekly loop this tool supports (≈6-8 h/week)

1. **Play** 3-5 rapid games (15+10 or slower — long enough to think).
2. **Analyze** them: `--fetch barec --games 5 --cache barec.json --deck
   deck.json --progress progress.json --html report.html`.
3. **Quiz yourself** on the report's missed-lesson cards *before* clicking
   "Show answer" (generation effect), then read the answer.
4. **Drill daily**, 10 minutes: `python trainer.py drill` — interleaved,
   spaced, retrieval-based repetitions of your own mistakes.
5. **Watch the trend**, not the session: `--progress` tracks average
   centipawn loss and +200-band agreement across runs. Those move slowly;
   that's normal and correct (fast visible gains are the thing to distrust).
6. Round out with what the tool can't give you (expert-consensus items):
   an endgame book, a few annotated master games a week, and slow games.

## Honest limitations

- **Maia's bands stop at 1900.** Above ~1700 your "+200 target" saturates.
  The plan: by then your lesson stream shifts toward Stockfish-endorsed
  moves that 1900-Maia already considers, and Maia-2 (skill-conditioned,
  single model) is the natural upgrade path for this tool.
- Rating-band Maia models capture the *population* at your rating, not you
  personally. Per-player fine-tuning needs thousands of games (KDD 2022);
  Maia4All-style adaptation (~20 games) is future work.
- Most non-verified claims above are single-sourced from primary
  literature; the expertise field itself admits it lacks validated training
  methods. Treat the weekly loop as evidence-informed, not evidence-proven.
