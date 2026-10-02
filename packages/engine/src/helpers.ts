import type { EngineLine, EngineService, Score, SearchLimits } from './types';

/** Convenience wrappers over `EngineService.analyze` (names mirror the engine abstraction in the spec). */
export async function getBestMove(
  engine: EngineService,
  fen: string,
  limits: SearchLimits,
  signal?: AbortSignal,
): Promise<string | null> {
  const r = await engine.analyze({ fen, limits, ...(signal ? { signal } : {}) });
  return r.bestMove ?? r.lines[0]?.pv[0] ?? null;
}

export async function getEvaluation(
  engine: EngineService,
  fen: string,
  limits: SearchLimits,
  signal?: AbortSignal,
): Promise<Score | null> {
  const r = await engine.analyze({ fen, limits, ...(signal ? { signal } : {}) });
  return r.lines[0]?.score ?? null;
}

export async function getPrincipalVariation(
  engine: EngineService,
  fen: string,
  limits: SearchLimits,
  signal?: AbortSignal,
): Promise<EngineLine | null> {
  const r = await engine.analyze({ fen, limits, ...(signal ? { signal } : {}) });
  return r.lines[0] ?? null;
}
