import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type AnimationSpeed = 'off' | 'fast' | 'normal' | 'slow';

export interface BoardSettings {
  showCoordinates: boolean;
  showLegalMoves: boolean;
  showLastMove: boolean;
  showCheck: boolean;
  animationSpeed: AnimationSpeed;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  moveConfirmation: boolean;
  boardThemeId: string;
  pieceThemeId: string;
}

export const DEFAULT_SETTINGS: BoardSettings = {
  showCoordinates: true,
  showLegalMoves: true,
  showLastMove: true,
  showCheck: true,
  animationSpeed: 'normal',
  soundEnabled: true,
  hapticsEnabled: true,
  moveConfirmation: false,
  boardThemeId: 'classic',
  pieceThemeId: 'classic',
};

export const ANIMATION_MS: Record<AnimationSpeed, number> = {
  off: 0,
  fast: 90,
  normal: 160,
  slow: 300,
};

interface SettingsState extends BoardSettings {
  set: <K extends keyof BoardSettings>(key: K, value: BoardSettings[K]) => void;
  reset: () => void;
}

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof BoardSettings>;

/** Keeps only known keys whose stored type matches the default, so a corrupt/old blob can't break the UI. */
export function sanitizeSettings(raw: unknown): Partial<BoardSettings> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === typeof DEFAULT_SETTINGS[key]) out[key] = value;
  }
  if (out.animationSpeed && !((out.animationSpeed as string) in ANIMATION_MS))
    delete out.animationSpeed;
  return out as Partial<BoardSettings>;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Pick<BoardSettings, typeof key>),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: 'chess.settings.v1',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s): BoardSettings => {
        const out = {} as Record<string, unknown>;
        for (const key of SETTING_KEYS) out[key] = s[key];
        return out as unknown as BoardSettings;
      },
      merge: (persisted, current) => ({ ...current, ...sanitizeSettings(persisted) }),
    },
  ),
);
