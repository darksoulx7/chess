import { Chess, validateFen, type Move, type Square as JsSquare } from 'chess.js';
import { START_FEN, isSquare, parseUci } from './notation';
import type {
  Color,
  GameStatus,
  LoadError,
  MoveError,
  MoveInput,
  MoveRecord,
  PieceType,
  PlacedPiece,
  PromotionPiece,
  Result,
  Square,
} from './types';

/** Upper bounds for untrusted input (FEN/PGN come from users and the network). */
export const MAX_FEN_LENGTH = 100;
export const MAX_PGN_LENGTH = 200_000;

function toRecord(m: Move): MoveRecord {
  const castle = m.isKingsideCastle() ? 'k' : m.isQueensideCastle() ? 'q' : null;
  const record: MoveRecord = {
    from: m.from,
    to: m.to,
    color: m.color,
    piece: m.piece as PieceType,
    san: m.san,
    lan: m.lan,
    before: m.before,
    after: m.after,
    // chess.js reports isCapture() === false for en passant, so derive it from the captured piece.
    isCapture: m.captured !== undefined || m.isEnPassant(),
    isEnPassant: m.isEnPassant(),
    castle,
    isPromotion: m.isPromotion(),
    givesCheck: m.san.endsWith('+') || m.san.endsWith('#'),
    givesCheckmate: m.san.endsWith('#'),
  };
  if (m.captured) record.captured = m.captured as PieceType;
  if (m.promotion) record.promotion = m.promotion as PromotionPiece;
  return record;
}

/**
 * Application-level chess game. Wraps chess.js so that nothing else in the codebase depends on it.
 * Never throws on user-controlled input: failures are returned as `Result` values.
 */
export class ChessGame {
  private constructor(
    private readonly chess: Chess,
    private initialFen: string,
  ) {}

  static create(): ChessGame {
    return new ChessGame(new Chess(), START_FEN);
  }

  static fromFen(fen: string): Result<ChessGame, LoadError> {
    if (fen.length > MAX_FEN_LENGTH) return { ok: false, error: 'input-too-large' };
    const normalized = fen.trim();
    if (!validateFen(normalized).ok) return { ok: false, error: 'invalid-fen' };
    try {
      const chess = new Chess(normalized);
      return { ok: true, value: new ChessGame(chess, chess.fen()) };
    } catch {
      return { ok: false, error: 'invalid-fen' };
    }
  }

  static fromPgn(pgn: string): Result<ChessGame, LoadError> {
    if (pgn.length > MAX_PGN_LENGTH) return { ok: false, error: 'input-too-large' };
    const chess = new Chess();
    try {
      chess.loadPgn(pgn);
    } catch {
      return { ok: false, error: 'invalid-pgn' };
    }
    const history = chess.history({ verbose: true });
    const first = history[0];
    const initialFen = first ? first.before : chess.fen();
    return { ok: true, value: new ChessGame(chess, initialFen) };
  }

  /** Replays the move list on a fresh game from the same start position. */
  clone(): ChessGame {
    const copy = new Chess(this.initialFen);
    for (const m of this.chess.history({ verbose: true })) {
      copy.move({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) });
    }
    return new ChessGame(copy, this.initialFen);
  }

  // ---- position ----

  getFen(): string {
    return this.chess.fen();
  }

  getInitialFen(): string {
    return this.initialFen;
  }

  turn(): Color {
    return this.chess.turn();
  }

  getPieces(): PlacedPiece[] {
    const out: PlacedPiece[] = [];
    for (const row of this.chess.board()) {
      for (const cell of row) {
        if (cell) {
          out.push({
            square: cell.square,
            piece: { type: cell.type as PieceType, color: cell.color },
          });
        }
      }
    }
    return out;
  }

  getPieceAt(square: Square): PlacedPiece['piece'] | null {
    const p = this.chess.get(square as JsSquare);
    return p ? { type: p.type as PieceType, color: p.color } : null;
  }

  // ---- moves ----

  /** All legal moves for the side to move, optionally restricted to one origin square. */
  getLegalMoves(from?: Square): MoveRecord[] {
    const moves = from
      ? this.chess.moves({ verbose: true, square: from as JsSquare })
      : this.chess.moves({ verbose: true });
    return moves.map(toRecord);
  }

  /** True when moving `from`→`to` is a pawn promotion (so the UI must ask for a piece). */
  isPromotionMove(from: Square, to: Square): boolean {
    return this.getLegalMoves(from).some((m) => m.to === to && m.isPromotion);
  }

  makeMove(input: MoveInput): Result<MoveRecord, MoveError> {
    if (!isSquare(input.from) || !isSquare(input.to)) return { ok: false, error: 'invalid-input' };
    if (input.promotion !== undefined && !['q', 'r', 'b', 'n'].includes(input.promotion)) {
      return { ok: false, error: 'invalid-input' };
    }
    if (this.isGameOver()) return { ok: false, error: 'game-over' };

    const candidates = this.chess
      .moves({ verbose: true, square: input.from as JsSquare })
      .filter((m) => m.to === input.to);
    if (candidates.length === 0) return { ok: false, error: 'illegal-move' };

    const needsPromotion = candidates.some((m) => m.isPromotion());
    if (needsPromotion && !input.promotion) return { ok: false, error: 'promotion-required' };
    if (!needsPromotion && input.promotion) return { ok: false, error: 'illegal-move' };

    try {
      const m = this.chess.move({
        from: input.from,
        to: input.to,
        ...(input.promotion ? { promotion: input.promotion } : {}),
      });
      return { ok: true, value: this.recordFor(m) };
    } catch {
      return { ok: false, error: 'illegal-move' };
    }
  }

  makeMoveUci(uci: string): Result<MoveRecord, MoveError> {
    const parsed = parseUci(uci);
    return parsed ? this.makeMove(parsed) : { ok: false, error: 'invalid-input' };
  }

  makeMoveSan(san: string): Result<MoveRecord, MoveError> {
    if (this.isGameOver()) return { ok: false, error: 'game-over' };
    if (san.length > 16) return { ok: false, error: 'invalid-input' };
    try {
      return { ok: true, value: this.recordFor(this.chess.move(san, { strict: false })) };
    } catch {
      return { ok: false, error: 'illegal-move' };
    }
  }

  undo(): MoveRecord | null {
    const history = this.chess.history({ verbose: true });
    const last = history[history.length - 1];
    if (!last) return null;
    const undone = this.chess.undo();
    return undone ? toRecord(last) : null;
  }

  getHistory(): MoveRecord[] {
    return this.chess.history({ verbose: true }).map(toRecord);
  }

  getLastMove(): MoveRecord | null {
    return this.getHistory().at(-1) ?? null;
  }

  /** FEN after `ply` half-moves (0 = initial position). Undefined if out of range. */
  getFenAtPly(ply: number): string | undefined {
    const history = this.chess.history({ verbose: true });
    if (!Number.isInteger(ply) || ply < 0 || ply > history.length) return undefined;
    if (ply === 0) return this.initialFen;
    return history[ply - 1]?.after;
  }

  // ---- status ----

  getStatus(): GameStatus {
    const c = this.chess;
    if (c.isCheckmate()) return { state: 'checkmate', winner: c.turn() === 'w' ? 'b' : 'w' };
    if (c.isStalemate()) return { state: 'draw', reason: 'stalemate' };
    if (c.isInsufficientMaterial()) return { state: 'draw', reason: 'insufficient-material' };
    if (c.isThreefoldRepetition()) return { state: 'draw', reason: 'threefold-repetition' };
    if (c.isDrawByFiftyMoves()) return { state: 'draw', reason: 'fifty-move-rule' };
    return { state: 'active', inCheck: c.isCheck() };
  }

  /**
   * Game-over per this library: checkmate, stalemate, insufficient material, threefold repetition
   * and the fifty-move rule. Note: FIDE treats the last two as claimable; we end the game
   * automatically (documented in docs/CHESS-CORE.md).
   */
  isGameOver(): boolean {
    return this.getStatus().state !== 'active';
  }

  isInCheck(): boolean {
    return this.chess.isCheck();
  }

  // ---- export ----

  getPgn(headers: Record<string, string> = {}): string {
    const copy = this.clone();
    const inner = copy.chess;
    if (this.initialFen !== START_FEN) {
      inner.setHeader('SetUp', '1');
      inner.setHeader('FEN', this.initialFen);
    }
    for (const [k, v] of Object.entries(headers)) inner.setHeader(k, v);
    return inner.pgn();
  }

  private recordFor(m: Move): MoveRecord {
    return toRecord(m);
  }
}
