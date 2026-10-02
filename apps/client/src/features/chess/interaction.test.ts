import { ChessGame } from '@chess/chess-core';
import { describe, expect, it } from 'vitest';
import {
  IDLE,
  choosePromotion,
  dropPiece,
  pressSquare,
  tapSquare,
  type InteractionContext,
} from './interaction';

function ctxFor(fen: string | null, over: Partial<InteractionContext> = {}): InteractionContext {
  const r = fen ? ChessGame.fromFen(fen) : { ok: true as const, value: ChessGame.create() };
  if (!r.ok) throw new Error('fen');
  const g = r.value;
  return {
    turn: g.turn(),
    movableColor: 'both',
    pieceAt: (s) => g.getPieceAt(s),
    targetsFrom: (s) => g.getLegalMoves(s).map((m) => m.to),
    isPromotion: (f, t) => g.isPromotionMove(f, t),
    confirmMoves: false,
    ...over,
  };
}

describe('click-to-move', () => {
  it('select, then move to a legal target', () => {
    const ctx = ctxFor(null);
    const a = tapSquare(IDLE, 'e2', ctx);
    expect(a.state.selected).toBe('e2');
    expect(a.move).toBeUndefined();
    const b = tapSquare(a.state, 'e4', ctx);
    expect(b.move).toEqual({ from: 'e2', to: 'e4' });
    expect(b.state).toEqual(IDLE);
  });

  it('tapping the selected piece deselects; empty/illegal squares clear', () => {
    const ctx = ctxFor(null);
    const sel = tapSquare(IDLE, 'e2', ctx).state;
    expect(tapSquare(sel, 'e2', ctx).state).toEqual(IDLE);
    expect(tapSquare(sel, 'e5', ctx)).toEqual({ state: IDLE });
  });

  it('switches selection to another own piece', () => {
    const ctx = ctxFor(null);
    const sel = tapSquare(IDLE, 'e2', ctx).state;
    expect(tapSquare(sel, 'g1', ctx).state.selected).toBe('g1');
  });

  it("cannot select opponent pieces or move when it's not the user's turn", () => {
    expect(tapSquare(IDLE, 'e7', ctxFor(null)).state).toEqual(IDLE);
    const locked = ctxFor(null, { movableColor: 'b' });
    expect(tapSquare(IDLE, 'e2', locked).state).toEqual(IDLE);
    const none = ctxFor(null, { movableColor: null });
    expect(tapSquare(IDLE, 'e2', none).state).toEqual(IDLE);
  });
});

describe('drag-and-drop', () => {
  it('press selects and is draggable; drop on a legal target moves', () => {
    const ctx = ctxFor(null);
    const p = pressSquare(IDLE, 'g1', ctx);
    expect(p.draggable).toBe(true);
    expect(p.state.selected).toBe('g1');
    expect(dropPiece(p.state, 'g1', 'f3', ctx).move).toEqual({ from: 'g1', to: 'f3' });
  });

  it('dropping on an illegal square or outside keeps the piece selected, no move', () => {
    const ctx = ctxFor(null);
    const p = pressSquare(IDLE, 'g1', ctx).state;
    expect(dropPiece(p, 'g1', 'g3', ctx)).toEqual({ state: { ...IDLE, selected: 'g1' } });
    expect(dropPiece(p, 'g1', null, ctx).move).toBeUndefined();
    expect(dropPiece(p, 'g1', 'g1', ctx).move).toBeUndefined();
  });

  it('press on an opponent piece is not draggable', () => {
    expect(pressSquare(IDLE, 'e7', ctxFor(null)).draggable).toBe(false);
  });
});

describe('promotion', () => {
  const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';

  it('asks for a piece, then emits the move with promotion', () => {
    const ctx = ctxFor(fen);
    const sel = tapSquare(IDLE, 'a7', ctx).state;
    const asked = tapSquare(sel, 'a8', ctx);
    expect(asked.move).toBeUndefined();
    expect(asked.state.pendingPromotion).toEqual({ from: 'a7', to: 'a8' });
    expect(choosePromotion(asked.state, 'n').move).toEqual({
      from: 'a7',
      to: 'a8',
      promotion: 'n',
    });
  });

  it('works for drag-and-drop and can be cancelled by tapping elsewhere', () => {
    const ctx = ctxFor(fen);
    const asked = dropPiece(pressSquare(IDLE, 'a7', ctx).state, 'a7', 'a8', ctx);
    expect(asked.state.pendingPromotion).not.toBeNull();
    expect(tapSquare(asked.state, 'e4', ctx).state).toEqual(IDLE);
  });
});

describe('move confirmation', () => {
  it('requires a second tap on the destination for taps, but not for drags', () => {
    const ctx = ctxFor(null, { confirmMoves: true });
    const sel = tapSquare(IDLE, 'e2', ctx).state;
    const armed = tapSquare(sel, 'e4', ctx);
    expect(armed.move).toBeUndefined();
    expect(armed.state.armed).toBe('e4');
    expect(tapSquare(armed.state, 'e4', ctx).move).toEqual({ from: 'e2', to: 'e4' });
    expect(tapSquare(armed.state, 'e3', ctx).move).toBeUndefined(); // different target re-arms
    expect(dropPiece(IDLE, 'e2', 'e4', ctx).move).toEqual({ from: 'e2', to: 'e4' });
  });
});
