# Chess core (`@chess/chess-core`)

Framework-free wrapper around chess.js 1.4.0 (BSD-2). Only this package may import `chess.js` (ESLint-enforced).

## API

`ChessGame.create() | fromFen(fen) | fromPgn(pgn)` → `Result` for untrusted input (`invalid-fen`, `invalid-pgn`, `input-too-large`; caps: FEN 100 chars, PGN 200 kB).

| Method                                                           | Purpose                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| `getLegalMoves(from?)` / `isPromotionMove(from,to)`              | UI move hints; promotions appear once per piece          |
| `makeMove({from,to,promotion?})`, `makeMoveUci`, `makeMoveSan`   | `Result<MoveRecord, MoveError>`; never throws            |
| `undo()`, `getHistory()`, `getLastMove()`, `getFenAtPly(n)`      | history / navigation                                     |
| `getStatus()`                                                    | `active{inCheck}` · `checkmate{winner}` · `draw{reason}` |
| `getFen()`, `getInitialFen()`, `getPgn(headers?)`, `getPieces()` | export / rendering                                       |

`MoveError`: `game-over`, `illegal-move`, `promotion-required`, `invalid-input`.

## Behaviour notes

- Threefold repetition and the fifty-move rule end the game automatically (FIDE treats them as claimable). Undo reopens it.
- `MoveRecord.isCapture` is true for en passant (chess.js reports false; the wrapper corrects it).
- Custom start positions round-trip through PGN via `SetUp`/`FEN` headers.

## Tests

`pnpm --filter @chess/chess-core test`: perft node counts (start position, Kiwipete, two further standard positions) driven through the public API, plus castling (through/out of check, lost rights), en passant, promotion, stalemate, checkmate, repetition, 50-move, insufficient material, undo, FEN/PGN validation and round-trip.
