/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Game-agnostic client half of the multiplayer infrastructure: one socket
 * per game namespace, create/join/quickPlay/rejoin with per-tab identity,
 * automatic silent rejoin after refreshes and reconnects, ready toggles,
 * leave/playAgain, and toasts. Game-specific events and state live in each
 * game's own hook, wired in via `bindGameEvents`.
 */

export interface LobbyPlayerShape {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
}

export interface BaseSnapshotShape {
  code: string;
  isPublic: boolean;
  state: string;
  hostId: string | null;
  players: LobbyPlayerShape[];
  lobbyCountdownEndsAt: number | null;
  gameOverReason: string | null;
}

export interface Toast {
  id: number;
  message: string;
  kind: "error" | "info";
}

export interface CoreState<TSnap> {
  status: "connecting" | "connected" | "reconnecting";
  room: TSnap | null;
  playerId: string | null;
  toasts: Toast[];
  busy: boolean;
}

export interface GameApi<TSnap> {
  patchRoom(fn: (room: TSnap) => TSnap): void;
  toast(message: string, kind?: Toast["kind"]): void;
  getPlayerId(): string | null;
}

interface JoinShape<TSnap> {
  playerId: string;
  code: string;
  room: TSnap;
}

type CoreAction<TSnap> =
  | { type: "status"; status: CoreState<TSnap>["status"] }
  | { type: "busy"; busy: boolean }
  | { type: "roomUpdate"; room: TSnap }
  | { type: "patchRoom"; fn: (room: TSnap) => TSnap }
  | { type: "session"; room: TSnap; playerId: string }
  | { type: "leftRoom" }
  | { type: "toast"; message: string; kind: Toast["kind"] }
  | { type: "dismissToast"; id: number };

let toastId = 0;

function makeReducer<TSnap>() {
  return (state: CoreState<TSnap>, action: CoreAction<TSnap>): CoreState<TSnap> => {
    switch (action.type) {
      case "status":
        return { ...state, status: action.status };
      case "busy":
        return { ...state, busy: action.busy };
      case "roomUpdate":
        return { ...state, room: action.room };
      case "patchRoom":
        return state.room ? { ...state, room: action.fn(state.room) } : state;
      case "session":
        return { ...state, room: action.room, playerId: action.playerId, busy: false };
      case "leftRoom":
        return { ...state, room: null, playerId: null, busy: false };
      case "toast":
        return {
          ...state,
          toasts: [...state.toasts.slice(-3), { id: ++toastId, message: action.message, kind: action.kind }],
        };
      case "dismissToast":
        return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
      default:
        return state;
    }
  };
}

// sessionStorage (per-tab) rather than localStorage so two tabs in the same
// browser can be two different players — while still surviving a refresh.
export const NAME_KEY = "arcade:name";

interface StoredSession {
  playerId: string;
  code: string;
}

function sessionKey(gameKey: string): string {
  return `arcade:${gameKey}:session`;
}

function loadSession(gameKey: string): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(gameKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.playerId && parsed.code ? parsed : null;
  } catch {
    return null;
  }
}

function saveSession(gameKey: string, session: StoredSession): void {
  sessionStorage.setItem(sessionKey(gameKey), JSON.stringify(session));
}

function clearSession(gameKey: string): void {
  sessionStorage.removeItem(sessionKey(gameKey));
}

const ACK_TIMEOUT_MS = 8000;

export interface RoomCoreOptions<TSnap> {
  /** Socket.IO namespace, e.g. "/mindmeld". */
  namespace: string;
  /** Storage key part, e.g. "mindmeld". */
  gameKey: string;
  /** Called when a session begins or ends so the game can reset its state. */
  onSession?: (kind: "joined" | "rejoined" | "left", rejoinData?: any) => void;
  /** Register game-specific socket listeners. */
  bindGameEvents?: (socket: Socket<any, any>, api: GameApi<TSnap>) => void;
}

export function useRoomCore<TSnap extends BaseSnapshotShape>(opts: RoomCoreOptions<TSnap>) {
  const socketRef = useRef<Socket<any, any> | null>(null);
  if (!socketRef.current) {
    socketRef.current = io(opts.namespace, { path: "/socket.io", autoConnect: false });
  }
  const socket = socketRef.current;
  const [state, dispatch] = useReducer(makeReducer<TSnap>(), {
    status: "connecting",
    room: null,
    playerId: null,
    toasts: [],
    busy: false,
  });

  const hadRoomRef = useRef(false);
  hadRoomRef.current = state.room !== null;
  const playerIdRef = useRef<string | null>(null);
  playerIdRef.current = state.playerId;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const toast = useCallback((message: string, kind: Toast["kind"] = "error") => {
    dispatch({ type: "toast", message, kind });
  }, []);

  const patchRoom = useCallback((fn: (room: TSnap) => TSnap) => {
    dispatch({ type: "patchRoom", fn });
  }, []);

  const apiRef = useRef<GameApi<TSnap>>({
    patchRoom,
    toast,
    getPlayerId: () => playerIdRef.current,
  });

  useEffect(() => {
    const gameKey = optsRef.current.gameKey;
    const onConnect = () => {
      dispatch({ type: "status", status: "connected" });
      // Re-bind our identity after any (re)connect so a refresh or network
      // blip never ends the game.
      const session = loadSession(gameKey);
      if (session) {
        socket.emit("rejoin", session, (res: any) => {
          if (res.ok) {
            dispatch({ type: "session", room: res.data.room, playerId: res.data.playerId });
            optsRef.current.onSession?.("rejoined", res.data);
          } else {
            clearSession(gameKey);
            dispatch({ type: "leftRoom" });
            optsRef.current.onSession?.("left");
            if (hadRoomRef.current) toast(res.error);
          }
        });
      }
    };
    const onDisconnect = () => {
      dispatch({ type: "status", status: hadRoomRef.current ? "reconnecting" : "connecting" });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("roomUpdate", (room: TSnap) => dispatch({ type: "roomUpdate", room }));
    socket.on("errorMsg", (p: { message: string }) => toast(p.message));
    socket.on("playerJoined", (p: { player: LobbyPlayerShape }) =>
      toast(`${p.player.name} joined`, "info"),
    );
    socket.on(
      "playerLeft",
      (p: { playerId: string; name: string; reason: "left" | "afk" | "removed" }) => {
        if (p.playerId === loadSession(gameKey)?.playerId) {
          clearSession(gameKey);
          dispatch({ type: "leftRoom" });
          optsRef.current.onSession?.("left");
        } else {
          toast(p.reason === "afk" ? `${p.name} was removed (AFK)` : `${p.name} left`, "info");
        }
      },
    );
    optsRef.current.bindGameEvents?.(socket, apiRef.current);

    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [socket, toast]);

  const handleJoinResult = useCallback(
    (res: any) => {
      dispatch({ type: "busy", busy: false });
      if (res.ok) {
        const data = res.data as JoinShape<TSnap>;
        saveSession(optsRef.current.gameKey, { playerId: data.playerId, code: data.code });
        dispatch({ type: "session", room: data.room, playerId: data.playerId });
        optsRef.current.onSession?.("joined");
      } else {
        toast(res.error);
      }
    },
    [toast],
  );

  const ackErr = useCallback(() => {
    dispatch({ type: "busy", busy: false });
    toast("No response from server — try again.");
  }, [toast]);

  const joinAction = useCallback(
    (event: string, payload: Record<string, unknown>) => {
      dispatch({ type: "busy", busy: true });
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emit(event as any, payload, (err: unknown, res: any) =>
          err ? ackErr() : handleJoinResult(res),
        );
    },
    [socket, handleJoinResult, ackErr],
  );

  const createRoom = useCallback(
    (name: string, isPublic: boolean, settings?: Record<string, unknown>) =>
      joinAction("createRoom", { name, isPublic, settings }),
    [joinAction],
  );
  const joinRoom = useCallback(
    (code: string, name: string) => joinAction("joinRoom", { code, name }),
    [joinAction],
  );
  const quickPlay = useCallback((name: string) => joinAction("quickPlay", { name }), [joinAction]);

  const toggleReady = useCallback(() => socket.emit("toggleReady"), [socket]);
  const startGame = useCallback(() => socket.emit("startGame"), [socket]);
  const playAgain = useCallback(() => socket.emit("playAgain"), [socket]);

  const leaveRoom = useCallback(() => {
    socket.emit("leaveRoom");
    clearSession(optsRef.current.gameKey);
    dispatch({ type: "leftRoom" });
    optsRef.current.onSession?.("left");
  }, [socket]);

  const dismissToast = useCallback((id: number) => dispatch({ type: "dismissToast", id }), []);

  /** Emit a game event with an ack, mapped to a Promise-style callback. */
  const emitWithAck = useCallback(
    (event: string, payload: unknown, cb: (res: any) => void) => {
      socket.timeout(ACK_TIMEOUT_MS).emit(event as any, payload, (err: unknown, res: any) => {
        cb(err ? { ok: false, error: "No response from server — try again." } : res);
      });
    },
    [socket],
  );

  return {
    state,
    socket,
    toast,
    patchRoom,
    emitWithAck,
    actions: {
      createRoom,
      joinRoom,
      quickPlay,
      toggleReady,
      startGame,
      playAgain,
      leaveRoom,
      dismissToast,
    },
  };
}
