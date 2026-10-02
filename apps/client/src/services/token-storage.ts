import { Platform } from 'react-native';

const KEY = 'chess.refreshToken.v1';

export interface TokenStorage {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Refresh-token persistence. Native: the OS keychain/keystore via expo-secure-store.
 * Web: localStorage (there is no secure storage in browsers; the token is single-use and rotated, but
 * it is readable by any script on the page, so XSS hardening matters; see docs/AUTH.md).
 * Storage failures never throw: the user simply has to sign in again.
 */
export function createTokenStorage(): TokenStorage {
  if (Platform.OS === 'web') {
    return {
      async get() {
        try {
          return globalThis.localStorage?.getItem(KEY) ?? null;
        } catch {
          return null;
        }
      },
      async set(token) {
        try {
          globalThis.localStorage?.setItem(KEY, token);
        } catch {
          /* private mode / blocked storage */
        }
      },
      async clear() {
        try {
          globalThis.localStorage?.removeItem(KEY);
        } catch {
          /* ignore */
        }
      },
    };
  }
  return {
    async get() {
      try {
        const SecureStore = await import('expo-secure-store');
        return await SecureStore.getItemAsync(KEY);
      } catch {
        return null;
      }
    },
    async set(token) {
      try {
        const SecureStore = await import('expo-secure-store');
        await SecureStore.setItemAsync(KEY, token);
      } catch {
        /* ignore */
      }
    },
    async clear() {
      try {
        const SecureStore = await import('expo-secure-store');
        await SecureStore.deleteItemAsync(KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

export class MemoryTokenStorage implements TokenStorage {
  constructor(public value: string | null = null) {}
  async get() {
    return this.value;
  }
  async set(token: string) {
    this.value = token;
  }
  async clear() {
    this.value = null;
  }
}
