import { useEffect } from 'react';
import { BOT_ERROR_TEXT, BotApiError, requestBotMove } from '../../services/bot-api';
import { useGame } from './game-store';

/** Natural-feeling minimum thinking time so instant replies do not look robotic. */
const MIN_THINK_MS = 350;

/**
 * Drives the bot side of a BOT game: when it is the bot's turn, asks the server for a move,
 * cancels in-flight requests when the position changes or the screen unmounts, and reports
 * failures through the store so the UI can offer a retry.
 */
export function useBotDriver(fen: string, turn: 'w' | 'b', isOver: boolean): void {
  const mode = useGame((s) => s.mode);
  const humanColor = useGame((s) => s.humanColor);
  const rating = useGame((s) => s.botRating);
  const gameSeed = useGame((s) => s.gameSeed);
  const retry = useGame((s) => s.botRetry);
  const hasClockFlagged = useGame((s) => s.override !== null);

  useEffect(() => {
    if (mode !== 'BOT' || isOver || hasClockFlagged || rating === null || turn === humanColor)
      return;

    const controller = new AbortController();
    const { setBotStatus, applyBotMove } = useGame.getState();
    setBotStatus('thinking');
    const started = Date.now();
    // Different seed per position so repeated positions are not played identically across a game.
    const seed = (gameSeed + fen.length * 7919 + Math.floor(Date.now() / 1000)) >>> 0;

    void (async () => {
      try {
        const reply = await requestBotMove({ fen, targetRating: rating, seed }, controller.signal);
        const wait = MIN_THINK_MS - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (controller.signal.aborted) return;
        if (!applyBotMove(reply.move, fen))
          setBotStatus('error', 'The bot returned an invalid move.');
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError'))
          return;
        const code = err instanceof BotApiError ? err.code : 'unavailable';
        setBotStatus('error', BOT_ERROR_TEXT[code]);
      }
    })();

    return () => controller.abort();
  }, [mode, isOver, hasClockFlagged, rating, turn, humanColor, fen, gameSeed, retry]);
}
