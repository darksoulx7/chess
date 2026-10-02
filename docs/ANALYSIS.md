# Analysis and game review

## Architecture

```
AnalysisScreen ──useEngineAnalysis──> POST /api/analysis/position ──> Redis cache ──miss──> EnginePool ──> Stockfish (UCI)
      │                                         (SAN PVs, terminal detection, rate limit)
      └── Review: runReview() calls the same endpoint for every position, then reviewGame() (pure, @chess/engine)
```

- The endpoint is stateless: `{ fen, depth (1–22, default 12), multiPv (1–5, default 1) }` →
  `{ fen, depth, lines[{multipv, depth, score, pv (UCI), san}], bestMove, terminal?, cached }`.
  Finished positions (mate, draw) are answered without the engine (`terminal`). Search time per request is capped
  (`ANALYSIS_MAX_MS`, default 4000 ms); the result is whatever the engine reached by then.
- Results are cached in Redis for 24 h under a hash of (FEN, depth, MultiPV, time cap). Cache failures never fail a request.
  Game review re-analyses the same positions often, so this removes most repeat work.
- Search is cancelled when the client disconnects (e.g. navigating faster than the engine; TanStack Query aborts the fetch).
- Rate limit: `ANALYSIS_RATE_LIMIT_MAX` per minute per IP (default 240).

## Analysis screen

Board with evaluation bar, navigation (buttons, ←/→/Home/End on web, move list), top-3 engine lines in numbered SAN, engine
on/off, depth 10/14/18, arrows (green best move, other lines, plus your own via right-click drag on web), PGN/FEN loading and
export, playing moves on the board (from an earlier position this **replaces the rest of the game**), and "Analyze" from a
finished game. The shown evaluation always belongs to the displayed position; while a new result loads, the previous one stays
visible, dimmed.

## Review: definitions (all configurable in `ReviewThresholds`, defaults in `packages/engine/src/review.ts`)

For each move: `before` = engine score (mover's view) of the position before it; `after` = the opponent's best-line score after it,
flipped to the mover's view. Both are clamped to ±1000 cp (so a mate counts as +1000). **Loss = max(0, before − after)** in
centipawns; playing the engine's first choice counts as loss 0.

| Class              | Rule (default)                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Book               | within the identified opening line (from the opening database)                               |
| Best               | engine's top move, or loss ≤ 10 cp                                                           |
| Good               | loss < 50 cp                                                                                 |
| Inaccuracy         | 50 ≤ loss < 100                                                                              |
| Mistake            | 100 ≤ loss < 200                                                                             |
| Blunder            | loss ≥ 200                                                                                   |
| Missed opportunity | loss ≥ 50 **and** the best move kept ≥ +200 cp for the mover **and** the played move did not |

**Accuracy-style metric:** per move `100 · exp(−4 · Δwp)` where Δwp is the win-probability the mover lost
(`wp(cp) = 1 / (1 + e^(−0.00368208·cp))`, cp clamped to ±1000); the side's accuracy is the mean over its non-book moves.
It is a heuristic summary, not a scientific measure and not comparable with other sites' numbers.

**Phases:** opening = up to max(book length, 12 plies); endgame = total non-pawn material (N/B 3, R 5, Q 9, both sides) ≤ 26;
otherwise middlegame. A phase is labelled only with ≥ 3 scored moves: ≥ 85 % _strong_, ≥ 70 % _solid_, else _needs work_.

Review cost: one engine search per half-move (+1), 3 in parallel, depth capped at 14 for review, retried on `busy`/rate-limit.

## Known limits

- The depth used for review is shallow compared with offline analysis, so close calls (≈ the thresholds) can flip with deeper search.
- Reviews are not persisted yet (the `analysis_results` table arrives with accounts in Phase 7).
- Arrow annotations by drawing are web-only (right mouse button); touch drawing is not implemented.
