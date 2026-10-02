import { ChessGame } from '@chess/chess-core';
import { describe, expect, it } from 'vitest';
import { uuidv4 } from '../../services/uuid';
import { buildSavePayload, type FinishedGame } from './save-payload';

const game = (...sans: string[]) => {
  const g = ChessGame.create();
  for (const s of sans) if (!g.makeMoveSan(s).ok) throw new Error(`illegal ${s}`);
  return g;
};
const base = (g: ChessGame, extra: Partial<FinishedGame> = {}): FinishedGame => ({
  game: g,
  override: null,
  mode: 'BOT',
  humanColor: 'w',
  botRating: 1200,
  clock: null,
  clientId: 'cid',
  ...extra,
});

describe('buildSavePayload', () => {
  it('maps checkmate to the winner and includes bot settings', () => {
    const p = buildSavePayload(
      base(game('f3', 'e5', 'g4', 'Qh4#'), { humanColor: 'b', botRating: 800 }),
    );
    expect(p).toMatchObject({
      clientId: 'cid',
      mode: 'BOT',
      result: '0-1',
      termination: 'checkmate',
      humanColor: 'b',
      botRating: 800,
    });
    expect(p?.pgn).toContain('1. f3 e5 2. g4 Qh4#');
    expect(p?.pgn).toContain('[Result "0-1"]');
  });

  it('maps rule draws', () => {
    const stalemate = game(
      'e3',
      'a5',
      'Qh5',
      'Ra6',
      'Qxa5',
      'h5',
      'h4',
      'Rah6',
      'Qxc7',
      'f6',
      'Qxd7+',
      'Kf7',
      'Qxb7',
      'Qd3',
      'Qxb8',
      'Qh7',
      'Qxc8',
      'Kg6',
      'Qe6',
    );
    expect(buildSavePayload(base(stalemate))).toMatchObject({
      result: '1/2-1/2',
      termination: 'stalemate',
    });
    const rep = game('Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8');
    expect(buildSavePayload(base(rep))).toMatchObject({
      result: '1/2-1/2',
      termination: 'threefold-repetition',
    });
  });

  it('maps resignation / timeout (the loser gives the opponent the win) and agreement', () => {
    const g = game('e4', 'e5');
    expect(buildSavePayload(base(g, { override: { kind: 'resign', loser: 'w' } }))).toMatchObject({
      result: '0-1',
      termination: 'resignation',
    });
    expect(buildSavePayload(base(g, { override: { kind: 'resign', loser: 'b' } }))).toMatchObject({
      result: '1-0',
      termination: 'resignation',
    });
    expect(buildSavePayload(base(g, { override: { kind: 'timeout', loser: 'b' } }))).toMatchObject({
      result: '1-0',
      termination: 'timeout',
    });
    expect(
      buildSavePayload(base(g, { mode: 'LOCAL', override: { kind: 'agreement' } })),
    ).toMatchObject({ result: '1/2-1/2', termination: 'agreement' });
  });

  it('omits bot fields for local games and includes the clock', () => {
    const p = buildSavePayload(
      base(game('e4', 'e5'), {
        mode: 'LOCAL',
        override: { kind: 'agreement' },
        clock: { initialMs: 180000, incrementMs: 2000 },
      }),
    );
    expect(p).not.toHaveProperty('humanColor');
    expect(p).not.toHaveProperty('botRating');
    expect(p?.clock).toEqual({ baseMs: 180000, incrementMs: 2000 });
  });

  it('returns null for unfinished games and games without moves', () => {
    expect(buildSavePayload(base(game('e4', 'e5')))).toBeNull();
    expect(
      buildSavePayload(base(ChessGame.create(), { override: { kind: 'resign', loser: 'w' } })),
    ).toBeNull();
  });
});

describe('uuidv4', () => {
  it('produces valid, unique v4 UUIDs', () => {
    const ids = new Set(Array.from({ length: 200 }, uuidv4));
    expect(ids.size).toBe(200);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
