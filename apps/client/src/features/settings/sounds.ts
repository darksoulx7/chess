import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import type { SoundName } from '../game/sound-events';
import { useSettings } from './settings-store';
import capture from '../../../assets/sounds/capture.wav';
import castle from '../../../assets/sounds/castle.wav';
import check from '../../../assets/sounds/check.wav';
import end from '../../../assets/sounds/end.wav';
import error from '../../../assets/sounds/error.wav';
import move from '../../../assets/sounds/move.wav';
import promote from '../../../assets/sounds/promote.wav';

const SOURCES: Record<SoundName, number> = { move, capture, check, castle, promote, end, error };
const players = new Map<SoundName, AudioPlayer>();
let warned = false;

/**
 * Plays an effect if sound is enabled. Always called from a user-initiated action (a move), which
 * satisfies browser autoplay policies. Audio failures must never break gameplay: they are logged once.
 */
export function playSound(name: SoundName): void {
  if (!useSettings.getState().soundEnabled) return;
  try {
    let player = players.get(name);
    if (!player) {
      player = createAudioPlayer(SOURCES[name]);
      players.set(name, player);
    }
    void player.seekTo(0);
    player.play();
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn('Sound playback unavailable:', err);
    }
  }
}
