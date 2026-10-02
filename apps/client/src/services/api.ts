import { getApiUrl } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body?: unknown,
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }
}

export interface AuthHooks {
  /** Current access token, if signed in. */
  getAccessToken(): string | null;
  /** Obtains a new access token (refreshing if needed). Resolves null when the session is gone. */
  refreshAccessToken(): Promise<string | null>;
}

let hooks: AuthHooks | null = null;
export function setAuthHooks(h: AuthHooks | null): void {
  hooks = h;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the Authorization header (login/register/refresh). */
  anonymous?: boolean;
  fetchImpl?: typeof fetch;
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    return await doFetch(`${getApiUrl()}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network');
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('json') ? await res.json() : await res.text()) as T;
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new ApiError(res.status, body?.error ?? `http_${res.status}`, body);
}

/**
 * JSON request with automatic session handling: a 401 triggers one token refresh and one retry.
 * If the refresh fails the 401 is surfaced (the auth store then signs the user out).
 */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = opts.anonymous ? null : (hooks?.getAccessToken() ?? null);
  let res = await send(path, opts, token);
  if (res.status === 401 && !opts.anonymous && hooks) {
    const fresh = await hooks.refreshAccessToken();
    if (fresh) res = await send(path, opts, fresh);
  }
  return parse<T>(res);
}
