import { useCallback, useEffect, useReducer, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  AckResponse,
  ClientToServerEvents,
  JoinResult,
  RejoinResult,
  ServerToClientEvents,
} from "@shared/events";
import type {
  PublicPlayer,
  RevealEntry,
  RoomSettings,
  RoomSnapshot,
} from "@shared/types";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface Toast {
  id: number;
  message: string;
  kind: "error" | "info";
}

export interface MindMeldState {
  status: "connecting" | "connected" | "reconnecting";
  room: RoomSnapshot | null;
  playerId: string | null;
  /** Your own locked word for the current round. */
  myWord: { raw: string; normalized: string } | null;
  reveal: { round: number; entries: RevealEntry[]; isWin: boolean } | null;
  revealSecondsLeft: number | null;
  win: { word: string; rounds: number; players: PublicPlayer[] } | null;
  toasts: Toast[];
  busy: boolean;
}

type Action =
  | { type: "status"; status: MindMeldState["status"] }
  | { type: "busy"; busy: boolean }
  | { type: "roomUpdate"; room: RoomSnapshot }
  | { type: "joined"; room: RoomSnapshot; playerId: string }
  | { type: "rejoined"; result: RejoinResult }
  | { type: "roundStart"; roundNumber: number; usedWords: string[]; deadline: number }
  | { type: "playerLockedIn"; playerId: string; locked: boolean }
  | { type: "revealCountdown"; secondsLeft: number }
  | { type: "roundReveal"; round: number; entries: RevealEntry[]; usedWords: string[]; isWin: boolean }
  | { type: "gameWin"; word: string; rounds: number; players: PublicPlayer[] }
  | { type: "lockedSelf"; raw: string; normalized: string }
  | { type: "unlockedSelf" }
  | { type: "leftRoom" }
  | { type: "toast"; message: string; kind: Toast["kind"] }
  | { type: "dismissToast"; id: number };

const initialState: MindMeldState = {
  status: "connecting",
  room: null,
  playerId: null,
  myWord: null,
  reveal: null,
  revealSecondsLeft: null,
  win: null,
  toasts: [],
  busy: false,
};

let toastId = 0;

function withToast(state: MindMeldState, message: string, kind: Toast["kind"]): MindMeldState {
  return { ...state, toasts: [...state.toasts.slice(-3), { id: ++toastId, message, kind }] };
}

function reducer(state: MindMeldState, action: Action): MindMeldState {
  switch (action.type) {
    case "status":
      return { ...state, status: action.status };
    case "busy":
      return { ...state, busy: action.busy };
    case "roomUpdate":
      return { ...state, room: action.room };
    case "joined":
      return {
        ...initialState,
        status: state.status,
        toasts: state.toasts,
        room: action.room,
        playerId: action.playerId,
      };
    case "rejoined":
      return {
        ...initialState,
        status: state.status,
        toasts: state.toasts,
        room: action.result.room,
        playerId: action.result.playerId,
        myWord: action.result.yourWord,
        win:
          action.result.room.state === "finished" && action.result.room.winner
            ? { ...action.result.room.winner, players: action.result.room.players }
            : null,
      };
    case "roundStart": {
      if (!state.room) return state;
      return {
        ...state,
        room: {
          ...state.room,
          state: "playing",
          roundNumber: action.roundNumber,
          usedWords: action.usedWords,
          deadline: action.deadline,
          players: state.room.players.map((p) => ({ ...p, lockedIn: false })),
        },
        reveal: null,
        revealSecondsLeft: null,
        myWord: null,
        win: null,
      };
    }
    case "playerLockedIn": {
      if (!state.room) return state;
      return {
        ...state,
        room: {
          ...state.room,
          players: state.room.players.map((p) =>
            p.id === action.playerId ? { ...p, lockedIn: action.locked } : p,
          ),
        },
        myWord: action.playerId === state.playerId && !action.locked ? null : state.myWord,
      };
    }
    case "revealCountdown":
      return { ...state, revealSecondsLeft: action.secondsLeft };
    case "roundReveal": {
      if (!state.room) return state;
      return {
        ...state,
        room: {
          ...state.room,
          usedWords: action.usedWords,
          deadline: null,
          history: [
            ...state.room.history.filter((h) => h.round !== action.round),
            { round: action.round, entries: action.entries },
          ],
        },
        reveal: { round: action.round, entries: action.entries, isWin: action.isWin },
      };
    }
    case "gameWin":
      return {
        ...state,
        win: { word: action.word, rounds: action.rounds, players: action.players },
      };
    case "lockedSelf":
      return { ...state, myWord: { raw: action.raw, normalized: action.normalized } };
    case "unlockedSelf":
      return { ...state, myWord: null };
    case "leftRoom":
      return { ...initialState, status: state.status, toasts: state.toasts };
    case "toast":
      return withToast(state, action.message, action.kind);
    case "dismissToast":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    default:
      return state;
  }
}

// sessionStorage (per-tab) rather than localStorage so two tabs in the same
// browser can be two different players — while still surviving a refresh.
const SESSION_KEY = "arcade:mindmeld:session";
export const NAME_KEY = "arcade:name";

interface StoredSession {
  playerId: string;
  code: string;
}

function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.playerId && parsed.code ? parsed : null;
  } catch {
    return null;
  }
}

function saveSession(session: StoredSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

const ACK_TIMEOUT_MS = 8000;

export function useMindMeld() {
  const socketRef = useRef<GameSocket | null>(null);
  if (!socketRef.current) {
    socketRef.current = io("/mindmeld", { path: "/socket.io", autoConnect: false });
  }
  const socket = socketRef.current;
  const [state, dispatch] = useReducer(reducer, initialState);
  const hadRoomRef = useRef(false);
  hadRoomRef.current = state.room !== null;

  useEffect(() => {
    const onConnect = () => {
      dispatch({ type: "status", status: "connected" });
      // Re-bind our identity after any (re)connect so a refresh or network
      // blip never ends the game.
      const session = loadSession();
      if (session) {
        socket.emit("rejoin", session, (res) => {
          if (res.ok) {
            dispatch({ type: "rejoined", result: res.data });
          } else {
            clearSession();
            dispatch({ type: "leftRoom" });
            if (hadRoomRef.current) {
              dispatch({ type: "toast", message: res.error, kind: "error" });
            }
          }
        });
      }
    };
    const onDisconnect = () => {
      dispatch({ type: "status", status: hadRoomRef.current ? "reconnecting" : "connecting" });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("roomUpdate", (room) => dispatch({ type: "roomUpdate", room }));
    socket.on("roundStart", (p) => dispatch({ type: "roundStart", ...p }));
    socket.on("playerLockedIn", (p) => dispatch({ type: "playerLockedIn", ...p }));
    socket.on("revealCountdown", (p) => dispatch({ type: "revealCountdown", ...p }));
    socket.on("roundReveal", (p) => dispatch({ type: "roundReveal", ...p }));
    socket.on("gameWin", (p) => dispatch({ type: "gameWin", ...p }));
    socket.on("gameOver", (p) =>
      dispatch({ type: "toast", message: `Game over: ${p.reason}`, kind: "info" }),
    );
    socket.on("errorMsg", (p) => dispatch({ type: "toast", message: p.message, kind: "error" }));
    socket.on("playerJoined", (p) =>
      dispatch({ type: "toast", message: `${p.player.name} joined`, kind: "info" }),
    );
    socket.on("playerLeft", (p) => {
      const self = p.playerId === loadSession()?.playerId;
      if (self) {
        clearSession();
        dispatch({ type: "leftRoom" });
      } else {
        dispatch({
          type: "toast",
          message: p.reason === "afk" ? `${p.name} was removed (AFK)` : `${p.name} left`,
          kind: "info",
        });
      }
    });

    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [socket]);

  const handleJoinResult = useCallback(
    (res: AckResponse<JoinResult>) => {
      dispatch({ type: "busy", busy: false });
      if (res.ok) {
        saveSession({ playerId: res.data.playerId, code: res.data.code });
        dispatch({ type: "joined", room: res.data.room, playerId: res.data.playerId });
      } else {
        dispatch({ type: "toast", message: res.error, kind: "error" });
      }
    },
    [dispatch],
  );

  const ackErr = useCallback(() => {
    dispatch({ type: "busy", busy: false });
    dispatch({ type: "toast", message: "No response from server — try again.", kind: "error" });
  }, []);

  const createRoom = useCallback(
    (name: string, isPublic: boolean, settings?: Partial<RoomSettings>) => {
      dispatch({ type: "busy", busy: true });
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emit("createRoom", { name, isPublic, settings }, (err, res) =>
          err ? ackErr() : handleJoinResult(res),
        );
    },
    [socket, handleJoinResult, ackErr],
  );

  const joinRoom = useCallback(
    (code: string, name: string) => {
      dispatch({ type: "busy", busy: true });
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emit("joinRoom", { code, name }, (err, res) => (err ? ackErr() : handleJoinResult(res)));
    },
    [socket, handleJoinResult, ackErr],
  );

  const quickPlay = useCallback(
    (name: string) => {
      dispatch({ type: "busy", busy: true });
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emit("quickPlay", { name }, (err, res) => (err ? ackErr() : handleJoinResult(res)));
    },
    [socket, handleJoinResult, ackErr],
  );

  const lockIn = useCallback(
    (word: string) => {
      socket.timeout(ACK_TIMEOUT_MS).emit("lockIn", { word }, (err, res) => {
        if (err) {
          dispatch({ type: "toast", message: "No response from server — try again.", kind: "error" });
        } else if (res.ok) {
          dispatch({ type: "lockedSelf", raw: word, normalized: res.data.normalized });
        } else {
          dispatch({ type: "toast", message: res.error, kind: "error" });
        }
      });
    },
    [socket],
  );

  const unlock = useCallback(() => {
    socket.emit("unlock");
    dispatch({ type: "unlockedSelf" });
  }, [socket]);

  const toggleReady = useCallback(() => socket.emit("toggleReady"), [socket]);
  const startGame = useCallback(() => socket.emit("startGame"), [socket]);
  const playAgain = useCallback(() => socket.emit("playAgain"), [socket]);

  const leaveRoom = useCallback(() => {
    socket.emit("leaveRoom");
    clearSession();
    dispatch({ type: "leftRoom" });
  }, [socket]);

  const dismissToast = useCallback((id: number) => dispatch({ type: "dismissToast", id }), []);

  return {
    state,
    actions: {
      createRoom,
      joinRoom,
      quickPlay,
      lockIn,
      unlock,
      toggleReady,
      startGame,
      playAgain,
      leaveRoom,
      dismissToast,
    },
  };
}
