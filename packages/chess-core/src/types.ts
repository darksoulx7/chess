export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';
export type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${File}${Rank}`;

export interface Piece {
  type: PieceType;
  color: Color;
}

export interface PlacedPiece {
  square: Square;
  piece: Piece;
}

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
}

export interface MoveRecord {
  from: Square;
  to: Square;
  color: Color;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PromotionPiece;
  san: string;
  /** Long algebraic / UCI-style, e.g. `e2e4`, `e7e8q`. */
  lan: string;
  /** FEN before and after the move. */
  before: string;
  after: string;
  isCapture: boolean;
  isEnPassant: boolean;
  /** `k` = kingside, `q` = queenside, `null` = not a castling move. */
  castle: 'k' | 'q' | null;
  isPromotion: boolean;
  givesCheck: boolean;
  givesCheckmate: boolean;
}

export type DrawReason =
  'stalemate' | 'insufficient-material' | 'threefold-repetition' | 'fifty-move-rule';

export type GameStatus =
  | { state: 'active'; inCheck: boolean }
  | { state: 'checkmate'; winner: Color }
  | { state: 'draw'; reason: DrawReason };

export type MoveError = 'game-over' | 'illegal-move' | 'promotion-required' | 'invalid-input';

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type LoadError = 'invalid-fen' | 'invalid-pgn' | 'input-too-large';
