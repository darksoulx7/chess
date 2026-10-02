import { beforeEach, describe, expect, it } from 'vitest';
import { useGame } from './game-store';

const s = () => useGame.getState();
const move = (from: string, to: string) => s().makeMove({ from: from as never, to: to as never });

beforeEach(() => {
  s().startGame({ mode: 'LOCAL', clock: null });
});

describe('BOT mode', () => {
  it('orients the board to the human colour and records bot settings', () => {
    s().startGame({ mode: 'BOT', clock: null, humanColor: 'b', botRating: 1600 });
    expect(s().orientation).toBe('b');
    expect(s().humanColor).toBe('b');
    expect(s().botRating).toBe(1600);
  });

  it('applies a bot move only for the position it was computed for', () => {
    s().startGame({ mode: 'BOT', clock: null, humanColor: 'w', botRating: 1200 });
    const staleFen = s().game.getFen();
    expect(move('e2', 'e4').ok).toBe(true);
    const fenForBot = s().game.getFen();
    // A reply computed for an old position (e.g. before undo / new game) is discarded.
    expect(s().applyBotMove('e7e5', staleFen)).toBe(false);
    expect(s().game.getHistory()).toHaveLength(1);
    expect(s().applyBotMove('e7e5', fenForBot)).toBe(true);
    expect(
      s()
        .game.getHistory()
        .map((m) => m.san),
    ).toEqual(['e4', 'e5']);
  });

  it('rejects illegal bot moves without changing the game', () => {
    s().startGame({ mode: 'BOT', clock: null, humanColor: 'w', botRating: 1200 });
    move('e2', 'e4');
    const fen = s().game.getFen();
    expect(s().applyBotMove('e7e3', fen)).toBe(false);
    expect(s().applyBotMove('garbage', fen)).toBe(false);
    expect(s().game.getFen()).toBe(fen);
  });

  it('ignores bot moves after the game was resigned or in LOCAL mode', () => {
    s().startGame({ mode: 'BOT', clock: null, humanColor: 'w', botRating: 1200 });
    move('e2', 'e4');
    const fen = s().game.getFen();
    s().resign('w');
    expect(s().applyBotMove('e7e5', fen)).toBe(false);
    s().startGame({ mode: 'LOCAL', clock: null });
    expect(s().applyBotMove('e2e4', s().game.getFen())).toBe(false);
  });

  it('undo takes back the bot reply and the human move together', () => {
    s().startGame({ mode: 'BOT', clock: null, humanColor: 'w', botRating: 1200 });
    move('e2', 'e4');
    s().applyBotMove('e7e5', s().game.getFen());
    move('g1', 'f3');
    s().applyBotMove('b8c6', s().game.getFen());
    s().undo();
    expect(
      s()
        .game.getHistory()
        .map((m) => m.san),
    ).toEqual(['e4', 'e5']);
    expect(s().game.turn()).toBe('w');
  });

  it("undo is unavailable while the bot is thinking or when it is the bot's turn", () => {
    s().startGame({ mode: 'BOT', clock: null, humanColor: 'w', botRating: 1200 });
    move('e2', 'e4'); // bot to move
    s().undo();
    expect(s().game.getHistory()).toHaveLength(1);
  });

  it('never accepts a draw by agreement against the bot', () => {
    s().startGame({ mode: 'BOT', clock: null, humanColor: 'w', botRating: 1200 });
    s().agreeDraw();
    expect(s().override).toBeNull();
  });

  it('a human playing black leaves the bot to open', () => {
    s().startGame({ mode: 'BOT', clock: null, humanColor: 'b', botRating: 800 });
    expect(s().game.turn()).toBe('w');
    expect(move('e7', 'e5').ok).toBe(false); // black cannot move first
  });
});

describe('clocks in games', () => {
  it('settles the clock on bot moves and stops it at game end', () => {
    s().startGame({
      mode: 'BOT',
      clock: { initialMs: 60_000, incrementMs: 0 },
      humanColor: 'w',
      botRating: 1200,
    });
    s().makeMove({ from: 'e2', to: 'e4' }, 1000);
    expect(s().clock?.running).toBe('b');
    s().applyBotMove('e7e5', s().game.getFen(), 3000);
    expect(s().clock?.running).toBe('w');
    expect(s().clock?.blackMs).toBe(58_000); // black used 2s of its own time
  });

  it('timeout ends the game and rejects late moves', () => {
    s().startGame({ mode: 'LOCAL', clock: { initialMs: 5_000, incrementMs: 0 } });
    s().makeMove({ from: 'e2', to: 'e4' }, 0);
    const late = s().makeMove({ from: 'e7', to: 'e5' }, 6_000);
    expect(late.ok).toBe(false);
    expect(s().override).toEqual({ kind: 'timeout', loser: 'b' });
  });
});
