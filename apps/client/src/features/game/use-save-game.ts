import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { errorText } from '../../services/error-text';
import { useAuth } from '../auth/auth-store';
import { useGame } from './game-store';
import { buildSavePayload } from './save-payload';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Record {
  gameId: string;
  state: 'saved' | 'error' | 'retry';
  error: string | null;
}

/**
 * Saves a finished game to the signed-in user's history exactly once per game (idempotent on the server
 * by clientId, so a retry after a lost response cannot duplicate it).
 * The outcome is stored per game id, so a new game starts clean without resetting state in an effect.
 */
export function useAutoSaveGame(over: boolean): {
  state: SaveState;
  error: string | null;
  retry: () => void;
} {
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const gameId = useGame((s) => s.gameId);
  const qc = useQueryClient();
  const [record, setRecord] = useState<Record | null>(null);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef<string | null>(null);

  const mine = record?.gameId === gameId ? record : null;
  const settled = mine?.state === 'saved' || mine?.state === 'error';

  useEffect(() => {
    if (!over || !signedIn || settled || inFlight.current === `${gameId}:${attempt}`) return;
    const s = useGame.getState();
    const payload = buildSavePayload({
      game: s.game,
      override: s.override,
      mode: s.mode,
      humanColor: s.humanColor,
      botRating: s.botRating,
      clock: s.clockConfig,
      clientId: s.gameId,
    });
    if (!payload) return;
    inFlight.current = `${gameId}:${attempt}`;
    api('/api/games', { method: 'POST', body: payload })
      .then(() => {
        setRecord({ gameId, state: 'saved', error: null });
        void qc.invalidateQueries({ queryKey: ['games'] });
        void qc.invalidateQueries({ queryKey: ['stats'] });
      })
      .catch((err) =>
        setRecord({ gameId, state: 'error', error: errorText(err, 'Could not save this game.') }),
      );
  }, [over, signedIn, settled, gameId, attempt, qc]);

  const retry = useCallback(() => {
    setRecord({ gameId, state: 'retry', error: null });
    setAttempt((n) => n + 1);
  }, [gameId]);

  // "saving" is derived: the game is over, the user is signed in, and no result has come back yet.
  const state: SaveState =
    !over || !signedIn
      ? 'idle'
      : mine?.state === 'saved'
        ? 'saved'
        : mine?.state === 'error'
          ? 'error'
          : 'saving';
  return { state, error: mine?.state === 'error' ? mine.error : null, retry };
}
