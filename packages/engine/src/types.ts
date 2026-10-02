/** Engine score from the side to move's point of view. */
export type Score = { type: 'cp'; value: number } | { type: 'mate'; value: number };

export interface SearchLimits {
  depth?: number;
  nodes?: number;
  movetimeMs?: number;
}

export interface EngineLine {
  /** 1-based rank among the lines of this search. */
  multipv: number;
  depth: number;
  score: Score;
  /** Principal variation in UCI notation. */
  pv: string[];
  nodes?: number;
}

export interface AnalysisRequest {
  fen: string;
  limits: SearchLimits;
  /** Number of lines to compute (default 1). */
  multiPv?: number;
  /** Aborting stops the search promptly and rejects with an `EngineError('aborted')`. */
  signal?: AbortSignal;
}

export interface AnalysisResult {
  /** Best line per multipv index, sorted best first. */
  lines: EngineLine[];
  bestMove: string | null;
}

export type EngineErrorCode =
  'aborted' | 'timeout' | 'unavailable' | 'crashed' | 'busy' | 'invalid-request';

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'EngineError';
  }
}

/**
 * Chess engine abstraction. Implementations (native process on the server, remote over HTTP in the
 * client, a WASM worker later) are interchangeable; nothing above this interface knows which one is used.
 */
export interface EngineService {
  analyze(request: AnalysisRequest): Promise<AnalysisResult>;
  dispose(): Promise<void>;
}
