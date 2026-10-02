import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

const TAG = 'chess-game';

/** Keeps the screen on while a game is in progress (best effort; unsupported browsers ignore it). */
export function useKeepAwakeWhile(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void activateKeepAwakeAsync(TAG).catch(() => undefined);
    return () => {
      void deactivateKeepAwake(TAG).catch(() => undefined);
    };
  }, [active]);
}

/** Android hardware back button: while `enabled`, call `onBlocked` instead of leaving the screen. */
export function useBackGuard(enabled: boolean, onBlocked: () => void): void {
  useEffect(() => {
    // react-native-web's BackHandler throws; browsers have their own back navigation.
    if (!enabled || Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBlocked();
      return true;
    });
    return () => sub.remove();
  }, [enabled, onBlocked]);
}
