import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config', () => ({ getApiUrl: () => 'http://api.test' }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));
import { DEFAULT_SETTINGS } from '../settings/settings-store';
import { mergePreferences, pickSettings } from './prefs-sync';

describe('mergePreferences', () => {
  it('applies server preferences when present', () => {
    expect(mergePreferences({ boardThemeId: 'wood', soundEnabled: false })).toEqual({
      apply: { boardThemeId: 'wood', soundEnabled: false },
      upload: false,
    });
  });
  it('seeds the server from this device when the server has nothing, or garbage', () => {
    expect(mergePreferences({})).toEqual({ apply: {}, upload: true });
    expect(mergePreferences(null)).toEqual({ apply: {}, upload: true });
    expect(mergePreferences({ animationSpeed: 'warp' })).toEqual({ apply: {}, upload: true });
  });
  it('drops unknown keys', () => {
    expect(mergePreferences({ boardThemeId: 'wood', evil: 1 }).apply).toEqual({
      boardThemeId: 'wood',
    });
  });
});

describe('pickSettings', () => {
  it('includes exactly the synced setting keys', () => {
    const picked = pickSettings({ ...DEFAULT_SETTINGS });
    expect(Object.keys(picked).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});
