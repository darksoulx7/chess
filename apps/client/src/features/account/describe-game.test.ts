import type { GameSummary } from '@chess/game-types';
import { describe, expect, it } from 'vitest';
import { describeGame } from './describe-game';

const game = (over: Partial<GameSummary> = {}): GameSummary => ({
  id: '1',
  mode: 'BOT',
  result: '1-0',
  termination: 'checkmate',
  endedAt: '2026-10-02T12:00:00.000Z',
  plyCount: 41,
  botRating: 1600,
  openingName: 'Italian Game: Giuoco Piano',
  eco: 'C50',
  timeBaseMs: null,
  timeIncrementMs: null,
  myColor: 'w',
  players: [
    { color: 'w', name: 'alice', isBot: false, botRating: null },
    { color: 'b', name: 'Bot 1600', isBot: true, botRating: 1600 },
  ],
  ...over,
});

describe('describeGame', () => {
  it("labels wins and losses from the player's own colour", () => {
    expect(describeGame(game()).badge).toBe('Win');
    expect(describeGame(game({ result: '0-1' })).badge).toBe('Loss');
    expect(describeGame(game({ result: '0-1', myColor: 'b' })).badge).toBe('Win');
    expect(describeGame(game({ result: '1/2-1/2' })).badge).toBe('Draw');
  });
  it('names the opponent and summarises the game', () => {
    const d = describeGame(game());
    expect(d.title).toBe('vs Bot 1600');
    expect(d.detail).toContain('C50 Italian Game: Giuoco Piano');
    expect(d.detail).toContain('21 moves');
    expect(d.detail).toContain('checkmate');
  });
  it('handles local games, unfinished games and missing metadata', () => {
    expect(describeGame(game({ mode: 'LOCAL', myColor: null })).title).toBe('Local game');
    expect(describeGame(game({ mode: 'LOCAL', myColor: null })).badge).toBe('1-0');
    expect(describeGame(game({ result: '*' })).badge).toBe('—');
    const bare = describeGame(
      game({ openingName: null, eco: null, termination: null, endedAt: null }),
    );
    expect(bare.detail).toBe('21 moves');
  });
});
