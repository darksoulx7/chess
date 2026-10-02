import type { AvatarId } from '@chess/game-types';
import { create } from 'zustand';
import { ApiError, api, setAuthHooks } from '../../services/api';
import { createTokenStorage, type TokenStorage } from '../../services/token-storage';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  avatar: AvatarId | string;
  createdAt: string;
}

interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  accessToken: string | null;
  /** Restores a session from the stored refresh token (call once at startup). */
  init: () => Promise<void>;
  register: (input: { email: string; username: string; password: string }) => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser) => void;
}

let storage: TokenStorage = createTokenStorage();
/** Test seam. */
export function setTokenStorage(s: TokenStorage): void {
  storage = s;
}

// One refresh at a time: concurrent 401s share the same request instead of replaying a single-use token.
let inflight: Promise<string | null> | null = null;

const CONFLICT_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function doRefresh(set: (p: Partial<AuthState>) => void): Promise<string | null> {
  for (let attempt = 0; attempt <= CONFLICT_RETRIES; attempt++) {
    const refreshToken = await storage.get();
    if (!refreshToken) break;
    try {
      const res = await api<AuthResponse>('/api/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        anonymous: true,
      });
      await storage.set(res.refreshToken);
      set({ status: 'signedIn', user: res.user, accessToken: res.accessToken });
      return res.accessToken;
    } catch (err) {
      // 409: another tab rotated the token a moment ago. Re-read storage (it holds the new token) and retry.
      if (
        err instanceof ApiError &&
        err.code === 'refresh_conflict' &&
        attempt < CONFLICT_RETRIES
      ) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      if (err instanceof ApiError && err.status === 0) return null; // offline: keep the stored token, stay as-is
      break;
    }
  }
  await storage.clear();
  set({ status: 'signedOut', user: null, accessToken: null });
  return null;
}

export const useAuth = create<AuthState>((set, get) => {
  const refresh = () => (inflight ??= doRefresh(set).finally(() => (inflight = null)));

  setAuthHooks({ getAccessToken: () => get().accessToken, refreshAccessToken: refresh });

  const accept = async (res: AuthResponse) => {
    await storage.set(res.refreshToken);
    set({ status: 'signedIn', user: res.user, accessToken: res.accessToken });
  };

  return {
    status: 'loading',
    user: null,
    accessToken: null,

    init: async () => {
      if (!(await storage.get())) {
        set({ status: 'signedOut' });
        return;
      }
      const token = await refresh();
      // Offline at startup: refresh() returned null without clearing; show signed-out UI but keep the token.
      if (token === null && get().status === 'loading') set({ status: 'signedOut' });
    },

    register: async (input) =>
      accept(
        await api<AuthResponse>('/api/auth/register', {
          method: 'POST',
          body: input,
          anonymous: true,
        }),
      ),
    login: async (identifier, password) =>
      accept(
        await api<AuthResponse>('/api/auth/login', {
          method: 'POST',
          body: { identifier, password },
          anonymous: true,
        }),
      ),

    logout: async () => {
      const refreshToken = await storage.get();
      set({ status: 'signedOut', user: null, accessToken: null });
      await storage.clear();
      if (refreshToken) {
        // Best effort: the local session is already gone even if the server cannot be reached.
        await api('/api/auth/logout', {
          method: 'POST',
          body: { refreshToken },
          anonymous: true,
        }).catch(() => undefined);
      }
    },

    setUser: (user) => set({ user }),
  };
});

export function __resetAuthForTests(): void {
  inflight = null;
  useAuth.setState({ status: 'loading', user: null, accessToken: null });
}
