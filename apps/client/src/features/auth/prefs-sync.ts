import { preferencesSchema, type Preferences } from '@chess/game-types';
import { useEffect } from 'react';
import { api } from '../../services/api';
import { DEFAULT_SETTINGS, useSettings, type BoardSettings } from '../settings/settings-store';
import { useAuth } from './auth-store';

const SYNC_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof BoardSettings>;

export function pickSettings(s: BoardSettings): Preferences {
  const out: Record<string, unknown> = {};
  for (const k of SYNC_KEYS) out[k] = s[k];
  return out as Preferences;
}

export interface MergeResult {
  /** Settings to apply locally. */
  apply: Preferences;
  /** True when the server has nothing yet and the local settings should be uploaded. */
  upload: boolean;
}

/** First sync after sign-in: server preferences win if it has any; otherwise this device seeds the server. */
export function mergePreferences(server: unknown): MergeResult {
  const parsed = preferencesSchema.safeParse(server);
  const data = parsed.success ? parsed.data : {};
  const hasAny = Object.keys(data).length > 0;
  return { apply: hasAny ? data : {}, upload: !hasAny };
}

/** Keeps settings in sync with the account while signed in (server wins on first sync, then local changes upload debounced). */
export function usePreferencesSync(): void {
  const status = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?.id ?? null);

  useEffect(() => {
    if (status !== 'signedIn' || !userId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    const upload = () =>
      api('/api/me/preferences', {
        method: 'PUT',
        body: pickSettings(useSettings.getState()),
      }).catch(() => undefined);

    void (async () => {
      try {
        const res = await api<{ preferences: unknown }>('/api/me/preferences');
        if (cancelled) return;
        const merged = mergePreferences(res.preferences);
        if (Object.keys(merged.apply).length > 0)
          useSettings.setState(merged.apply as Partial<BoardSettings>);
        if (merged.upload) await upload();
      } catch {
        return; // offline: try again at the next sign-in; local settings keep working
      }
      if (cancelled) return;
      // Only start watching after the initial sync so applying server values does not echo back.
      let last = JSON.stringify(pickSettings(useSettings.getState()));
      unsubscribe = useSettings.subscribe((s) => {
        const now = JSON.stringify(pickSettings(s));
        if (now === last) return;
        last = now;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void upload(), 1000);
      });
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    };
  }, [status, userId]);
}
