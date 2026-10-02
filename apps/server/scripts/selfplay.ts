/**
 * Sanity harness for bot profiles: plays profile A vs profile B and prints results.
 * Not a calibration of Elo, only a check that stronger profiles beat weaker ones.
 * Usage: pnpm --filter @chess/server selfplay <ratingA> <ratingB> [gamesPerColor=4] [maxPlies=160]
 */
import { ChessGame } from '@chess/chess-core';
import { buildBotProfile, chooseBotMove } from '@chess/engine';
import { EnginePool } from '../src/modules/analysis/engine-pool.js';
import { StockfishProcess } from '../src/modules/analysis/stockfish-process.js';

const [a = '1600', b = '400', perColor = '4', maxPlies = '160'] = process.argv.slice(2);
const ratingA = Number(a);
const ratingB = Number(b);
const path = process.env.STOCKFISH_PATH ?? '/usr/games/stockfish';
const pool = new EnginePool(
  Array.from({ length: 4 }, () => new StockfishProcess({ path })),
  100,
);

const MATERIAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 } as const;
function adjudicate(game: ChessGame): 'w' | 'b' | 'draw' {
  let diff = 0;
  for (const { piece } of game.getPieces())
    diff += (piece.color === 'w' ? 1 : -1) * MATERIAL[piece.type];
  return diff >= 3 ? 'w' : diff <= -3 ? 'b' : 'draw';
}

async function playGame(whiteRating: number, blackRating: number, seed: number) {
  const game = ChessGame.create();
  let ply = 0;
  while (!game.isGameOver() && ply < Number(maxPlies)) {
    const rating = game.turn() === 'w' ? whiteRating : blackRating;
    const m = await chooseBotMove({
      fen: game.getFen(),
      profile: buildBotProfile(rating),
      engine: pool,
      seed: seed * 1000 + ply,
    });
    if (!game.makeMoveUci(m.move).ok) throw new Error(`illegal bot move ${m.move}`);
    ply++;
  }
  const s = game.getStatus();
  const result =
    s.state === 'checkmate' ? s.winner : s.state === 'draw' ? 'draw' : adjudicate(game);
  return { result, plies: ply, adjudicated: !game.isGameOver() };
}

const jobs: Array<
  Promise<{ aIsWhite: boolean; result: string; plies: number; adjudicated: boolean }>
> = [];
for (let i = 0; i < Number(perColor); i++) {
  jobs.push(playGame(ratingA, ratingB, i).then((r) => ({ aIsWhite: true, ...r })));
  jobs.push(playGame(ratingB, ratingA, 100 + i).then((r) => ({ aIsWhite: false, ...r })));
}
const results = await Promise.all(jobs);
let aWins = 0,
  bWins = 0,
  draws = 0;
for (const r of results) {
  if (r.result === 'draw') draws++;
  else if ((r.result === 'w') === r.aIsWhite) aWins++;
  else bWins++;
}
console.log(
  `profile ${ratingA} vs ${ratingB}: ${ratingA} wins ${aWins}, ${ratingB} wins ${bWins}, draws ${draws} (adjudicated ${results.filter((r) => r.adjudicated).length}/${results.length}, avg plies ${Math.round(results.reduce((n, r) => n + r.plies, 0) / results.length)})`,
);
await pool.dispose();
