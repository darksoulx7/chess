import type { GameSummary, ProfileStats } from '@chess/game-types';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useAuth } from '../auth/auth-store';

export interface SavedGameSummary {
  id: string;
  name: string;
  plyCount: number;
  result: string;
  gameId: string | null;
  createdAt: string;
  updatedAt: string;
}

const useSignedIn = () => useAuth((s) => s.status === 'signedIn');
const useUserId = () => useAuth((s) => s.user?.id ?? null);

export function useStats() {
  const enabled = useSignedIn();
  const userId = useUserId();
  return useQuery({
    queryKey: ['stats', userId],
    queryFn: () => api<ProfileStats>('/api/me/stats'),
    enabled,
  });
}

export function useGames() {
  const enabled = useSignedIn();
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: ['games', userId],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<{ items: GameSummary[]; nextCursor: string | null }>(
        `/api/games?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useSavedGames() {
  const enabled = useSignedIn();
  const userId = useUserId();
  return useQuery({
    queryKey: ['saved', userId],
    queryFn: () => api<{ items: SavedGameSummary[] }>('/api/saved-games'),
    enabled,
  });
}

export function useAccountMutations() {
  const qc = useQueryClient();
  const refreshGames = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['games'] }),
      qc.invalidateQueries({ queryKey: ['stats'] }),
    ]);
  const refreshSaved = () => qc.invalidateQueries({ queryKey: ['saved'] });
  return {
    deleteGame: useMutation({
      mutationFn: (id: string) => api(`/api/games/${id}`, { method: 'DELETE' }),
      onSuccess: refreshGames,
    }),
    deleteSaved: useMutation({
      mutationFn: (id: string) => api(`/api/saved-games/${id}`, { method: 'DELETE' }),
      onSuccess: refreshSaved,
    }),
    renameSaved: useMutation({
      mutationFn: (v: { id: string; name: string }) =>
        api(`/api/saved-games/${v.id}`, { method: 'PATCH', body: { name: v.name } }),
      onSuccess: refreshSaved,
    }),
    saveGame: useMutation({
      mutationFn: (v: { name: string; pgn?: string; gameId?: string }) =>
        api<{ savedGame: SavedGameSummary }>('/api/saved-games', { method: 'POST', body: v }),
      onSuccess: refreshSaved,
    }),
  };
}

export async function fetchGamePgn(id: string): Promise<string> {
  const r = await api<{ game: { pgn: string } }>(`/api/games/${id}`);
  return r.game.pgn;
}

export async function fetchSavedPgn(id: string): Promise<string> {
  const r = await api<{ savedGame: { pgn: string } }>(`/api/saved-games/${id}`);
  return r.savedGame.pgn;
}
