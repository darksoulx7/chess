import type { GameStatus, MoveRecord } from '@chess/chess-core';

export type SoundName = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'end' | 'error';

/** Which effect to play after `move` produced `status`. Precedence: end > check > promotion > castle > capture > move. */
export function soundFor(move: MoveRecord, status: GameStatus): SoundName {
  if (status.state !== 'active') return 'end';
  if (move.givesCheck) return 'check';
  if (move.isPromotion) return 'promote';
  if (move.castle) return 'castle';
  if (move.isCapture) return 'capture';
  return 'move';
}
