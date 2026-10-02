import { ChessGame } from '@chess/chess-core';
import { EngineError, type AnalysisResult, type EngineService } from '@chess/engine';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { analysisCacheKey, type AnalysisCache } from './cache.js';

const MAX_DEPTH = 22;
const SAN_PLIES = 10;

const bodySchema = z.object({
  fen: z.string().min(1).max(100),
  depth: z.number().int().min(1).max(MAX_DEPTH).default(12),
  multiPv: z.number().int().min(1).max(5).default(1),
});

export interface AnalysisRouteDeps {
  engine: EngineService;
  cache?: AnalysisCache;
  rateLimitMax: number;
  /** Wall-clock cap per search; results are whatever the engine reached by then. */
  maxSearchMs: number;
  onCacheError?: (err: unknown) => void;
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
      return reply;
    default:
      return reply.code(503).send({ error: 'engine_unavailable' });
  }
}

/** PV in SAN, replayed from `fen`; stops at the first move that does not apply. */
function pvToSan(fen: string, pv: readonly string[]): string[] {
  const loaded = ChessGame.fromFen(fen);
  if (!loaded.ok) return [];
  const out: string[] = [];
  for (const uci of pv.slice(0, SAN_PLIES)) {
    const r = loaded.value.makeMoveUci(uci);
    if (!r.ok) break;
    out.push(r.value.san);
  }
  return out;
}

export function registerAnalysisRoutes(app: FastifyInstance, deps: AnalysisRouteDeps): void {
  app.post(
    '/api/analysis/position',
    { config: { rateLimit: { max: deps.rateLimitMax, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', issues: parsed.error.issues.map((i) => i.message) });
      }
      const { fen, depth, multiPv } = parsed.data;

      const loaded = ChessGame.fromFen(fen);
      if (!loaded.ok)
        return reply.code(400).send({ error: 'invalid_request', message: 'invalid FEN' });

      // Finished positions need no engine: report the result directly.
      const status = loaded.value.getStatus();
      if (status.state !== 'active') {
        return reply.send({
          fen,
          depth: 0,
          lines: [],
          bestMove: null,
          terminal: status,
          cached: false,
        });
      }

      const key = analysisCacheKey({ fen, depth, multiPv, maxMs: deps.maxSearchMs });
      const hit = await deps.cache?.get(key);
      if (hit) {
        return reply.send({
          fen,
          depth: Math.max(0, ...hit.lines.map((l) => l.depth)),
          ...withSan(fen, hit),
          cached: true,
        });
      }

      // Cancel the search if the client disconnects before we answer (watch the response, not the request).
      const abort = new AbortController();
      const onClose = () => {
        if (!reply.raw.writableEnded) abort.abort();
      };
      reply.raw.once('close', onClose);
      try {
        const result = await deps.engine.analyze({
          fen,
          limits: { depth, movetimeMs: deps.maxSearchMs },
          multiPv,
          signal: abort.signal,
        });
        await deps.cache?.set(key, result);
        return reply.send({
          fen,
          depth: Math.max(0, ...result.lines.map((l) => l.depth)),
          ...withSan(fen, result),
          cached: false,
        });
      } catch (err) {
        if (err instanceof EngineError) {
          req.log.warn({ code: err.code }, 'analysis failed');
          return sendEngineError(reply, err);
        }
        throw err;
      } finally {
        reply.raw.off('close', onClose);
      }
    },
  );
}

function withSan(fen: string, result: AnalysisResult) {
  return {
    bestMove: result.bestMove,
    lines: result.lines.map((l) => ({ ...l, san: pvToSan(fen, l.pv) })),
  };
}
