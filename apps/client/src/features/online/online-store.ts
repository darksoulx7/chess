import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { ApiError, currentAccessToken, refreshAccessToken } from '../../services/api';
import { getApiUrl } from '../../services/config';
import { uuidv4 } from '../../services/uuid';
import { fetchOnlineGame } from './online-api';
import {
  applyLocalMove,
  buildGame,
  fromSnapshot,
  reduceServer,
  type OnlineGameState,
} from './online-model';
import { OnlineSocket, wsUrlFor, type ConnectionState } from './online-socket';

interface OnlineStore {
  game: OnlineGameState | null;
  connection: ConnectionState;
  /** Why the game could not be loaded, if it could not. */
  loadError: 'not_found' | 'network' | null;
  open: (id: string) => Promise<void>;
  leave: () => void;
  /** Plays a move locally right away and sends it; returns false if it is illegal or not allowed. */
  move: (uci: string) => boolean;
  resign: () => void;
  offerDraw: () => void;
  answerDraw: (accept: boolean) => void;
  abort: () => void;
}

let socket: OnlineSocket | null = null;
let detach: (() => void) | null = null;

function watchEnvironment(nudge: () => void): () => void {
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') nudge();
  });
  const onOnline = () => nudge();
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
  }
  return () => {
    sub.remove();
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
    }
  };
}

export const useOnline = create<OnlineStore>((set, get) => {
  const send = (msg: Parameters<OnlineSocket['send']>[0]) => socket?.send(msg) ?? false;

  const ensureSocket = (): OnlineSocket => {
    if (socket) return socket;
    socket = new OnlineSocket({
      url: wsUrlFor(getApiUrl()),
      getToken: currentAccessToken,
      refreshToken: refreshAccessToken,
      onState: (connection) => set({ connection }),
      onAuthenticated: () => {
        const g = get().game;
        if (g) socket?.send({ t: 'sub', game: g.id });
      },
      onMessage: (msg) => {
        const g = get().game;
        if (!g) return;
        const { state, effect } = reduceServer(g, msg, Date.now());
        set({ game: state });
        if (effect === 'resync') socket?.send({ t: 'sub', game: g.id });
        // Reconnected with a move the server never saw: send it again (the ply makes this idempotent).
        if (msg.t === 'state' && state.pending && state.status === 'ACTIVE') {
          socket?.send({
            t: 'move',
            game: state.id,
            uci: state.pending.uci,
            ply: state.pending.ply,
            cid: state.pending.cid,
          });
        }
      },
    });
    detach = watchEnvironment(() => socket?.nudge());
    return socket;
  };

  return {
    game: null,
    connection: 'closed',
    loadError: null,

    open: async (id) => {
      set({ game: null, loadError: null });
      try {
        const { game } = await fetchOnlineGame(id);
        set({ game: fromSnapshot(game, Date.now()) });
      } catch (err) {
        set({ loadError: err instanceof ApiError && err.status === 404 ? 'not_found' : 'network' });
        return;
      }
      ensureSocket().start();
    },

    leave: () => {
      const g = get().game;
      if (g) socket?.send({ t: 'unsub', game: g.id });
      socket?.stop();
      socket = null;
      detach?.();
      detach = null;
      set({ game: null, connection: 'closed', loadError: null });
    },

    move: (uci) => {
      const g = get().game;
      if (!g || g.status !== 'ACTIVE' || g.pending) return false;
      const chess = buildGame(g);
      if (!chess) return false;
      if (!chess.makeMoveUci(uci).ok) return false;
      const cid = uuidv4();
      const next = applyLocalMove(g, uci, cid);
      set({ game: next });
      // Not connected right now: the move stays pending and is sent once the socket is back.
      send({ t: 'move', game: g.id, uci, ply: g.moves.length, cid });
      return true;
    },

    resign: () => {
      const g = get().game;
      if (g) send({ t: 'resign', game: g.id });
    },
    offerDraw: () => {
      const g = get().game;
      if (g) send({ t: 'draw', game: g.id, action: 'offer' });
    },
    answerDraw: (accept) => {
      const g = get().game;
      if (g) send({ t: 'draw', game: g.id, action: accept ? 'accept' : 'decline' });
    },
    abort: () => {
      const g = get().game;
      if (g) send({ t: 'abort', game: g.id });
    },
  };
});
