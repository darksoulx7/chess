# Openings

## Data

`packages/openings/data/openings.json` is generated from the lichess `chess-openings` dataset (files a–e,
fetched 2026-10-02), which is public domain / CC0 per its README (see `packages/openings/data/README.md`).
3,828 named lines, ECO codes, 138 distinct families. Every line is replayed through `@chess/chess-core` at
generation time (the generator throws on an illegal move), and a test regenerates the file from the TSV
sources and fails if the committed JSON is stale. Regenerate with `pnpm --filter @chess/openings build:data`.

Compact node format: `[id, eco, name, parentId | null, "uci uci …"]`.

## Model

One node type covers the spec's _Opening_ and _Variation_: `Opening { id, eco, name, parentId, moves (UCI) }`.

- Family = node without parent; variation / sub-variation = descendants. Names are hierarchical
  (`Sicilian Defense: Najdorf Variation, English Attack`).
- Lines that share a name are **alternates**: the shortest is the primary and the others hang below it, so a
  name appears once in the hierarchy. A sub-variation attaches to the same-named parent whose line is the longest
  prefix of its own. Plain families like "Queen's Gambit Declined" attach under "Queen's Gambit" when their line
  extends it. About 14% of children use a different move order than their named parent (transpositions): the
  hierarchy is a naming hierarchy, not a strict move tree, and the book only uses lines that extend the selected
  opening's line.
- Ids are slugs of the name (suffix `-2`, `-3` for duplicates, in source order).

## API (`@chess/openings`)

`getOpeningIndex()` → `OpeningIndex` (`get`, `children`, `subtree`, `familyOf`, `search`, `families`),
`identifyOpening(index, uciMoves)` (deepest matching line), `createOpeningBook(index, {openingId, maxMoves, history?})`
(a `BookProvider` for the bot), `pickRandomVariation`, `formatOpeningLine`, `FEATURED_FAMILIES`.

## Bot behaviour

Selecting any node (family, variation or sub-variation) makes its subtree the repertoire. On each bot turn:

1. Stop if `maxMoves` full moves have been played (the engine takes over).
2. Collect lines in the subtree that extend the selected line, match the game so far and have a next move.
3. Pick the next move weighted by how many lines support it (a proxy for mainline-ness), using the seeded RNG.
4. No match (the human left the known lines) → no book move; the engine plays at the bot's strength.
   Book moves are legality-checked before use. "Random variation" is drawn once when the game starts (client side,
   `resolveOpening`) and then followed consistently.

The server receives the history as `moves` (UCI) because a FEN carries none; it replays them and rejects the
request unless they lead exactly to `fen`, the opening id exists, and the depth is 0–30.

## UI

Bot setup: _Bot chooses_ / _Choose opening_ → featured family chips (Italian, Ruy Lopez, Sicilian, French,
Caro-Kann, Queen's Gambit, English) or search across all lines → variation list (_Any line_, _Random variation_, or a
specific variation with ECO) → depth (4–15 moves). The selected line is shown in SAN. In game, the identified opening
(`ECO · name`) is shown and updates as the game develops.

## Limits / follow-ups

- The dataset adds about 700 KB (uncompressed) to the web bundle; lazy-loading it is a possible optimisation.
- The bot follows a line only if the human plays along; there is no "opening trainer" that scores the human.
- Names are English only (dataset limitation).
