import { ChessGame, type MoveRecord } from '@chess/chess-core';
import type { GameResultCode, Termination } from '@chess/game-types';
import { getOpeningIndex, identifyOpening } from '@chess/openings';

export interface SubmittedGame {
  mode: 'BOT' | 'LOCAL';
  pgn: string;
  result: GameResultCode;
  termination: Termination;
  humanColor?: 'w' | 'b' | undefined;
  botRating?: number | undefined;
}

export interface ValidatedGame {
  game: ChessGame;
  moves: MoveRecord[];
  initialFen: string;
  finalFen: string;
  opening: { id: string; name: string; eco: string } | null;
}

const RULE_RESULT: Record<string, Termination> = {
  stalemate: 'stalemate',
  'insufficient-material': 'insufficient-material',
  'threefold-repetition': 'threefold-repetition',
  'fifty-move-rule': 'fifty-move-rule',
};

/**
 * Parses the PGN and checks that the claimed result/termination agree with the actual position.
 * Games from BOT/LOCAL play are client-reported (not authoritative), so the server accepts only what
 * is internally consistent: legal moves, and a result that the board (or a plausible resignation,
 * timeout or agreement) can explain. Returns an error message for the 400 response otherwise.
 */
export function validateSubmittedGame(
  input: SubmittedGame,
): { ok: true; value: ValidatedGame } | { ok: false; message: string } {
  const parsed = ChessGame.fromPgn(input.pgn);
  if (!parsed.ok)
    return {
      ok: false,
      message:
        parsed.error === 'input-too-large' ? 'PGN is too large.' : 'PGN is not a valid game.',
    };
  const game = parsed.value;
  const moves = game.getHistory();
  if (moves.length === 0) return { ok: false, message: 'A game needs at least one move.' };

  if (input.mode === 'BOT' && input.botRating === undefined)
    return { ok: false, message: 'Bot games need a bot rating.' };
  if (input.mode === 'LOCAL' && (input.botRating !== undefined || input.humanColor !== undefined)) {
    return { ok: false, message: 'Local games cannot have bot settings.' };
  }

  const status = game.getStatus();
  if (status.state === 'checkmate') {
    const expected: GameResultCode = status.winner === 'w' ? '1-0' : '0-1';
    if (input.result !== expected || input.termination !== 'checkmate')
      return { ok: false, message: 'Result does not match the checkmate on the board.' };
  } else if (status.state === 'draw') {
    if (input.result !== '1/2-1/2' || input.termination !== RULE_RESULT[status.reason]) {
      return { ok: false, message: 'Result does not match the drawn position on the board.' };
    }
  } else {
    if (!['resignation', 'timeout', 'agreement', 'abandoned'].includes(input.termination)) {
      return {
        ok: false,
        message:
          'The game is not over on the board, so it must end by resignation, timeout, agreement or abandonment.',
      };
    }
    if (input.termination === 'agreement' && input.result !== '1/2-1/2')
      return { ok: false, message: 'An agreed draw must be a draw.' };
    if (
      (input.termination === 'resignation' || input.termination === 'timeout') &&
      input.result === '1/2-1/2'
    ) {
      return { ok: false, message: 'A resignation or timeout cannot be a draw.' };
    }
    if (input.mode === 'BOT' && input.termination === 'agreement')
      return { ok: false, message: 'Bots do not agree to draws.' };
  }

  const match = identifyOpening(
    getOpeningIndex(),
    moves.map((m) => m.lan),
  );
  return {
    ok: true,
    value: {
      game,
      moves,
      initialFen: game.getInitialFen(),
      finalFen: game.getFen(),
      opening: match
        ? { id: match.opening.id, name: match.opening.name, eco: match.opening.eco }
        : null,
    },
  };
}
