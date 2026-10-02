import { create } from 'zustand';

export type AnimationSpeed = 'off' | 'fast' | 'normal' | 'slow';

export interface BoardSettings {
  showCoordinates: boolean;
  showLegalMoves: boolean;
  showLastMove: boolean;
  showCheck: boolean;
  animationSpeed: AnimationSpeed;
  soundEnabled: boolean;
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

export const useSettings = create<SettingsState>((set) => ({
  ...DEFAULT_SETTINGS,
  set: (key, value) => set({ [key]: value } as Pick<BoardSettings, typeof key>),
  reset: () => set({ ...DEFAULT_SETTINGS }),
}));
