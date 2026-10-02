import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config', () => ({ getApiUrl: () => 'http://api.test' }));
// react-native ships Flow-typed source that Node cannot parse; the store only needs Platform.OS.
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
import { ApiError, api } from '../../services/api';
import { MemoryTokenStorage } from '../../services/token-storage';
import { __resetAuthForTests, setTokenStorage, useAuth } from './auth-store';

const user = {
  id: 'u1',
  email: 'a@b.co',
  username: 'alice',
  avatar: 'knight',
  createdAt: '2026-01-01T00:00:00Z',
};
const authBody = (n: number) => ({
  user,
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  expiresIn: 900,
});
const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

let store: MemoryTokenStorage;
let calls: Array<{ url: string; init: RequestInit }>;
function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
}
const bodyOf = (c: { init: RequestInit }) => JSON.parse(c.init.body as string);
const authHeader = (c: { init: RequestInit }) =>
  (c.init.headers as Record<string, string>).authorization;

beforeEach(() => {
  store = new MemoryTokenStorage();
  setTokenStorage(store);
  __resetAuthForTests();
});

describe('login / register / logout', () => {
  it('login stores the refresh token and keeps the access token in memory', async () => {
    mockFetch(() => json(200, authBody(1)));
    await useAuth.getState().login('alice', 'pw');
    expect(useAuth.getState()).toMatchObject({ status: 'signedIn', user, accessToken: 'access-1' });
    expect(store.value).toBe('refresh-1');
    expect(bodyOf(calls[0]!)).toEqual({ identifier: 'alice', password: 'pw' });
    expect(authHeader(calls[0]!)).toBeUndefined(); // anonymous
  });

  it('register signs in; failures leave the user signed out and surface the error code', async () => {
    mockFetch(() => json(409, { error: 'email_taken' }));
    await expect(
      useAuth.getState().register({ email: 'a@b.co', username: 'alice', password: 'x'.repeat(12) }),
    ).rejects.toMatchObject({ code: 'email_taken', status: 409 });
    expect(useAuth.getState().status).toBe('loading');
    expect(store.value).toBeNull();
    mockFetch(() => json(201, authBody(1)));
    await useAuth
      .getState()
      .register({ email: 'a@b.co', username: 'alice', password: 'x'.repeat(12) });
    expect(useAuth.getState().status).toBe('signedIn');
  });

  it('logout clears local state first, then tells the server (and tolerates it being down)', async () => {
    mockFetch(() => json(200, authBody(1)));
    await useAuth.getState().login('alice', 'pw');
    mockFetch(() => Promise.reject(new TypeError('offline')));
    await useAuth.getState().logout();
    expect(useAuth.getState()).toMatchObject({
      status: 'signedOut',
      user: null,
      accessToken: null,
    });
    expect(store.value).toBeNull();
  });
});

describe('init (restoring a session)', () => {
  it('goes signed out without a stored token and makes no request', async () => {
    mockFetch(() => json(200, {}));
    await useAuth.getState().init();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(calls).toHaveLength(0);
  });

  it('refreshes with the stored token and rotates it', async () => {
    store.value = 'refresh-0';
    mockFetch(() => json(200, authBody(1)));
    await useAuth.getState().init();
    expect(bodyOf(calls[0]!)).toEqual({ refreshToken: 'refresh-0' });
    expect(useAuth.getState()).toMatchObject({ status: 'signedIn', accessToken: 'access-1' });
    expect(store.value).toBe('refresh-1');
  });

  it('signs out and clears the token when the server rejects it', async () => {
    store.value = 'stale';
    mockFetch(() => json(401, { error: 'invalid_refresh_token' }));
    await useAuth.getState().init();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(store.value).toBeNull();
  });

  it('keeps the stored token when the server is unreachable (offline start)', async () => {
    store.value = 'refresh-0';
    mockFetch(() => Promise.reject(new TypeError('offline')));
    await useAuth.getState().init();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(store.value).toBe('refresh-0');
  });
});

describe('automatic refresh on 401', () => {
  async function signedIn() {
    mockFetch(() => json(200, authBody(1)));
    await useAuth.getState().login('alice', 'pw');
  }

  it('refreshes once and retries the request with the new token', async () => {
    await signedIn();
    let n = 0;
    mockFetch((url) => {
      if (url.endsWith('/api/auth/refresh')) return json(200, authBody(2));
      return n++ === 0 ? json(401, { error: 'unauthorized' }) : json(200, { ok: true });
    });
    expect(await api<{ ok: boolean }>('/api/me')).toEqual({ ok: true });
    expect(calls.map((c) => c.url.replace('http://api.test', ''))).toEqual([
      '/api/me',
      '/api/auth/refresh',
      '/api/me',
    ]);
    expect(authHeader(calls[0]!)).toBe('Bearer access-1');
    expect(authHeader(calls[2]!)).toBe('Bearer access-2');
    expect(store.value).toBe('refresh-2');
  });

  it('shares ONE refresh between concurrent 401s (a single-use token must not be replayed)', async () => {
    await signedIn();
    const seen = new Set<string>();
    mockFetch(async (url, init) => {
      if (url.endsWith('/api/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 20));
        return json(200, authBody(2));
      }
      return (init.headers as Record<string, string>).authorization === 'Bearer access-2'
        ? json(200, { ok: url })
        : (seen.add(url), json(401, {}));
    });
    const results = await Promise.all([api('/api/a'), api('/api/b'), api('/api/c')]);
    expect(results).toHaveLength(3);
    expect(calls.filter((c) => c.url.endsWith('/api/auth/refresh'))).toHaveLength(1);
  });

  it('signs out when the refresh fails, and surfaces the 401', async () => {
    await signedIn();
    mockFetch((url) =>
      url.endsWith('/api/auth/refresh')
        ? json(401, { error: 'invalid_refresh_token' })
        : json(401, { error: 'unauthorized' }),
    );
    await expect(api('/api/me')).rejects.toMatchObject({ status: 401 });
    expect(useAuth.getState().status).toBe('signedOut');
    expect(store.value).toBeNull();
  });

  it('retries a refresh conflict using the token another tab stored', async () => {
    await signedIn();
    let refreshCalls = 0;
    mockFetch((url) => {
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls++;
        if (refreshCalls === 1) {
          store.value = 'refresh-from-other-tab'; // the other tab finished rotating
          return json(409, { error: 'refresh_conflict' });
        }
        return json(200, authBody(3));
      }
      return refreshCalls === 0 ? json(401, {}) : json(200, { ok: true });
    });
    expect(await api('/api/me')).toEqual({ ok: true });
    expect(bodyOf(calls.filter((c) => c.url.endsWith('/refresh'))[1]!)).toEqual({
      refreshToken: 'refresh-from-other-tab',
    });
    expect(useAuth.getState().status).toBe('signedIn');
  });

  it('does not refresh for anonymous requests, and maps network failures to ApiError(0)', async () => {
    await signedIn();
    mockFetch(() => json(401, { error: 'invalid_credentials' }));
    await expect(
      api('/api/auth/login', { method: 'POST', body: {}, anonymous: true }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(calls).toHaveLength(1);
    mockFetch(() => Promise.reject(new TypeError('offline')));
    await expect(api('/api/me')).rejects.toBeInstanceOf(ApiError);
  });
});
