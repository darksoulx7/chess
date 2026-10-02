import { z } from 'zod';

export const AVATAR_IDS = ['knight', 'bishop', 'rook', 'queen', 'king', 'pawn'] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

/** Synced user preferences (board settings). Unknown keys are dropped; every key is optional. */
export const preferencesSchema = z
  .object({
    showCoordinates: z.boolean(),
    showLegalMoves: z.boolean(),
    showLastMove: z.boolean(),
    showCheck: z.boolean(),
    animationSpeed: z.enum(['off', 'fast', 'normal', 'slow']),
    soundEnabled: z.boolean(),
    moveConfirmation: z.boolean(),
    boardThemeId: z.string().min(1).max(40),
    pieceThemeId: z.string().min(1).max(40),
  })
  .partial();
export type Preferences = z.infer<typeof preferencesSchema>;

export const GAME_RESULTS = ['1-0', '0-1', '1/2-1/2'] as const;
export type GameResultCode = (typeof GAME_RESULTS)[number];

export const TERMINATIONS = [
  'checkmate',
  'stalemate',
  'insufficient-material',
  'threefold-repetition',
  'fifty-move-rule',
  'resignation',
  'timeout',
  'agreement',
  'abandoned',
] as const;
export type Termination = (typeof TERMINATIONS)[number];

export interface GamePlayerSummary {
  color: 'w' | 'b';
  name: string;
  isBot: boolean;
  botRating: number | null;
}

export interface GameSummary {
  id: string;
  mode: 'BOT' | 'LOCAL' | 'ONLINE';
  result: GameResultCode | '*';
  termination: Termination | null;
  endedAt: string | null;
  plyCount: number;
  botRating: number | null;
  openingName: string | null;
  eco: string | null;
  timeBaseMs: number | null;
  timeIncrementMs: number | null;
  /** The colour the requesting user played (null if they were not a player). */
  myColor: 'w' | 'b' | null;
  players: GamePlayerSummary[];
}

export interface ProfileStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  /** 0..1; 0 when no games. */
  winRate: number;
  favoriteOpenings: Array<{ name: string; eco: string | null; count: number }>;
  recentGames: GameSummary[];
}
