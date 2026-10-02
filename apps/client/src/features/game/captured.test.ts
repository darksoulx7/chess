import { ChessGame } from '@chess/chess-core';
import { describe, expect, it } from 'vitest';
import { materialAdvantage, summarizeCaptures } from './captured';
import { soundFor } from './sound-events';

function play(...sans: string[]) {
  const g = ChessGame.create();
  for (const s of sans) if (!g.makeMoveSan(s).ok) throw new Error(`illegal ${s}`);
  return g;
}

describe('summarizeCaptures', () => {
  it('is empty without captures', () => {
    expect(summarizeCaptures(play('e4', 'e5').getHistory())).toEqual({
      byWhite: [],
      byBlack: [],
      balance: 0,
    });
  });

  it('tracks captures by side and balance', () => {
    // 1.e4 d5 2.exd5 Qxd5 3.Nc3 Qxg2?? -> white took a pawn, black took pawn + pawn; then knight check
    const s = summarizeCaptures(play('e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qxg2').getHistory());
    expect(s.byWhite).toEqual(['p']);
    expect(s.byBlack).toEqual(['p', 'p']);
    expect(s.balance).toBe(-1);
    expect(materialAdvantage(s, 'b')).toBe(1);
    expect(materialAdvantage(s, 'w')).toBe(-1);
  });

  it('orders captured pieces by value and counts en passant', () => {
    const s = summarizeCaptures(
      play('e4', 'a6', 'e5', 'd5', 'exd6', 'Nf6', 'dxc7', 'Qxc7').getHistory(),
    );
    expect(s.byWhite).toEqual(['p', 'p']);
    expect(s.byBlack).toEqual(['p']);
  });
});

describe('soundFor', () => {
  const last = (g: ChessGame) => {
    const m = g.getLastMove();
    if (!m) throw new Error('no move');
    return soundFor(m, g.getStatus());
  };
  it('picks the right effect', () => {
    expect(last(play('e4'))).toBe('move');
    expect(last(play('e4', 'd5', 'exd5'))).toBe('capture');
    expect(last(play('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O'))).toBe('castle');
    expect(last(play('e4', 'f6', 'Qh5+'))).toBe('check');
    expect(last(play('f3', 'e5', 'g4', 'Qh4#'))).toBe('end');
  });
  it('plays the promotion sound', () => {
    const r = ChessGame.fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    if (!r.ok) throw new Error('fen');
    r.value.makeMoveUci('a7a8q');
    expect(last(r.value)).toBe('promote');
  });
});
