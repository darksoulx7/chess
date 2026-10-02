import type { LobbyEntry, OnlineSnapshot } from '@chess/game-types';
import { api } from '../../services/api';

export interface CreateGameInput {
  clock: { baseMs: number; incrementMs: number } | null;
  color: 'w' | 'b' | 'random';
  public: boolean;
}

export const createOnlineGame = (input: CreateGameInput) =>
  api<{ game: OnlineSnapshot }>('/api/online/games', { method: 'POST', body: input });

export const joinByCode = (code: string) =>
  api<{ game: OnlineSnapshot }>('/api/online/games/join', { method: 'POST', body: { code } });

export const joinById = (id: string) =>
  api<{ game: OnlineSnapshot }>(`/api/online/games/${id}/join`, { method: 'POST' });

export const fetchLobby = () => api<{ items: LobbyEntry[] }>('/api/online/lobby');
export const fetchActive = () => api<{ items: OnlineSnapshot[] }>('/api/online/active');
export const fetchOnlineGame = (id: string) =>
  api<{ game: OnlineSnapshot }>(`/api/online/games/${id}`);
export const cancelOnlineGame = (id: string) =>
  api<void>(`/api/online/games/${id}`, { method: 'DELETE' });
