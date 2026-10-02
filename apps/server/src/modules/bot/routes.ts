import { ChessGame } from '@chess/chess-core';
import {
  EngineError,
  MAX_BOT_RATING,
  MIN_BOT_RATING,
  buildBotProfile,
  chooseBotMove,
  type EngineService,
} from '@chess/engine';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

const bodySchema = z.object({
  fen: z.string().min(1).max(100),
  targetRating: z.number().int().min(MIN_BOT_RATING).max(MAX_BOT_RATING),
  seed: z.number().int().min(0).max(0xffffffff).optional(),
});

export interface BotRouteDeps {
  engine: EngineService;
  rateLimitMax: number;
}

function sendEngineError(reply: FastifyReply, err: EngineError) {
  switch (err.code) {
    case 'invalid-request':
      return reply.code(400).send({ error: 'invalid_request', message: err.message });
    case 'busy':
      return reply.code(503).header('retry-after', '2').send({ error: 'engine_busy' });
    case 'timeout':
      return reply.code(504).send({ error: 'engine_timeout' });
    case 'aborted':
      return reply; // client went away; nothing to send
    default:
      return reply.code(503).send({ error: 'engine_unavailable' });
  }
}

export function registerBotRoutes(app: FastifyInstance, deps: BotRouteDeps): void {
  app.post(
    '/api/bot/move',
    { config: { rateLimit: { max: deps.rateLimitMax, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', issues: parsed.error.issues.map((i) => i.message) });
      }
      const { fen, targetRating, seed } = parsed.data;

      // Cancel the search if the client disconnects before we answer (e.g. the user starts a new game).
      // Watch the *response*: `req.raw` emits 'close' as soon as the body is read (Node >= 16), which
      // would cancel every search immediately.
      const abort = new AbortController();
      const onClose = () => {
        if (!reply.raw.writableEnded) abort.abort();
      };
      reply.raw.once('close', onClose);

      const startedAt = Date.now();
      try {
        const move = await chooseBotMove({
          fen,
          profile: buildBotProfile(targetRating),
          engine: deps.engine,
          signal: abort.signal,
          ...(seed !== undefined ? { seed } : {}),
        });
        const loaded = ChessGame.fromFen(fen);
        const san = loaded.ok
          ? loaded.value.makeMoveUci(move.move).ok
            ? loaded.value.getLastMove()?.san
            : undefined
          : undefined;
        return reply.send({
          move: move.move,
          san,
          quality: move.quality,
          thinkMs: Date.now() - startedAt,
        });
      } catch (err) {
        if (err instanceof EngineError) {
          req.log.warn({ code: err.code }, 'bot move failed');
          return sendEngineError(reply, err);
        }
        throw err;
      } finally {
        reply.raw.off('close', onClose);
      }
    },
  );
}
