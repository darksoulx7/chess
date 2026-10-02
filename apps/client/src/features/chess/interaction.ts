import type { Color, MoveInput, Piece, PromotionPiece, Square } from '@chess/chess-core';

export interface InteractionContext {
  turn: Color;
  /** Which side the local user may move; `null` locks the board. */
  movableColor: Color | 'both' | null;
  pieceAt(square: Square): Piece | null;
  targetsFrom(square: Square): Square[];
  isPromotion(from: Square, to: Square): boolean;
  /** When true, a move needs a second tap on its destination. */
  confirmMoves: boolean;
}

export interface InteractionState {
  selected: Square | null;
  /** Move waiting for a promotion piece. */
  pendingPromotion: { from: Square; to: Square } | null;
  /** Destination awaiting confirmation (move-confirmation setting). */
  armed: Square | null;
}

export interface Outcome {
  state: InteractionState;
  move?: MoveInput;
}

export const IDLE: InteractionState = { selected: null, pendingPromotion: null, armed: null };

export function canMovePiece(ctx: InteractionContext, square: Square): boolean {
  const piece = ctx.pieceAt(square);
  if (!piece || piece.color !== ctx.turn) return false;
  return ctx.movableColor === 'both' || ctx.movableColor === piece.color;
}

function attempt(
  from: Square,
  to: Square,
  state: InteractionState,
  ctx: InteractionContext,
  confirmed: boolean,
): Outcome {
  if (ctx.isPromotion(from, to)) {
    return { state: { selected: from, pendingPromotion: { from, to }, armed: null } };
  }
  if (ctx.confirmMoves && !confirmed) {
    return { state: { ...state, selected: from, armed: to } };
  }
  return { state: IDLE, move: { from, to } };
}

/** A click/tap (or a press+release without dragging) on a square. */
export function tapSquare(
  state: InteractionState,
  square: Square,
  ctx: InteractionContext,
): Outcome {
  if (state.pendingPromotion) return { state: IDLE };

  const { selected } = state;
  if (selected && ctx.targetsFrom(selected).includes(square)) {
    return attempt(selected, square, state, ctx, state.armed === square);
  }
  if (canMovePiece(ctx, square)) {
    return { state: square === selected ? IDLE : { ...IDLE, selected: square } };
  }
  return { state: IDLE };
}

/** Pointer pressed on a square; selects an own piece immediately so legal moves show while dragging. */
export function pressSquare(
  state: InteractionState,
  square: Square,
  ctx: InteractionContext,
): { state: InteractionState; draggable: boolean } {
  if (state.pendingPromotion) return { state: state, draggable: false };
  if (canMovePiece(ctx, square)) {
    return { state: { ...IDLE, selected: square }, draggable: true };
  }
  return { state, draggable: false };
}

/** A dragged piece released over `to` (null = outside the board). */
export function dropPiece(
  state: InteractionState,
  from: Square,
  to: Square | null,
  ctx: InteractionContext,
): Outcome {
  if (to && to !== from && ctx.targetsFrom(from).includes(to)) {
    return attempt(from, to, { ...IDLE, selected: from }, ctx, true);
  }
  return { state: { ...IDLE, selected: from } };
}

export function choosePromotion(state: InteractionState, piece: PromotionPiece): Outcome {
  const pending = state.pendingPromotion;
  if (!pending) return { state };
  return { state: IDLE, move: { from: pending.from, to: pending.to, promotion: piece } };
}

export function cancelInteraction(): InteractionState {
  return IDLE;
}
