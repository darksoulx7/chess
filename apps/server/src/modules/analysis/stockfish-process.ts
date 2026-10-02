import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  EngineError,
  buildGoCommand,
  parseBestMove,
  parseInfoLine,
  type AnalysisRequest,
  type AnalysisResult,
  type EngineLine,
  type EngineService,
} from '@chess/engine';

export interface StockfishOptions {
  /** Path or command name of the Stockfish binary. */
  path: string;
  hashMb?: number;
  /** Extra time allowed beyond the search limits before a search is force-stopped. */
  graceMs?: number;
  /** Fallback wall-clock cap for searches without a movetime limit. */
  maxSearchMs?: number;
  onLog?: (message: string, extra?: Record<string, unknown>) => void;
}

const STARTUP_TIMEOUT_MS = 8_000;
const STOP_TIMEOUT_MS = 1_500;

/**
 * One Stockfish process spoken to over UCI. Searches are serialized. The process is started lazily
 * and restarted after a crash or a forced kill, so one bad search never takes the service down.
 */
export class StockfishProcess implements EngineService {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(line: string) => void>();
  private currentMultiPv = 1;
  private disposed = false;

  constructor(private readonly options: StockfishOptions) {}

  analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    if (this.disposed) return Promise.reject(new EngineError('unavailable', 'engine disposed'));
    const run = this.queue.then(() => this.search(request));
    // Keep the chain alive regardless of this search's outcome.
    this.queue = run.catch(() => undefined);
    return run;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    try {
      proc.stdin.write('quit\n');
    } catch {
      /* already gone */
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 500);
      proc.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  // ---- internals ----

  private send(command: string): void {
    if (!this.proc) throw new EngineError('crashed', 'engine not running');
    this.proc.stdin.write(`${command}\n`);
  }

  /** Resolves when `predicate` matches an output line. */
  private waitFor(
    predicate: (line: string) => boolean,
    timeoutMs: number,
    onLine?: (line: string) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new EngineError('timeout', 'engine did not respond in time'));
      }, timeoutMs);
      const listener = (line: string) => {
        onLine?.(line);
        if (predicate(line)) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(line);
        }
      };
      this.listeners.add(listener);
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.proc) return;
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    await this.starting;
  }

  private async start(): Promise<void> {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(this.options.path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      throw new EngineError('unavailable', `cannot start engine: ${String(err)}`);
    }

    const spawnFailed = new Promise<never>((_, reject) => {
      proc.once('error', (err) =>
        reject(new EngineError('unavailable', `cannot start engine: ${err.message}`)),
      );
    });

    createInterface({ input: proc.stdout }).on('line', (line) => {
      for (const l of [...this.listeners]) l(line);
    });
    proc.stderr.on('data', (d: Buffer) =>
      this.options.onLog?.('stockfish stderr', { data: d.toString().slice(0, 200) }),
    );
    proc.once('exit', (code, signal) => {
      if (this.proc === proc) this.proc = null;
      this.options.onLog?.('stockfish exited', { code, signal });
      // Wake anything waiting so it can fail fast instead of timing out.
      for (const l of [...this.listeners]) l('__exit__');
    });

    this.proc = proc;
    this.currentMultiPv = 1;
    try {
      this.send('uci');
      await Promise.race([
        this.waitFor((l) => l === 'uciok' || l === '__exit__', STARTUP_TIMEOUT_MS),
        spawnFailed,
      ]);
      if (!this.proc) throw new EngineError('crashed', 'engine exited during startup');
      this.send('setoption name Threads value 1');
      this.send(`setoption name Hash value ${this.options.hashMb ?? 16}`);
      this.send('isready');
      await this.waitFor((l) => l === 'readyok' || l === '__exit__', STARTUP_TIMEOUT_MS);
      if (!this.proc) throw new EngineError('crashed', 'engine exited during startup');
    } catch (err) {
      this.kill();
      throw err instanceof EngineError ? err : new EngineError('unavailable', String(err));
    }
  }

  private kill(): void {
    const p = this.proc;
    this.proc = null;
    p?.kill('SIGKILL');
  }

  private async search(request: AnalysisRequest): Promise<AnalysisResult> {
    const { fen, limits, signal } = request;
    const multiPv = Math.max(1, Math.min(20, request.multiPv ?? 1));
    if (signal?.aborted) throw new EngineError('aborted');
    if (!/^[\w/\-\s.]+$/.test(fen) || fen.length > 100)
      throw new EngineError('invalid-request', 'invalid FEN');

    await this.ensureStarted();
    if (signal?.aborted) throw new EngineError('aborted');

    const lines = new Map<number, EngineLine>();
    const hardLimitMs =
      (limits.movetimeMs ?? this.options.maxSearchMs ?? 15_000) + (this.options.graceMs ?? 4_000);

    try {
      if (multiPv !== this.currentMultiPv) {
        this.send(`setoption name MultiPV value ${multiPv}`);
        this.currentMultiPv = multiPv;
      }
      this.send('ucinewgame');
      this.send('isready');
      await this.waitFor((l) => l === 'readyok' || l === '__exit__', STARTUP_TIMEOUT_MS);
      if (!this.proc) throw new EngineError('crashed', 'engine exited');

      this.send(`position fen ${fen}`);
      const bestPromise = this.waitFor(
        (l) => l.startsWith('bestmove') || l === '__exit__',
        hardLimitMs,
        (l) => {
          const info = parseInfoLine(l);
          if (info) lines.set(info.multipv, info);
        },
      );
      this.send(buildGoCommand(limits));

      let aborted = false;
      const onAbort = () => {
        aborted = true;
        try {
          this.send('stop');
        } catch {
          /* process gone */
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      let bestLine: string;
      try {
        bestLine = await bestPromise;
      } catch (err) {
        // Timed out: ask the engine to stop, and if it does not comply, kill it.
        try {
          this.send('stop');
          await this.waitFor((l) => l.startsWith('bestmove') || l === '__exit__', STOP_TIMEOUT_MS);
        } catch {
          this.kill();
        }
        throw err;
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }

      if (bestLine === '__exit__') throw new EngineError('crashed', 'engine exited during search');
      if (aborted) throw new EngineError('aborted');

      const best = parseBestMove(bestLine);
      return {
        lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv),
        bestMove: best?.move ?? null,
      };
    } catch (err) {
      if (err instanceof EngineError) throw err;
      throw new EngineError('crashed', String(err));
    }
  }
}
