import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({ Platform: platform }));
const haptics = vi.hoisted(() => ({
  impactAsync: vi.fn(async () => undefined),
  notificationAsync: vi.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
vi.mock('expo-haptics', () => haptics);
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

import { hapticFor } from './haptics';
import { useSettings } from './settings-store';

beforeEach(() => {
  vi.clearAllMocks();
  platform.OS = 'ios';
  useSettings.setState({ hapticsEnabled: true });
});

describe('hapticFor', () => {
  it('maps game events to light/medium impacts and notifications', () => {
    hapticFor('move');
    expect(haptics.impactAsync).toHaveBeenLastCalledWith('light');
    hapticFor('capture');
    expect(haptics.impactAsync).toHaveBeenLastCalledWith('medium');
    hapticFor('check');
    expect(haptics.notificationAsync).toHaveBeenLastCalledWith('warning');
    hapticFor('end');
    expect(haptics.notificationAsync).toHaveBeenLastCalledWith('success');
    hapticFor('error');
    expect(haptics.notificationAsync).toHaveBeenLastCalledWith('error');
  });

  it('does nothing on web or when disabled', () => {
    useSettings.setState({ hapticsEnabled: false });
    hapticFor('move');
    platform.OS = 'web';
    useSettings.setState({ hapticsEnabled: true });
    hapticFor('move');
    expect(haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('swallows device errors', async () => {
    haptics.impactAsync.mockRejectedValueOnce(new Error('no engine'));
    expect(() => hapticFor('move')).not.toThrow();
    await Promise.resolve();
  });
});
