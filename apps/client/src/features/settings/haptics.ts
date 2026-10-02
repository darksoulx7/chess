import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import type { SoundName } from '../game/sound-events';
import { useSettings } from './settings-store';

/**
 * Short vibration matching a game event (same vocabulary as sounds). No-op on web and when
 * disabled; failures (devices without a haptic engine) never affect gameplay.
 */
export function hapticFor(name: SoundName): void {
  if (Platform.OS === 'web' || !useSettings.getState().hapticsEnabled) return;
  const run = (): Promise<void> => {
    switch (name) {
      case 'move':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      case 'capture':
      case 'castle':
      case 'promote':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      case 'check':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      case 'end':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      case 'error':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };
  void run().catch(() => undefined);
}
