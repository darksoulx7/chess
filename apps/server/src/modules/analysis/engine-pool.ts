import {
  EngineError,
  type AnalysisRequest,
  type AnalysisResult,
  type EngineService,
} from '@chess/engine';

interface Waiter {
  resolve: (engine: EngineService) => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * Fixed-size pool of engines. Requests wait for a free engine; when too many are queued the pool
 * sheds load with `EngineError('busy')` instead of letting latency grow without bound.
 */
export class EnginePool implements EngineService {
  private free: EngineService[];
  private waiters: Waiter[] = [];
  private disposed = false;

  constructor(
    private readonly engines: EngineService[],
    private readonly maxQueue = 20,
  ) {
    if (engines.length === 0) throw new RangeError('pool needs at least one engine');
    this.free = [...engines];
  }

  get size(): number {
    return this.engines.length;
  }

  get queued(): number {
    return this.waiters.length;
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const engine = await this.acquire(request.signal);
    try {
      return await engine.analyze(request);
    } finally {
      this.release(engine);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const w of this.waiters.splice(0))
      w.reject(new EngineError('unavailable', 'pool disposed'));
    await Promise.all(this.engines.map((e) => e.dispose()));
  }

  private acquire(signal?: AbortSignal): Promise<EngineService> {
    if (this.disposed) return Promise.reject(new EngineError('unavailable', 'pool disposed'));
    if (signal?.aborted) return Promise.reject(new EngineError('aborted'));
    const engine = this.free.pop();
    if (engine) return Promise.resolve(engine);
    if (this.waiters.length >= this.maxQueue)
      return Promise.reject(new EngineError('busy', 'engine queue is full'));

    return new Promise<EngineService>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (signal) {
        waiter.signal = signal;
        waiter.onAbort = () => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          reject(new EngineError('aborted'));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  private release(engine: EngineService): void {
    const next = this.waiters.shift();
    if (next) {
      if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort);
      next.resolve(engine);
    } else {
      this.free.push(engine);
    }
  }
}
