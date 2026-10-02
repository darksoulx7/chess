import { ChessGame } from '@chess/chess-core';
import { describe, expect, it } from 'vitest';
import { buildTrackedPieces } from './tracked-pieces';

function play(game: ChessGame, ...sans: string[]) {
  for (const s of sans) {
    if (!game.makeMoveSan(s).ok) throw new Error(`illegal ${s}`);
  }
  return game;
}

const at = (pieces: ReturnType<typeof buildTrackedPieces>, sq: string) =>
  pieces.find((p) => p.square === sq);

describe('buildTrackedPieces', () => {
  it('matches the engine position', () => {
    const g = play(ChessGame.create(), 'e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6');
    const tracked = buildTrackedPieces(g)
      .map((p) => `${p.color}${p.type}${p.square}`)
      .sort();
    const real = g
      .getPieces()
      .map((p) => `${p.piece.color}${p.piece.type}${p.square}`)
      .sort();
    expect(tracked).toEqual(real);
  });

  it('keeps a piece id stable when it moves', () => {
    const before = buildTrackedPieces(ChessGame.create());
    const id = at(before, 'g1')?.id;
    const after = buildTrackedPieces(play(ChessGame.create(), 'Nf3'));
    expect(at(after, 'f3')?.id).toBe(id);
    expect(at(after, 'g1')).toBeUndefined();
  });

  it('removes the captured piece, including en passant', () => {
    const g = play(ChessGame.create(), 'e4', 'a6', 'e5', 'd5', 'exd6');
    const t = buildTrackedPieces(g);
    expect(at(t, 'd5')).toBeUndefined();
    expect(at(t, 'd6')).toMatchObject({ type: 'p', color: 'w' });
    expect(t).toHaveLength(31);
  });

  it('moves the rook when castling', () => {
    const r = ChessGame.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    if (!r.ok) throw new Error('fen');
    const rookId = at(buildTrackedPieces(r.value), 'h1')?.id;
    play(r.value, 'O-O');
    const t = buildTrackedPieces(r.value);
    expect(at(t, 'f1')?.id).toBe(rookId);
    expect(at(t, 'g1')).toMatchObject({ type: 'k' });
  });

  it('changes type on promotion and keeps identity', () => {
    const r = ChessGame.fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    if (!r.ok) throw new Error('fen');
    const pawnId = at(buildTrackedPieces(r.value), 'a7')?.id;
    r.value.makeMoveUci('a7a8n');
    expect(at(buildTrackedPieces(r.value), 'a8')).toMatchObject({ id: pawnId, type: 'n' });
  });

  it('follows undo', () => {
    const g = play(ChessGame.create(), 'e4', 'e5');
    g.undo();
    const t = buildTrackedPieces(g);
    expect(at(t, 'e5')).toBeUndefined();
    expect(at(t, 'e4')).toMatchObject({ type: 'p', color: 'w' });
  });
});
