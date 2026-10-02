# Opening data

`source/*.tsv` is the lichess `chess-openings` dataset (https://github.com/lichess-org/chess-openings),
files a–e, fetched 2026-10-02. Per the dataset README: "As a collection of facts, this data set is in the
public domain. Where a jurisdiction qualifies for copyright, the work is released under the CC0 Public Domain
Dedication." No attribution is required; it is credited here anyway.

`openings.json` is generated from the TSVs: `pnpm --filter @chess/openings build:data`.
A test regenerates it in memory and fails if the committed file is out of date.
Every line is replayed through `@chess/chess-core`, so the file only contains legal move sequences.
